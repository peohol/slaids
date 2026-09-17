/**
 * The image deposit: the numbers, the file names, and the one-way door.
 *
 * Three claims are worth pinning, because each of them is a way the workflow
 * could quietly do the wrong thing rather than fail:
 *
 *  - **the numbering is the brief's own.** Writing the plan stamps the
 *    placeholder caption, the brief section and the panel's deposit number from
 *    one pass, so a file called `3.png` cannot land in the zone the brief calls
 *    picture 2;
 *  - **nothing is guessed from a file name.** `01.png` and `bilde1.png` are
 *    rejected rather than matched, and two files claiming one number are both
 *    flagged rather than one of them silently winning;
 *  - **`completed` and `abandoned` are final.** Re-planning, re-syncing and
 *    calling the commands again all leave a closed deposit closed, which is the
 *    promise the dialog on the structural edit is making.
 */

import { describe, expect, it } from 'vitest'
import { setImagePlan, syncImagePlaceholders } from './commands/imagePlan'
import {
  abandonImageDeposit,
  completeImageDeposit,
  openImageDeposit,
} from './commands/imageDeposit'
import { setContentKind, setImageAsset } from './commands/content'
import { deleteLayoutNode } from './commands/layout'
import { placeSandboxItem } from './commands/sandbox'
import { buildSharedSnapshot } from './sharing'
import { registerAsset } from './commands/assets'
import { createImage } from './content'
import { createLeaf, createSplit } from './layout'
import { createPresentation } from './presentation'
import { titleDoc } from './richdoc'
import { validatePresentation } from './schema'
import { contentAt, sectionAt } from './testDecks'
import { realImages } from './testImages'
import {
  depositImages,
  depositIsOpen,
  depositIsWaiting,
  depositSlots,
  reviewDeposit,
  reviewDepositFiles,
} from './imageDeposit'
import { hashBytes } from './assetHash'
import {
  composeImageGenerationManifest,
  type DeliveredImageFile,
  type GeneratedImageRecord,
} from './imageGeneration'
import { imageFileNumber, resolveImagePlan } from './imagePlan'
import type { AssetRef, PlannedImage, Presentation } from './types'

const CONTEXT = 'Fotorealistiske rekonstruksjoner, naturlig dagslys, ingen tekst i bildene.'

/** Three side-by-side picture zones on one content slide. */
function threeZones(): { deck: Presentation; slideId: string; nodeIds: string[] } {
  const leaves = [createLeaf(createImage()), createLeaf(createImage()), createLeaf(createImage())]
  const base = createPresentation({ title: 'Menneskets evolusjon' })
  const root = createSplit('x', [1, 1, 1], leaves)
  const deck: Presentation = {
    ...base,
    imageContext: CONTEXT,
    slides: [sectionAt(base, 0), { ...contentAt(base, 1), title: titleDoc('Tre arter'), root }],
  }
  return { deck, slideId: deck.slides[1].id, nodeIds: leaves.map((leaf) => leaf.id) }
}

function entry(slideId: string, nodeId: string, subject: string): PlannedImage {
  return {
    slideId,
    nodeId,
    subject,
    composition: 'Motivet sentrert, rolig bakgrunn.',
    requirements: '',
    avoid: '',
  }
}

/** A deck with three planned, numbered, unfilled picture zones. */
function pendingDeck(): { deck: Presentation; slideId: string; nodeIds: string[] } {
  const { deck, slideId, nodeIds } = threeZones()
  const written = setImagePlan(deck, [
    entry(slideId, nodeIds[0], 'Australopithecus afarensis i savannelandskap'),
    entry(slideId, nodeIds[1], 'Homo erectus som bearbeider en håndøks'),
    entry(slideId, nodeIds[2], 'Homo sapiens som maler på en hulevegg'),
  ])
  if (!written.ok) throw new Error(written.error.message)
  return { deck: written.value, slideId, nodeIds }
}

