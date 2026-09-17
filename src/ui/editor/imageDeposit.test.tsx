/**
 * The two screens of the image deposit, in a real DOM.
 *
 * What is pinned here is what a person can actually do wrong, and what the
 * screens must not let them do:
 *
 *  - the deck that is waiting for pictures offers *both* ways on, and going to
 *    the editor is not a decision about the deposit;
 *  - the brief lists the pictures by number, so «bilde 3» can be checked before
 *    three files are made;
 *  - «Fullfør» is not reachable for a set that is short, misnamed or in
 *    conflict — the disabled button is the same domain verdict the command
 *    refuses on, seen from the other side.
 */

import { afterEach, describe, expect, it } from 'vitest'
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
import { hashBytes } from '../../domain/assetHash'
import {
  composeImageGenerationManifest,
  IMAGE_MANIFEST_FILE_NAME,
  type GeneratedImageRecord,
} from '../../domain/imageGeneration'
import { resolveImagePlan } from '../../domain/imagePlan'
import type { Presentation } from '../../domain/types'
import { useEditorStore } from '../../state/store'
import { ImageBriefModal } from './ImageBriefModal'
import { ImageDepositIntroModal } from './ImageDepositIntroModal'
import { ImageDepositModal } from './ImageDepositModal'

let container: HTMLDivElement | null = null
let root: Root | null = null

let counter = 0
const databases: SlaidsDatabase[] = []

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
      subject: `Motiv nummer ${index + 1}, tydelig forskjellig fra de andre`,
      composition: 'Sentrert motiv, rolig bakgrunn.',
      requirements: '',
      avoid: '',
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

function click(selector: string): void {
  act(() => find<HTMLElement>(selector).click())
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
  const input = find<HTMLInputElement>('[data-testid="image-deposit-input"]')
  const files = names.map((name) => new File([new Uint8Array([1, 2, 3])], name))
  Object.defineProperty(input, 'files', { value: files, configurable: true, writable: true })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/**
 * Hand the dialog pictures *and* a manifest, and let the read settle.
 *
 * The manifest is read asynchronously — it is a file on disk — so the dialog is
 * deliberately not ready until it has been. Flushing here is what lets a test
 * assert the state after the read rather than during it.
 */
async function pickText(
  pictures: readonly { name: string; bytes: Uint8Array }[],
  manifest: string,
): Promise<void> {
  const input = find<HTMLInputElement>('[data-testid="image-deposit-input"]')
  const files = [
    ...pictures.map((file) => picked(file.bytes, file.name, 'image/png')),
    new File([manifest], IMAGE_MANIFEST_FILE_NAME, { type: 'application/json' }),
  ]
  Object.defineProperty(input, 'files', { value: files, configurable: true, writable: true })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  /* Two reads have to settle, not one: the manifest's text and every picture's
     own digest. Both are async, and the dialog is deliberately not ready until
     they land — so a test that asserted before them would be asserting on the
     loading state. */
  await settle()
  await settle()
}

/** Three genuinely different pictures, so a swap between two of them is real. */
const PICTURES = [realImages.png, realImages.jpeg, realImages.webp]

/** Let the dialog's asynchronous reads finish. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * The same, with the manifest derived from the deck's own plan and then bent.
 *
 * `bytesFor` is separate from `bend` on purpose: the failure worth testing here
 * is a manifest that is *right* about files whose contents were exchanged, so
 * the test has to be able to move the bytes without touching a record.
 */
async function pickWithManifest(
  deck: Presentation,
  bend: (record: GeneratedImageRecord) => GeneratedImageRecord = (record) => record,
  bytesFor: (index: number) => Uint8Array = (index) => PICTURES[index % 3](),
): Promise<void> {
  const images = await Promise.all(
    resolveImagePlan(deck).map(async (image, index) =>
      bend({
        imagePlanItemId: image.id,
        number: image.number,
        slideId: image.plan.slideId,
        nodeId: image.plan.nodeId,
        fileName: `${image.fileNameStem}.png`,
        contentHash: await hashBytes(PICTURES[index % 3]()),
      }),
    ),
  )
  await pickText(
    images.map((image, index) => ({ name: image.fileName, bytes: bytesFor(index) })),
    composeImageGenerationManifest({ presentationId: deck.id, images }),
  )
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
  it('lister bildene med nummer, format og beskrivelse, og fører videre til deponering', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    let wentOn = false
    render(<ImageBriefModal onClose={() => {}} onDeposit={() => (wentOn = true)} />)

    const list = find('[data-testid="image-brief-modal-list"]')
    expect(list.children).toHaveLength(3)
    expect(list.textContent).toContain('Bilde 2')
    expect(list.textContent).toContain('Motiv nummer 2')
    expect(list.textContent).toMatch(/\d+:\d+/)

    click('[data-testid="image-brief-modal-deposit"]')
    expect(wentOn).toBe(true)
  })

  it('tilbyr ikke deponering når dekket har avsluttet den', () => {
    const given = abandonImageDeposit(pendingDeck())
    if (!given.ok) throw new Error(given.error.message)
    useEditorStore.getState().setPresentation(given.value)
    render(<ImageBriefModal onClose={() => {}} onDeposit={() => {}} />)

    // The brief itself is still there — it is worth reading at any time — but
    // there is nothing left for «bildene er klare» to lead to.
    expect(find('[data-testid="image-brief-modal-list"]').children).toHaveLength(3)
    expect(document.querySelector('[data-testid="image-brief-modal-deposit"]')).toBeNull()
  })
})

