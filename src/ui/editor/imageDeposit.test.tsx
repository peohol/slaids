/**
 * The two screens of the image deposit, in a real DOM.
 *
 * What is pinned here is what a person can actually do wrong, and what the
 * screens must not let them do:
 *
 *  - the deck that is waiting for pictures offers *both* ways on, and going to
 *    the editor is not a decision about the deposit;
 *  - the brief hands over the whole series as one text, because that is the one
 *    thing a picture conversation can carry out in one go;
 *  - the deposit reads the order off the file names when they say it, and asks
 *    for it — with the pictures on screen — when they do not;
 *  - «Fullfør» is not reachable for a set that is short, over-full or holds
 *    something that is not a picture: the disabled button is the same domain
 *    verdict the command refuses on, seen from the other side.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { abandonImageDeposit, addSlide, setImagePlan } from '../../domain/commands'
import { createImage } from '../../domain/content'
import { createLeaf, createSplit } from '../../domain/layout'
import { createPresentation } from '../../domain/presentation'
import { titleDoc } from '../../domain/richdoc'
import { contentAt, sectionAt } from '../../domain/testDecks'
import { realImages } from '../../domain/testImages'
import { DexieSlaidsRepository } from '../../persistence/dexieRepository'
import { SlaidsDatabase } from '../../persistence/db'
import { setRepositoryOverride } from '../../persistence/activeRepository'
import { depositIsOpen } from '../../domain/imageDeposit'
import {
  composeImageBrief,
  composeImageGenerationPrompt,
  resolveImagePlan,
} from '../../domain/imagePlan'
import type { Presentation } from '../../domain/types'
import { useEditorStore } from '../../state/store'
import { ImageBriefModal } from './ImageBriefModal'
import { ImageDepositIntroModal } from './ImageDepositIntroModal'
import { ImageDepositModal } from './ImageDepositModal'

let container: HTMLDivElement | null = null
let root: Root | null = null

let counter = 0
const databases: SlaidsDatabase[] = []

/*
 * jsdom has no blob URLs, and the deposit shows real thumbnails — so the one
 * thing the dialog asks of the browser is stubbed, and the tests can then check
 * that every picked file is actually given a picture to look at.
 */
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
let objectUrls = 0
beforeAll(() => {
  URL.createObjectURL = () => `blob:slaids/${(objectUrls += 1)}`
  URL.revokeObjectURL = () => {}
})
afterAll(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

/**
 * A real Dexie store rather than a stub, for the same reason
 * `state/assetUpload.test.ts` uses one: what is being checked is what ends up
 * *in the store* — and, for a deposit that did not land, that there is nothing
 * there at all. A stub could only confirm which method was called.
 */
function freshRepository(): { repository: DexieSlaidsRepository; database: SlaidsDatabase } {
  counter += 1
  const database = new SlaidsDatabase(`slaids-deposit-${counter}`)
  databases.push(database)
  const repository = new DexieSlaidsRepository(database)
  setRepositoryOverride(repository)
  return { repository, database }
}

afterEach(async () => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  useEditorStore.getState().setPresentation(null)
  setRepositoryOverride(null)
  while (databases.length > 0) await databases.pop()?.delete()
})

/**
 * Motifs that are genuinely different from each other.
 *
 * `checkImagePlan` refuses near-duplicates, and a plan with findings is a plan
 * the workflow sends back for repair — so three variations on one sentence
 * would make the fixture untestable against the delivery.
 */
const SUBJECTS: readonly string[] = [
  'Motiv nummer 1: en savanne med akasietrær i lavt morgenlys',
  'Motiv nummer 2: et tilhugget steinredskap holdt frem mellom to fingre',
  'Motiv nummer 3: en leirboplass med røyk som siger mellom skinntelt',
]