function asset(id: string): AssetRef {
  return {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 128,
    width: 1200,
    height: 800,
    isVector: false,
  }
}

/** Register the files a deposit is about to place, as the dialog does first. */
function withAssets(deck: Presentation, ids: readonly string[]): Presentation {
  let current = deck
  for (const id of ids) {
    const registered = registerAsset(current, asset(id))
    if (!registered.ok) throw new Error(registered.error.message)
    current = registered.value
  }
  return current
}

describe('åpning av deponeringen', () => {
  it('nummererer bildesonene i dekkets rekkefølge når bildeplanen skrives', () => {
    const { deck, nodeIds } = pendingDeck()
    expect(deck.imageDeposit).toEqual({ status: 'pending', expectedCount: 3 })
    expect(depositSlots(deck).map((slot) => [slot.index, slot.nodeId])).toEqual([
      [1, nodeIds[0]],
      [2, nodeIds[1]],
      [3, nodeIds[2]],
    ])
  })

  it('gir hvert bilde det samme nummeret som briefen bruker', () => {
    const { deck } = pendingDeck()
    // The one claim the whole workflow rests on: the number on the panel, the
    // number in the brief and the number in the placeholder are one number.
    for (const image of resolveImagePlan(deck)) {
      const slot = depositSlots(deck).find((candidate) => candidate.nodeId === image.plan.nodeId)
      expect(slot?.index).toBe(image.number)
    }
  })

  it('er idempotent: et dekk som allerede er stemplet kommer uendret tilbake', () => {
    const { deck } = pendingDeck()
    expect(openImageDeposit(deck)).toBe(deck)
    const synced = syncImagePlaceholders(deck)
    expect(synced.ok && synced.value).toBe(deck)
  })

  it('fjerner deponeringen når dekket ikke planlegger bilder lenger', () => {
    const { deck, slideId, nodeIds } = pendingDeck()
    const cleared = setImagePlan(deck, [entry(slideId, nodeIds[0], 'Ett enkelt motiv')])
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.value.imageDeposit).toEqual({ status: 'pending', expectedCount: 1 })
    expect(depositSlots(cleared.value)).toHaveLength(1)

    const none = setImagePlan(cleared.value, [])
    expect(none.ok).toBe(true)
    if (!none.ok) return
    expect(none.value.imageDeposit).toBeUndefined()
    expect(depositSlots(none.value)).toEqual([])
  })

  it('lagres og leses tilbake gjennom skjemaet', () => {
    const { deck } = pendingDeck()
    const parsed = validatePresentation(JSON.parse(JSON.stringify(deck)))
    expect(parsed.ok).toBe(true)
    expect(parsed.value?.imageDeposit).toEqual({ status: 'pending', expectedCount: 3 })
    expect(parsed.value && depositIsOpen(parsed.value)).toBe(true)
  })
})

describe('når deponeringen er gyldig', () => {
  it('er åpen så lenge de nummererte sonene staver 1..N', () => {
    const { deck } = pendingDeck()
    expect(depositIsOpen(deck)).toBe(true)
    expect(depositIsWaiting(deck)).toBe(true)
  })

  it('brytes når en nummerert bildesone slettes', () => {
    const { deck, slideId, nodeIds } = pendingDeck()
    const deleted = deleteLayoutNode(deck, {
      slideId,
      nodeId: nodeIds[1],
      contentDisposition: 'delete',
    })
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(depositIsOpen(deleted.value.presentation)).toBe(false)
  })

  it('brytes når en nummerert bildesone får en annen innholdstype', () => {
    const { deck, slideId, nodeIds } = pendingDeck()
    const converted = setContentKind(deck, {
      slideId,
      nodeId: nodeIds[2],
      kind: 'titled-card',
    })
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    expect(depositIsOpen(converted.value)).toBe(false)
  })

  it('er fortsatt åpen, men ikke ventende, når hver sone er fylt for hånd', () => {
    const { deck, slideId, nodeIds } = pendingDeck()
    let current = withAssets(deck, ['a_1', 'a_2', 'a_3'])
    nodeIds.forEach((nodeId, index) => {
      const written = setImageAsset(current, { slideId, nodeId, assetId: `a_${index + 1}` })
      if (!written.ok) throw new Error(written.error.message)
      current = written.value
    })
    // The numbers are untouched — nothing structural happened — but there is
    // nothing left to ask the author for.
    expect(depositIsOpen(current)).toBe(true)
    expect(depositIsWaiting(current)).toBe(false)
  })
})