describe('ImageDepositModal', () => {
  it('sier hvor mange bilder som forventes, og lar ikke fullføre et tomt sett', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('0 av 3 på plass')
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
    expect(find('[data-testid="image-deposit-row-2"]').getAttribute('data-state')).toBe('missing')
  })

  it('godtar 1, 2, 3 med blandede filformater', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['1.png', '2.jpg', '3.webp'])

    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('3 av 3 på plass')
    expect(find('[data-testid="image-deposit-row-1"]').getAttribute('data-state')).toBe('ready')
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(false)
    expect(document.querySelector('[data-testid="image-deposit-problems"]')).toBeNull()
  })

  it('avviser filnavn som ikke er et rent tall, og sier hvorfor', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['01.png', 'bilde1.png', '1a.png', '2.png', '3.png'])

    const problems = find('[data-testid="image-deposit-problems"]')
    expect(problems.children).toHaveLength(3)
    expect(problems.textContent).toContain('01.png')
    expect(problems.textContent).toContain('Feil filnavn')
    expect(find('[data-testid="image-deposit-row-1"]').getAttribute('data-state')).toBe('missing')
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
  })

  it('oppdager to filer med det samme nummeret', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['1.jpg', '1.png', '2.png', '3.png'])

    const problems = find('[data-testid="image-deposit-problems"]')
    expect(problems.textContent).toContain('samme nummeret')
    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('2 av 3 på plass')
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
  })

  it('kontrollerer koblingen mot filenes innhold når manifestet følger med', async () => {
    // The manifest is the agent flow's binding, and the dialog's job is to
    // check it rather than trust the file names: nine pictures named by arrival
    // are nine well-formed names for the wrong pictures.
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    render(<ImageDepositModal onClose={() => {}} />)

    await pickWithManifest(deck)
    expect(find('[data-testid="image-deposit-manifest"]').textContent).toContain(
      'slaids-bilder.json',
    )
    const assurance = find('[data-testid="image-deposit-assurance"]')
    expect(assurance.getAttribute('data-assurance')).toBe('file-checked')
    // And the dialog keeps «which file» apart from «what the picture shows».
    expect(assurance.textContent).toMatch(/ikke hva bildet viser/)
    expect(document.querySelector('[data-testid="image-deposit-binding"]')).toBeNull()
    expect(document.querySelector('[data-testid="image-deposit-acknowledge"]')).toBeNull()
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(false)
  })

  it('stopper to filer som har byttet innhold, med navn og manifest urørt', async () => {
    // The delivery every name-based check calls correct. The dialog must not,
    // and the button must stay out of reach — there is no partial insertion to
    // be had here, because «Fullfør» is the only way in.
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    render(<ImageDepositModal onClose={() => {}} />)

    await pickWithManifest(deck, (record) => record, (index) =>
      index === 0 ? PICTURES[1]() : index === 1 ? PICTURES[0]() : PICTURES[2](),
    )

    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('3 av 3 på plass')
    expect(document.querySelector('[data-testid="image-deposit-problems"]')).toBeNull()
    const binding = find('[data-testid="image-deposit-binding"]')
    expect(binding.textContent).toMatch(/inneholder ikke de bytene/)
    expect(binding.children).toHaveLength(2)
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
  })

  it('krever en uttrykkelig bekreftelse når koblingen ikke kan kontrolleres', async () => {
    // A host that cannot reach the bytes of what its image tool produced is not
    // refused — it is unverified, and the honest response is to say so and ask
    // for the one check a person can still make.
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    render(<ImageDepositModal onClose={() => {}} />)

    await pickWithManifest(deck, (record) => ({ ...record, contentHash: undefined }))

    const assurance = find('[data-testid="image-deposit-assurance"]')
    expect(assurance.getAttribute('data-assurance')).toBe('unchecked')
    expect(assurance.textContent).toMatch(/ikke verifisert/)
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)

    const box = find<HTMLInputElement>('[data-testid="image-deposit-acknowledge"] input')
    act(() => box.click())
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(false)
  })

  it('krever ingen bekreftelse for vanlig manuell opplasting', async () => {
    // The flow the deposit was built for, unchanged: a person who saved «bilde
    // 3» as `3.png` made the binding, and asking them to tick a box for it
    // would be a regression dressed as rigour.
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['1.png', '2.jpg', '3.webp'])
    await settle()

    expect(find('[data-testid="image-deposit-assurance"]').getAttribute('data-assurance')).toBe(
      'manual',
    )
    expect(document.querySelector('[data-testid="image-deposit-acknowledge"]')).toBeNull()
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(false)
  })

  it('stopper deponeringen når manifestet og bildeplanen er uenige', async () => {
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    render(<ImageDepositModal onClose={() => {}} />)

    // Three well-formed files, the right count, the right names — and picture 2
    // bound to the wrong entry. This is the delivery the dialog used to accept.
    await pickWithManifest(deck, (image) =>
      image.number === 2 ? { ...image, number: 3 } : image,
    )

    const binding = find('[data-testid="image-deposit-binding"]')
    expect(binding.children.length).toBeGreaterThan(0)
    expect(document.querySelector('[data-testid="image-deposit-problems"]')).toBeNull()
    expect(find('[data-testid="image-deposit-progress"]').textContent).toBe('3 av 3 på plass')
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
  })

  it('behandler et uleselig manifest som en ukjent kobling', async () => {
    const deck = pendingDeck()
    useEditorStore.getState().setPresentation(deck)
    render(<ImageDepositModal onClose={() => {}} />)

    await pickText(
      ['1.png', '2.png', '3.png'].map((name, index) => ({ name, bytes: PICTURES[index]() })),
      '{ ikke json',
    )
    expect(find('[data-testid="image-deposit-binding"]').children).toHaveLength(1)
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)
  })

  it('er fortsatt ikke klar når ett nummer mangler', () => {
    useEditorStore.getState().setPresentation(pendingDeck())
    render(<ImageDepositModal onClose={() => {}} />)

    pick(['1.png', '2.png'])
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(true)

    // Files arrive in more than one go, so a second pick adds rather than replaces.
    pick(['3.png'])
    expect(find<HTMLButtonElement>('[data-testid="image-deposit-finish"]').disabled).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * Fullføringen
 *
 * The write itself, against a real store: «alle eller ingen» is a promise about
 * the slides *and* about storage, and the only way to check the second half is
 * to count what is actually in it afterwards.
 * ------------------------------------------------------------------ */

/** A picked file holding these exact bytes. */
function picked(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type })
}

/** Put a deck waiting for three pictures in the store and in the editor. */
async function openPendingDeck(repository: DexieSlaidsRepository): Promise<Presentation> {
  const deck = pendingDeck()
  await repository.savePresentation(deck)
  act(() => useEditorStore.getState().setPresentation(deck))
  return deck
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