/** A deck of three planned, numbered, unfilled picture zones. */
function pendingDeck(): Presentation {
  const base = createPresentation({ title: 'Menneskets evolusjon' })
  const leaves = [createLeaf(createImage()), createLeaf(createImage()), createLeaf(createImage())]
  const deck: Presentation = {
    ...base,
    imageContext: 'Fotorealistisk, dempet palett, ingen tekst i bildene.',
    slides: [
      sectionAt(base, 0),
      {
        ...contentAt(base, 1),
        title: titleDoc('Tre arter'),
        root: createSplit('x', [1, 1, 1], leaves),
      },
    ],
  }
  const written = setImagePlan(
    deck,
    leaves.map((leaf, index) => ({
      slideId: deck.slides[1].id,
      nodeId: leaf.id,
      subject: SUBJECTS[index],
      composition: 'Sentrert motiv, rolig bakgrunn.',
      requirements: 'Anatomisk korrekt skjelettbygning for arten som vises.',
      avoid: 'Ingen moderne klær, ingen bygninger.',
    })),
  )
  if (!written.ok) throw new Error(written.error.message)
  return written.value
}

function render(node: React.ReactElement): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(node))
}

/** Radix renders the dialog in a portal, so queries go through the document. */
function find<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Fant ikke ${selector}`)
  return element
}

function all<T extends Element>(selector: string): T[] {
  return [...document.querySelectorAll<T>(selector)]
}

function click(selector: string): void {
  act(() => find<HTMLElement>(selector).click())
}

/** Let the dialog's asynchronous work finish. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

/** A picked file holding these exact bytes. */
function picked(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type })
}

/** Hand the dialog files by object rather than by name. */
function pickFiles(files: readonly File[]): void {
  const input = find<HTMLInputElement>('[data-testid="image-deposit-input"]')
  Object.defineProperty(input, 'files', { value: files, configurable: true, writable: true })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/**
 * Hand the dialog a set of files, the way the file picker does.
 *
 * `FileList` cannot be constructed in jsdom, and a `DataTransfer` cannot
 * either, so the property is defined on the input and the change event is
 * dispatched by hand. What the component reads — `length` and iteration — is
 * exactly what an array gives it.
 */
function pick(names: readonly string[]): void {
  pickFiles(names.map((name) => new File([new Uint8Array([1, 2, 3])], name)))
}

/** The picked files, in the order the dialog will place them. */
function rows(): HTMLElement[] {
  return all<HTMLElement>('[data-testid="image-deposit-files"] > li')
}

function rowNumbers(): (string | null)[] {
  return rows().map((row) => row.getAttribute('data-number'))
}

function rowNames(): string[] {
  return rows().map((row) => row.querySelector('.hint')?.textContent ?? '')
}

/**
 * A clipboard that records rather than a real one.
 *
 * jsdom has neither `navigator.clipboard` nor `document.execCommand`, so
 * without this every copy in a test reports failure — and what is being checked
 * here is precisely the *text* that reaches the clipboard, not that a button
 * was pressed.
 */
function captureClipboard(): { text: () => string } {
  const written: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (text: string) => { written.push(text); return Promise.resolve() } },
    configurable: true,
  })
  clipboardInstalled = true
  return { text: () => written.at(-1) ?? '' }
}

/**
 * A clipboard that refuses, the way a browser without permission does.
 *
 * `document.execCommand` is stubbed too: `copyToClipboard` falls back to it,
 * and a test that relied on jsdom simply not implementing it would be testing
 * the environment rather than the refusal path.
 */
function refuseClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.reject(new Error('Denied')) },
    configurable: true,
  })
  clipboardInstalled = true
  Object.defineProperty(document, 'execCommand', {
    value: () => false,
    configurable: true,
    writable: true,
  })
  execCommandInstalled = true
}

let clipboardInstalled = false
let execCommandInstalled = false

afterEach(() => {
  if (clipboardInstalled) {
    Reflect.deleteProperty(navigator, 'clipboard')
    clipboardInstalled = false
  }
  if (execCommandInstalled) {
    Reflect.deleteProperty(document, 'execCommand')
    execCommandInstalled = false
  }
})

/* ------------------------------------------------------------------ *
 * A pointer that can actually drag
 *
 * jsdom lays nothing out and has no `elementFromPoint`, so a reorder gesture
 * cannot be exercised without giving it a geometry to reason about. What is
 * stubbed is exactly that and nothing else: each row gets a band of 50 pixels,
 * and a point resolves to the row whose band holds it. Everything above —
 * arming, the hold, the placeholder, the drop index, the array move — is the
 * component's own code, driven by real pointer events.
 * ------------------------------------------------------------------ */

const ROW_HEIGHT = 50

function layOutRows(): void {
  const list = find<HTMLElement>('[data-testid="image-deposit-files"]')
  const body = list.closest<HTMLElement>('.dialog__body')
  if (!body) throw new Error('Fant ikke dialogens kropp')
  const boxOf = (top: number, height: number): DOMRect =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 200,
      width: 200,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect

  body.getBoundingClientRect = () => boxOf(0, 1000)
  list.getBoundingClientRect = () => boxOf(0, rows().length * ROW_HEIGHT)
  rows().forEach((row, index) => {
    row.getBoundingClientRect = () => boxOf(index * ROW_HEIGHT, ROW_HEIGHT)
  })
  document.elementFromPoint = (_x: number, y: number): Element | null => {
    const hit = rows()[Math.floor(y / ROW_HEIGHT)]
    return hit ?? list
  }
}

function pointer(type: string, init: PointerEventInit & { pointerType?: string }): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' })
  Object.defineProperty(event, 'isPrimary', { value: true })
  return event
}

/**
 * Drag the row at `from` until the pointer sits inside the band of `to`.
 *
 * `hold` is what makes it a touch gesture: the ideas list waits out a press
 * before it lifts anything, so that a vertical swipe still scrolls, and the
 * deposit inherits that. A mouse lifts as soon as the pointer has moved.
 */
async function dragRow(
  from: number,
  to: number,
  { touch = false }: { touch?: boolean } = {},
): Promise<void> {
  layOutRows()
  const row = rows()[from]
  const startY = from * ROW_HEIGHT + ROW_HEIGHT / 2
  /* The placeholder goes before the first neighbour the pointer is past the
     middle of, so a move up aims at the top of the target band and a move down
     at the bottom of it — which is where a finger actually ends up. */
  const endY = to > from ? to * ROW_HEIGHT + ROW_HEIGHT - 1 : to * ROW_HEIGHT + 1
  const pointerType = touch ? 'touch' : 'mouse'

  act(() => {
    row.dispatchEvent(
      pointer('pointerdown', { clientX: 10, clientY: startY, button: 0, pointerType }),
    )
  })
  if (touch) await settle(260)
  await act(async () => {
    window.dispatchEvent(pointer('pointermove', { clientX: 10, clientY: endY, pointerType }))
  })
  // A touch drag lifts on the hold, so the first move is already the drag; a
  // mouse lifts on that move, and needs a second one to place the row.
  await act(async () => {
    window.dispatchEvent(pointer('pointermove', { clientX: 10, clientY: endY, pointerType }))
  })
  await act(async () => {
    window.dispatchEvent(pointer('pointerup', { clientX: 10, clientY: endY, pointerType }))
  })
  await settle()
}

describe('ImageDepositIntroModal', () => {
  it('tilbyr begge veiene videre, og sier hvor mange bilder det gjelder', () => {
    const choices: string[] = []
    render(
      <ImageDepositIntroModal
        expectedCount={3}
        onGenerate={() => choices.push('generate')}
        onEdit={() => choices.push('edit')}
      />,
    )
    expect(find('[data-testid="image-deposit-intro"]').textContent).toContain('3 bilder')

    click('[data-testid="image-deposit-intro-edit"]')
    click('[data-testid="image-deposit-intro-generate"]')
    expect(choices).toEqual(['edit', 'generate'])
  })
})

describe('ImageBriefModal', () => {
  it('viser hele bestillingen som én tekst, og fører videre til deponering', () => {
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    let wentOn = false
    render(<ImageBriefModal onClose={() => {}} onDeposit={() => (wentOn = true)} />)

    const shown = find<HTMLTextAreaElement>('[data-testid="image-brief-modal-text"]').value
    expect(shown.startsWith('Lag nøyaktig 3 separate bilder')).toBe(true)
    for (const subject of SUBJECTS) expect(shown).toContain(subject)
    expect(find('[data-testid="image-brief-modal-count"]').textContent).toContain('3 bilder')

    click('[data-testid="image-brief-modal-deposit"]')
    expect(wentOn).toBe(true)
  })

  it('kopierer hele seriebriefen, ordrett, som primærhandling', async () => {
    /*
     * The errand the dialog exists for. Ordering the series is one task that
     * produces N files, so what the main button puts on the clipboard is the
     * whole brief — the same text the domain composes for the agent, not a
     * rendering of it.
     */
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    const clipboard = captureClipboard()
    render(<ImageBriefModal onClose={() => {}} />)

    click('[data-testid="image-brief-modal-copy"]')
    await settle()

    const shown = useEditorStore.getState().presentation
    if (!shown) throw new Error('Forventet et dekk i editoren')
    expect(clipboard.text()).toBe(composeImageBrief(shown))
    expect(clipboard.text()).toContain('FELLES BILDEKONTEKST')
    expect(clipboard.text()).toContain('BILDE 2 AV 3')
    // And nothing of Slaids' own bookkeeping travels with it.
    expect(clipboard.text()).not.toContain(deck.slides[1].id)
    expect(clipboard.text()).not.toMatch(/imgplan_|Bildeplan-ID|Filnavn|Skal brukes på slide/i)
  })

  it('tilbyr å lage ett enkelt bilde om igjen, folded away som reparasjonen den er', async () => {
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    const clipboard = captureClipboard()
    render(<ImageBriefModal onClose={() => {}} />)

    const fold = find<HTMLDetailsElement>('[data-testid="image-brief-modal-single"]')
    expect(fold.open).toBe(false)
    expect(fold.textContent).toMatch(/feil ut, eller mangler det/i)

    const list = find('[data-testid="image-brief-modal-list"]')
    expect(list.children).toHaveLength(3)
    expect(list.textContent).toContain('Bilde 2')
    expect(list.textContent).toContain('Motiv nummer 2')
    expect(list.textContent).toMatch(/\d+:\d+/)

    click('[data-testid="image-brief-modal-copy-prompt-2"]')
    await settle()
    const copied = clipboard.text()

    // One picture's whole order: the deck's shared look, this one motif, how it
    // is framed, what it must get right, what to avoid, and the measured format.
    expect(copied).toContain('Fotorealistisk, dempet palett')
    expect(copied).toContain('Motiv nummer 2')
    expect(copied).toContain('Sentrert motiv, rolig bakgrunn.')
    expect(copied).toMatch(/Aspect ratio \d+:\d+/)
    // And nothing that says «one of several».
    expect(copied).not.toContain('Motiv nummer 1')
    expect(copied).not.toContain('Motiv nummer 3')
    expect(copied).not.toMatch(/BILDE \d+ AV \d+/i)
    expect(copied).not.toMatch(/separate bilder/i)
    expect(copied).not.toContain('Tre arter')
    const shown = useEditorStore.getState().presentation
    if (!shown) throw new Error('Forventet et dekk i editoren')
    expect(copied).toBe(
      composeImageGenerationPrompt(resolveImagePlan(shown)[1], shown.imageContext ?? ''),
    )
  })

  it('tilbyr den samme teksten til å merke når nettleseren nekter å kopiere', async () => {
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    refuseClipboard()
    render(<ImageBriefModal onClose={() => {}} />)

    click('[data-testid="image-brief-modal-copy"]')
    await settle()

    expect(find('[data-testid="image-brief-modal-copy-failed"]').textContent).toMatch(
      /tillot ikke kopiering/i,
    )
    const offered = find<HTMLTextAreaElement>('[data-testid="image-brief-modal-copy-fallback"]')
    const shown = useEditorStore.getState().presentation
    if (!shown) throw new Error('Forventet et dekk i editoren')
    expect(offered.value).toBe(composeImageBrief(shown))
    expect(offered.readOnly).toBe(true)
  })

  it('tilbyr ikke deponering når dekket har avsluttet den', () => {
    const given = abandonImageDeposit(pendingDeck())
    if (!given.ok) throw new Error(given.error.message)
    useEditorStore.getState().setPresentation(given.value)
    render(<ImageBriefModal onClose={() => {}} onDeposit={() => {}} />)

    // The brief itself is still there — it is worth reading at any time — but
    // there is nothing left for «bildene er klare» to lead to.
    expect(find<HTMLTextAreaElement>('[data-testid="image-brief-modal-text"]').value).toContain(
      'BILDE 1 AV 3',
    )
    expect(document.querySelector('[data-testid="image-brief-modal-deposit"]')).toBeNull()
  })
})

describe('ImageDepositModal – rekkefølgen fra filnavnene', () => {
  it('sier hvor mange bilder som forventes, og lar ikke fullføre et tomt sett', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('0 av 3 på plass')
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
    expect(find('[data-testid="image-deposit-missing-2"]').textContent).toContain('Motiv nummer 2')
  })

  it('leser 1, 2, 3 av navnene, med blandede filformater', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['1.png', '2.jpg', '3.webp'])

    expect(find('[data-testid="image-deposit-order"]').getAttribute('data-mode')).toBe('numbered')
    expect(find('[data-testid="image-deposit-order"]').textContent).toMatch(/lest fra filnavnene/i)
    expect(rowNumbers()).toEqual(['1', '2', '3'])
    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('3 av 3 på plass')
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(false)
    // The names said it, so nothing is asked of the person.
    expect(document.querySelector('[data-testid="image-deposit-acknowledge"]')).toBeNull()
  })

  it('bryr seg ikke om hvilken rekkefølge de nummererte filene ble valgt i', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['3.webp', '1.png', '2.jpg'])

    expect(find('[data-testid="image-deposit-order"]').getAttribute('data-mode')).toBe('numbered')
    expect(rowNumbers()).toEqual(['3', '1', '2'])
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(false)
  })

  it('viser et ekte miniatyrbilde for hver fil', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['1.png', '2.jpg', '3.webp'])
    const thumbs = all<HTMLImageElement>('[data-testid="image-deposit-files"] img')
    expect(thumbs).toHaveLength(3)
    for (const thumb of thumbs) expect(thumb.getAttribute('src')).toMatch(/^blob:slaids\//)
    // Every picture has its own, so no two rows show the same file.
    expect(new Set(thumbs.map((thumb) => thumb.getAttribute('src'))).size).toBe(3)
  })
})

describe('ImageDepositModal – rekkefølgen fra brukeren', () => {
  it('går til manuell rekkefølge for vilkårlige filnavn, og sier hvorfor', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['IMG_4821.png', 'padmasambhava.webp', 'Screenshot.jpg'])

    const order = find('[data-testid="image-deposit-order"]')
    expect(order.getAttribute('data-mode')).toBe('manual')
    expect(order.textContent).toMatch(/Filnavnene angir ikke rekkefølgen/i)
    expect(order.textContent).toMatch(/Dra bildene i riktig rekkefølge/i)
    expect(rowNumbers()).toEqual(['1', '2', '3'])
    // Each row says which picture it will become, and what that picture is of.
    expect(rows()[1].textContent).toContain('Bilde 2')
    expect(rows()[1].textContent).toContain('Motiv nummer 2')
    expect(rows()[1].textContent).toContain('padmasambhava.webp')
  })

  it('behandler navn som bare ligner på tall som vanlige navn', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['01.png', 'bilde1.png', '1-final.png'])

    expect(find('[data-testid="image-deposit-order"]').getAttribute('data-mode')).toBe('manual')
    expect(rowNumbers()).toEqual(['1', '2', '3'])
    // Not a single one of them is an error.
    expect(rows().every((row) => row.getAttribute('data-problem') === '')).toBe(true)
  })

  it('lar musedrag bytte hvilken fil som blir bilde 1', async () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['IMG_4821.png', 'padmasambhava.webp', 'Screenshot.jpg'])
    expect(rowNames()[0]).toBe('IMG_4821.png')

    await dragRow(2, 0)

    expect(rowNames()).toEqual(['Screenshot.jpg', 'IMG_4821.png', 'padmasambhava.webp'])
    expect(rowNumbers()).toEqual(['1', '2', '3'])
    // Position is the picture number, so the motif beside each row moved too.
    expect(rows()[0].textContent).toContain('Motiv nummer 1')
    expect(rows()[0].textContent).toContain('Screenshot.jpg')
  })

  it('lar det samme skje med en finger, etter et langtrykk', async () => {
    // The ideas list waits out a hold on touch so a swipe still scrolls, and
    // the deposit inherits that: the same gesture, the same feel.
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['a.png', 'b.png', 'c.png'])
    await dragRow(0, 2, { touch: true })

    expect(rowNames()).toEqual(['b.png', 'c.png', 'a.png'])
  })

  it('ber om en bekreftelse på rekkefølgen, og mister den når rekkefølgen endres', async () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['a.png', 'b.png', 'c.png'])
    const finish = () => find<HTMLButtonElement>('[data-testid="image-deposit-finish"]')
    const box = () => find<HTMLInputElement>('[data-testid="image-deposit-acknowledge"] input')
    expect(finish().disabled).toBe(true)

    act(() => box().click())
    expect(finish().disabled).toBe(false)

    await dragRow(2, 0)
    // A different arrangement is a different answer, so it has to be given again.
    expect(box().checked).toBe(false)
    expect(finish().disabled).toBe(true)
  })
})

describe('ImageDepositModal – antallet filer', () => {
  it('lar brukeren legge til flere uten å miste dem hun alt har valgt', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['a.png', 'b.png'])
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
    expect(find('[data-testid="image-deposit-missing-3"]').textContent).toContain('Motiv nummer 3')

    pick(['c.png'])
    expect(rowNames()).toEqual(['a.png', 'b.png', 'c.png'])
    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('3 av 3 på plass')
  })

  it('stopper «Fullfør» til den overskytende filen er fjernet', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['a.png', 'b.png', 'c.png', 'd.png'])
    expect(rowNumbers()).toEqual(['1', '2', '3', ''])
    expect(rows()[3].getAttribute('data-problem')).toBe('EXCESS')
    expect(rows()[3].textContent).toMatch(/flere bilder enn presentasjonen har plass til/i)
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)

    act(() => find<HTMLElement>('[aria-label="Fjern d.png"]').click())
    const box = find<HTMLInputElement>('[data-testid="image-deposit-acknowledge"] input')
    act(() => box.click())
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(false)
  })

  it('avviser en fil som ikke er et bilde, uten å la den ta en bildeplass', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['a.png', 'notat.txt', 'b.png', 'c.png'])
    expect(rowNumbers()).toEqual(['1', '', '2', '3'])
    expect(rows()[1].getAttribute('data-problem')).toBe('TYPE')
    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('3 av 3 på plass')
    // Complete, and still refused: something in the drop cannot be used.
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * Fullføringen
 *
 * The write itself, against a real store: «alle eller ingen» is a promise about
 * the slides *and* about storage, and the only way to check the second half is
 * to count what is actually in it afterwards.
 * ------------------------------------------------------------------ */

/** Put a deck waiting for three pictures in the store and in the editor. */
async function openPendingDeck(repository: DexieSlaidsRepository): Promise<Presentation> {
  const deck = pendingDeck()
  await repository.savePresentation(deck)
  act(() => useEditorStore.getState().setPresentation(deck))
  return deck
}

/**
 * Run the deposit and wait for it to finish, however it finishes.
 *
 * The button's own label is the signal: `complete()` sets it to «Setter inn …»
 * synchronously before the first upload and puts it back in its `finally`, so
 * waiting for it to change back covers the committed path and every refusal
 * alike — including the rollback, which happens after that.
 */
async function waitForIdle(): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const label = document.querySelector('[data-testid="image-deposit-finish"]')?.textContent ?? ''
    if (!label.includes('Setter inn')) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2))
    })
  }
  throw new Error('Deponeringen ble aldri ferdig')
}

async function runDeposit(): Promise<void> {
  click('[data-testid="image-deposit-finish"]')
  await waitForIdle()
}

describe('ImageDepositModal – fullføring', () => {
  it('lagrer filene og setter hvert bilde i sonen det ble bestilt for', async () => {
    const { repository, database } = freshRepository()
    await openPendingDeck(repository)
    render(<ImageDepositModal onClose={() => {}} />)

    pickFiles([
      picked(realImages.png(), '1.png', 'image/png'),
      picked(realImages.jpeg(), '2.jpg', 'image/jpeg'),
      picked(realImages.gif(), '3.gif', 'image/gif'),
    ])
    await runDeposit()

    const after = useEditorStore.getState().presentation as Presentation
    expect(after.imageDeposit).toEqual({ status: 'completed', expectedCount: 3 })
    expect(after.assets).toHaveLength(3)
    expect(await database.assets.count()).toBe(3)
  })

  it('følger den manuelle rekkefølgen når filnavnene ikke sier noe', async () => {
    /*
     * The end-to-end claim of the manual mode: the person's arrangement is what
     * decides which bytes land in which zone, and a name that says nothing has
     * no say in it.
     */
    const { repository } = freshRepository()
    await openPendingDeck(repository)
    render(<ImageDepositModal onClose={() => {}} />)

    pickFiles([
      picked(realImages.png(), 'IMG_4821.png', 'image/png'),
      picked(realImages.jpeg(), 'padmasambhava.jpg', 'image/jpeg'),
      picked(realImages.gif(), 'Screenshot.gif', 'image/gif'),
    ])
    // The GIF is the first picture, not the third.
    await dragRow(2, 0)
    act(() => find<HTMLInputElement>('[data-testid="image-deposit-acknowledge"] input').click())
    await runDeposit()

    const after = useEditorStore.getState().presentation as Presentation
    expect(after.imageDeposit).toEqual({ status: 'completed', expectedCount: 3 })
    const slide = after.slides[1]
    if (slide.kind !== 'content' || slide.root.kind !== 'split') throw new Error('Forventet split')
    const assetOf = (index: number): string | null => {
      const leaf = slide.root.kind === 'split' ? slide.root.children[index] : null
      if (!leaf || leaf.kind !== 'leaf' || !leaf.content || !('image' in leaf.content)) return null
      return leaf.content.image.assetId
    }
    const byId = new Map(after.assets.map((asset) => [asset.id, asset]))
    expect(byId.get(assetOf(0) ?? '')?.mimeType).toBe('image/gif')
    expect(byId.get(assetOf(1) ?? '')?.mimeType).toBe('image/png')
    expect(byId.get(assetOf(2) ?? '')?.mimeType).toBe('image/jpeg')
  })

  it('skriver ingenting, og lar ingen filer ligge igjen, når dekket flyttes under opplastingen', async () => {
    const { repository, database } = freshRepository()
    const deck = await openPendingDeck(repository)
    // Something to step back to: the hazard needs a history to move through.
    act(() => {
      useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    })
    render(<ImageDepositModal onClose={() => {}} />)

    pickFiles([
      picked(realImages.png(), '1.png', 'image/png'),
      picked(realImages.jpeg(), '2.jpg', 'image/jpeg'),
      picked(realImages.gif(), '3.gif', 'image/gif'),
    ])

    // Ctrl+Z reaches the deck even while this dialog is open, and the uploads
    // are already in flight when it lands.
    click('[data-testid="image-deposit-finish"]')
    act(() => useEditorStore.getState().undo())
    await waitForIdle()

    const after = useEditorStore.getState().presentation as Presentation
    // The document the user stepped back to, untouched — not the one the
    // uploads were computed against.
    expect(after).toBe(deck)
    expect(after.assets).toEqual([])
    expect(depositIsOpen(after)).toBe(true)
    // And nothing was left in the store for a deposit that never landed.
    expect(await database.assets.count()).toBe(0)
  })

  it('rydder bort filene som allerede var lagret når en senere fil avvises', async () => {
    const { repository, database } = freshRepository()
    await openPendingDeck(repository)
    render(<ImageDepositModal onClose={() => {}} />)

    // A correctly named file that is not a picture at all: the name passes, and
    // the door refuses it once the bytes are read — after picture 1 is stored.
    pickFiles([
      picked(realImages.png(), '1.png', 'image/png'),
      new File(['ikke et bilde'], '2.png', { type: 'image/png' }),
      picked(realImages.gif(), '3.gif', 'image/gif'),
    ])
    await runDeposit()

    const after = useEditorStore.getState().presentation as Presentation
    expect(after.imageDeposit?.status).toBe('pending')
    expect(after.assets).toEqual([])
    expect(await database.assets.count()).toBe(0)
  })
})