describe('filnavnene', () => {
  it('godtar et rent tall med en støttet filendelse', () => {
    expect(imageFileNumber('1.png')).toBe(1)
    expect(imageFileNumber('2.JPG')).toBe(2)
    expect(imageFileNumber('12.webp')).toBe(12)
    expect(imageFileNumber('3.svg')).toBe(3)
  })

  it('avviser alt annet enn et rent tall', () => {
    // Leading zeros are refused rather than trimmed: `01.png` and `1.png` in
    // one folder are two files for one picture, and a rule that took both would
    // have to guess which one was meant.
    expect(imageFileNumber('01.png')).toBeNull()
    expect(imageFileNumber('bilde1.png')).toBeNull()
    expect(imageFileNumber('1a.png')).toBeNull()
    expect(imageFileNumber('1')).toBeNull()
    expect(imageFileNumber('1.txt')).toBeNull()
    expect(imageFileNumber('1.png.png')).toBeNull()
    expect(imageFileNumber('0.png')).toBeNull()
    expect(imageFileNumber('')).toBeNull()
  })

  it('leser bare siste ledd når nettleseren leverer en mappesti', () => {
    expect(imageFileNumber('bilder/2.png')).toBe(2)
  })
})

describe('gjennomgangen av de valgte filene', () => {
  it('sier hvilke numre som er på plass og hvilke som mangler', () => {
    const review = reviewDepositFiles(['1.png', '3.webp'], 3)
    expect(review.present).toEqual([1, 3])
    expect(review.missing).toEqual([2])
    expect(review.ready).toBe(false)
  })

  it('markerer begge filene når to krever det samme nummeret', () => {
    const review = reviewDepositFiles(['1.jpg', '1.png', '2.png', '3.png'], 3)
    expect(review.files.filter((file) => file.problem === 'DUPLICATE').map((file) => file.name)).toEqual([
      '1.jpg',
      '1.png',
    ])
    // Neither is chosen, so the number is not present and the set is not ready.
    expect(review.present).toEqual([2, 3])
    expect(review.ready).toBe(false)
  })

  it('skiller mellom feil navn og feil nummer', () => {
    const review = reviewDepositFiles(['01.png', '9.png'], 3)
    expect(review.files.map((file) => file.problem)).toEqual(['NAME', 'RANGE'])
    expect(review.ready).toBe(false)
  })

  it('er klar først når nøyaktig 1..N er der uten feil', () => {
    expect(reviewDepositFiles(['1.png', '2.jpg', '3.webp'], 3).ready).toBe(true)
    // Blandede formater er hele poenget, men en ekstra fil er fortsatt en feil.
    expect(reviewDepositFiles(['1.png', '2.jpg', '3.webp', 'notat.txt'], 3).ready).toBe(false)
    expect(reviewDepositFiles([], 3).ready).toBe(false)
    expect(reviewDepositFiles([], 0).ready).toBe(false)
  })
})

describe('de to flytene: manuell opplasting og agentgenererte bilder', () => {
  /** Three different pictures, so a swap between two of them is a real swap. */
  const PICTURES = [realImages.png, realImages.jpeg, realImages.webp]

  /** The files as the dialog hands them over: a name and a digest of the bytes. */
  async function files(
    names: readonly string[],
    bytesFor: (index: number) => Uint8Array = (index) => PICTURES[index % 3](),
  ): Promise<DeliveredImageFile[]> {
    return Promise.all(
      names.map(async (fileName, index) => ({
        fileName,
        contentHash: await hashBytes(bytesFor(index)),
      })),
    )
  }

  /** The manifest an agent would hand over, with the bindings it recorded. */
  async function manifest(
    deck: Presentation,
    bind: (
      image: ReturnType<typeof resolveImagePlan>[number],
      index: number,
    ) => Partial<GeneratedImageRecord> = () => ({}),
  ): Promise<string> {
    const images = await Promise.all(
      resolveImagePlan(deck).map(async (image, index) => ({
        imagePlanItemId: image.id,
        number: image.number,
        slideId: image.plan.slideId,
        nodeId: image.plan.nodeId,
        fileName: `${image.fileNameStem}.png`,
        contentHash: await hashBytes(PICTURES[index % 3]()),
        ...bind(image, index),
      })),
    )
    return composeImageGenerationManifest({ presentationId: deck.id, images })
  }

  it('lar manuell opplasting uten metadata fungere som før', async () => {
    // The file name *is* the binding when a person made it, and there is nothing
    // to cross-check it against. Demanding a manifest here would break the flow
    // the deposit was built for.
    const { deck } = pendingDeck()
    const review = reviewDeposit(deck, await files(['1.png', '2.jpg', '3.webp']), null)
    expect(review.assurance).toBe('manual')
    expect(review.binding).toEqual([])
    expect(review.ready).toBe(true)
  })

  it('kontrollerer koblingen mot filenes innhold når manifestet følger med', async () => {
    const { deck } = pendingDeck()
    const review = reviewDeposit(
      deck,
      await files(['1.png', '2.png', '3.png']),
      await manifest(deck),
    )
    expect(review.assurance).toBe('file-checked')
    expect(review.binding).toEqual([])
    expect(review.ready).toBe(true)
  })

  it('stopper deponeringen når manifestet og planen er uenige', () => {
    // Well-formed files, the right count, the right names — and one picture
    // bound to the wrong entry. This is the delivery the old dialog accepted.
    const { deck } = pendingDeck()
    return manifest(deck, (image) => (image.number === 2 ? { number: 3 } : {})).then(
      async (text) => {
        const review = reviewDeposit(deck, await files(['1.png', '2.png', '3.png']), text)
        expect(review.missing).toEqual([])
        expect(review.files.every((file) => file.problem === null)).toBe(true)
        expect(review.binding.length).toBeGreaterThan(0)
        expect(review.ready).toBe(false)
      },
    )
  })

  it('stopper to filer som har byttet innhold, med navn og manifest urørt', async () => {
    // Nothing in the metadata has moved: the same three names, the same three
    // records, the same count. Only the bytes behind `1.png` and `2.png` have
    // changed places — which is the whole delivery the names cannot see.
    const { deck } = pendingDeck()
    const swapped = await files(['1.png', '2.png', '3.png'], (index) =>
      index === 0 ? PICTURES[1]() : index === 1 ? PICTURES[0]() : PICTURES[2](),
    )
    const review = reviewDeposit(deck, swapped, await manifest(deck))

    expect(review.files.every((file) => file.problem === null)).toBe(true)
    expect(review.missing).toEqual([])
    expect(review.binding.map((issue) => issue.code)).toEqual([
      'CONTENT_MISMATCH',
      'CONTENT_MISMATCH',
    ])
    // The whole set, not the two files: `ready` is what the dialog gates on and
    // what the command refuses, so nothing lands — not even the one that matched.
    expect(review.ready).toBe(false)
  })

  it('kaller en levering uten avtrykk uverifisert, ikke kontrollert', async () => {
    const { deck } = pendingDeck()
    const bare = await manifest(deck, () => ({ contentHash: undefined }))
    const review = reviewDeposit(deck, await files(['1.png', '2.png', '3.png']), bare)

    // Consistent, complete, and nobody compared it to anything. It may still be
    // deposited — refusing every host that cannot reach its own bytes would push
    // people back to naming files by hand — but it is never called checked.
    expect(review.binding).toEqual([])
    expect(review.ready).toBe(true)
    expect(review.assurance).toBe('unchecked')
  })

  it('behandler et uleselig manifest som en ukjent kobling, ikke som ingen kobling', async () => {
    const { deck } = pendingDeck()
    const review = reviewDeposit(deck, await files(['1.png', '2.png', '3.png']), '{ ikke json')
    expect(review.assurance).toBe('unchecked')
    expect(review.binding).toHaveLength(1)
    expect(review.ready).toBe(false)
  })

  it('stopper et manifest som hører til et annet dekk', async () => {
    const { deck } = pendingDeck()
    const other = composeImageGenerationManifest({
      ...JSON.parse(await manifest(deck)),
      presentationId: 'p_et_annet_dekk',
    })
    const review = reviewDeposit(deck, await files(['1.png', '2.png', '3.png']), other)
    expect(review.binding.map((issue) => issue.code)).toEqual(['WRONG_PRESENTATION'])
    expect(review.ready).toBe(false)
  })

  it('melder en fil som er levert uten å høre til noe generert bilde', async () => {
    const { deck } = pendingDeck()
    const review = reviewDeposit(
      deck,
      await files(['1.png', '2.png', '3.png', '4.png']),
      await manifest(deck),
    )
    // `4.png` is out of range as a name *and* unaccounted for as a binding, and
    // both are said: the two answers are «remove it» and «it was never made».
    expect(review.files.map((file) => file.problem)).toContain('RANGE')
    expect(review.binding.map((issue) => issue.code)).toContain('FILE_UNACCOUNTED')
    expect(review.ready).toBe(false)
  })
})

describe('listen brukeren leser', () => {
  it('viser indeks, kort beskrivelse og ønsket bildeforhold', () => {
    const { deck } = pendingDeck()
    const images = depositImages(deck)
    expect(images.map((image) => image.index)).toEqual([1, 2, 3])
    expect(images[1].generationBrief).toBe('Homo erectus som bearbeider en håndøks')
    expect(images[1].desiredAspectRatio).toMatch(/^\d+:\d+$/)
    expect(images[0].slideLabel).toBe('Tre arter')
    expect(images.every((image) => !image.filled)).toBe(true)
  })
})

describe('fullføring', () => {
  it('legger hvert bilde i sonen det ble bestilt for, og lukker deponeringen', () => {
    const { deck, nodeIds } = pendingDeck()
    const ready = withAssets(deck, ['a_1', 'a_2', 'a_3'])
    const done = completeImageDeposit(ready, [
      { index: 3, assetId: 'a_3' },
      { index: 1, assetId: 'a_1' },
      { index: 2, assetId: 'a_2' },
    ])
    expect(done.ok).toBe(true)
    if (!done.ok) return

    const slide = done.value.slides[1]
    if (slide.kind !== 'content' || slide.root.kind !== 'split') throw new Error('Forventet split')
    const assets = slide.root.children.map((child) =>
      child.kind === 'leaf' && child.content && 'image' in child.content
        ? child.content.image.assetId
        : null,
    )
    expect(assets).toEqual(['a_1', 'a_2', 'a_3'])
    expect(nodeIds).toHaveLength(3)

    expect(done.value.imageDeposit).toEqual({ status: 'completed', expectedCount: 3 })
    // The numbers are gone: the deck is an ordinary deck again.
    expect(depositSlots(done.value)).toEqual([])
    expect(depositIsOpen(done.value)).toBe(false)
  })

  it('tar tilbake plassholderteksten når filen lander', () => {
    const { deck } = pendingDeck()
    const ready = withAssets(deck, ['a_1', 'a_2', 'a_3'])
    const done = completeImageDeposit(ready, [
      { index: 1, assetId: 'a_1' },
      { index: 2, assetId: 'a_2' },
      { index: 3, assetId: 'a_3' },
    ])
    expect(done.ok).toBe(true)
    if (!done.ok) return
    const slide = done.value.slides[1]
    if (slide.kind !== 'content' || slide.root.kind !== 'split') throw new Error('Forventet split')
    for (const child of slide.root.children) {
      if (child.kind !== 'leaf' || !child.content || !('image' in child.content)) continue
      expect(child.content.image.caption).toBeNull()
    }
  })

  it('avvises når settet ikke er nøyaktig 1..N', () => {
    const { deck } = pendingDeck()
    const ready = withAssets(deck, ['a_1', 'a_2'])
    expect(
      completeImageDeposit(ready, [
        { index: 1, assetId: 'a_1' },
        { index: 2, assetId: 'a_2' },
      ]).ok,
    ).toBe(false)
    expect(
      completeImageDeposit(ready, [
        { index: 1, assetId: 'a_1' },
        { index: 1, assetId: 'a_2' },
      ]).ok,
    ).toBe(false)
  })
})

describe('numrene er interne', () => {
  it('publiseres aldri i et delt snapshot', () => {
    const { deck } = pendingDeck()
    // The numbers are on the panels being published — this is the one thing on
    // a slide that is not the audience's.
    expect(depositSlots(deck)).toHaveLength(3)
    const snapshot = buildSharedSnapshot(deck)
    expect(JSON.stringify(snapshot)).not.toContain('depositIndex')
    expect(JSON.stringify(snapshot)).not.toContain('imageDeposit')
  })

  it('følger ikke med innhold som er parkert i sandkassen', () => {
    const { deck, slideId, nodeIds } = pendingDeck()
    const rescued = deleteLayoutNode(deck, {
      slideId,
      nodeId: nodeIds[0],
      contentDisposition: 'sandbox',
    })
    if (!rescued.ok) throw new Error(rescued.error.message)

    const given = abandonImageDeposit(rescued.value.presentation)
    if (!given.ok) throw new Error(given.error.message)
    expect(given.value.sandbox).toHaveLength(1)
    expect(JSON.stringify(given.value.sandbox)).not.toContain('depositIndex')

    // So putting it back does not carry a number onto a deck that has none.
    const slide = given.value.slides[1]
    if (slide.kind !== 'content') throw new Error('Forventet en innholdsslide')
    const target = slide.root.kind === 'split' ? slide.root.children[0].id : slide.root.id
    const placed = placeSandboxItem(given.value, {
      itemId: given.value.sandbox[0].id,
      slideId,
      nodeId: target,
      replace: true,
    })
    if (!placed.ok) throw new Error(placed.error.message)
    expect(depositSlots(placed.value.presentation)).toEqual([])
  })
})

describe('den enveis døren', () => {
  it('setter status til abandoned og fjerner numrene', () => {
    const { deck } = pendingDeck()
    const given = abandonImageDeposit(deck)
    expect(given.ok).toBe(true)
    if (!given.ok) return
    expect(given.value.imageDeposit).toEqual({ status: 'abandoned', expectedCount: 3 })
    expect(depositSlots(given.value)).toEqual([])
    // Every zone is still there — only the workflow ended.
    expect(resolveImagePlan(given.value)).toHaveLength(3)
  })

  it('kan ikke settes tilbake til pending etter abandoned', () => {
    const { deck, slideId, nodeIds } = pendingDeck()
    const given = abandonImageDeposit(deck)
    if (!given.ok) throw new Error(given.error.message)

    expect(openImageDeposit(given.value)).toBe(given.value)
    const replanned = setImagePlan(given.value, [
      entry(slideId, nodeIds[0], 'Et helt nytt motiv med en annen beskrivelse'),
    ])
    expect(replanned.ok).toBe(true)
    if (!replanned.ok) return
    expect(replanned.value.imageDeposit?.status).toBe('abandoned')
    expect(depositSlots(replanned.value)).toEqual([])
  })

  it('kan ikke settes tilbake til pending etter completed', () => {
    const { deck, slideId, nodeIds } = pendingDeck()
    const ready = withAssets(deck, ['a_1', 'a_2', 'a_3'])
    const done = completeImageDeposit(ready, [
      { index: 1, assetId: 'a_1' },
      { index: 2, assetId: 'a_2' },
      { index: 3, assetId: 'a_3' },
    ])
    if (!done.ok) throw new Error(done.error.message)

    expect(openImageDeposit(done.value)).toBe(done.value)
    const replanned = setImagePlan(done.value, [
      entry(slideId, nodeIds[0], 'Et helt nytt motiv med en annen beskrivelse'),
    ])
    expect(replanned.ok).toBe(true)
    if (!replanned.ok) return
    expect(replanned.value.imageDeposit?.status).toBe('completed')
    expect(depositSlots(replanned.value)).toEqual([])
    // And the second abandonment has nothing to abandon.
    expect(abandonImageDeposit(done.value).ok).toBe(false)
  })
})

describe('identiteten til leveransen en bekreftelse gjelder', () => {
  const PICTURES = [realImages.png, realImages.jpeg, realImages.webp]

  async function files(
    names: readonly string[],
    bytesFor: (index: number) => Uint8Array = (index) => PICTURES[index % 3](),
  ): Promise<DeliveredImageFile[]> {
    return Promise.all(
      names.map(async (fileName, index) => ({
        fileName,
        contentHash: await hashBytes(bytesFor(index)),
      })),
    )
  }

  async function bareManifest(deck: Presentation): Promise<string> {
    return composeImageGenerationManifest({
      presentationId: deck.id,
      images: resolveImagePlan(deck).map((image) => ({
        imagePlanItemId: image.id,
        number: image.number,
        slideId: image.plan.slideId,
        nodeId: image.plan.nodeId,
        fileName: `${image.fileNameStem}.png`,
      })),
    })
  }

  it('endrer seg når en fil byttes til et annet bilde under samme navn', async () => {
    // The change a confirmation must not survive. Same names, same manifest,
    // same count — a different picture behind `2.png`.
    const { deck } = pendingDeck()
    const manifest = await bareManifest(deck)
    const names = ['1.png', '2.png', '3.png']

    const before = reviewDeposit(deck, await files(names), manifest)
    const after = reviewDeposit(
      deck,
      await files(names, (index) => (index === 1 ? realImages.webpLossless() : PICTURES[index]())),
      manifest,
    )
    expect(after.deliveryKey).not.toBe(before.deliveryKey)
  })

  it('endrer seg når settet eller manifestet endres', async () => {
    const { deck } = pendingDeck()
    const manifest = await bareManifest(deck)
    const full = await files(['1.png', '2.png', '3.png'])
    const base = reviewDeposit(deck, full, manifest).deliveryKey

    // One file removed, one file added, and a different manifest: three
    // different deliveries, three different keys.
    expect(reviewDeposit(deck, full.slice(0, 2), manifest).deliveryKey).not.toBe(base)
    expect(
      reviewDeposit(deck, [...full, { fileName: '4.png', contentHash: 'a'.repeat(64) }], manifest)
        .deliveryKey,
    ).not.toBe(base)
    expect(reviewDeposit(deck, full, `${manifest} `).deliveryKey).not.toBe(base)
  })

  it('er upåvirket av rekkefølgen filene ble plukket i', async () => {
    // The other half of the rule: an irrelevant change must not cost somebody
    // their confirmation, or the dialog teaches people to tick the box blind.
    const { deck } = pendingDeck()
    const manifest = await bareManifest(deck)
    const full = await files(['1.png', '2.png', '3.png'])

    const reordered = [full[2], full[0], full[1]]
    expect(reviewDeposit(deck, reordered, manifest).deliveryKey).toBe(
      reviewDeposit(deck, full, manifest).deliveryKey,
    )
  })
})
