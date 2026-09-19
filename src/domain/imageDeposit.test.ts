/**
 * The image deposit: the numbers, the order, and the one-way door.
 *
 * Three claims are worth pinning, because each of them is a way the workflow
 * could quietly do the wrong thing rather than fail:
 *
 *  - **the numbering is the brief's own.** Writing the plan stamps the
 *    placeholder caption, the brief section and the panel's deposit number from
 *    one pass, so the file the dialog calls picture 3 cannot land in the zone
 *    the brief calls picture 2;
 *  - **nothing is guessed.** A set is read as numbered only when it is a
 *    complete, unambiguous 1‥N; `01.png`, `bilde1.png` and `1-final.png` are
 *    ordinary names that say nothing about the order, so the person is asked
 *    for it rather than being told their files are wrong;
 *  - **`abandoned` is final, and `completed` closes its own round.** Re-planning,
 *    re-syncing and calling the commands again all leave a closed deposit
 *    closed unless the deck is genuinely waiting for pictures again, which is
 *    the promise the dialog on the structural edit is making.
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
import {
  depositImages,
  depositIsOpen,
  depositIsWaiting,
  depositSlots,
  reviewDepositFiles,
} from './imageDeposit'
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

describe('rekkefølgen leses av filnavnene når de faktisk sier den', () => {
  it('plasserer 1, 2, 3 der de hører hjemme', () => {
    const review = reviewDepositFiles(['1.png', '2.jpg', '3.webp'], 3)
    expect(review.mode).toBe('numbered')
    expect(review.files.map((file) => file.index)).toEqual([1, 2, 3])
    expect(review.present).toEqual([1, 2, 3])
    expect(review.missing).toEqual([])
    expect(review.ready).toBe(true)
  })

  it('bryr seg ikke om hvilken rekkefølge filene ble valgt i', () => {
    /*
     * The order a file picker or an operating system hands a folder over in is
     * not a fact about the pictures, and this is the case the numbering exists
     * for: the names carry the answer, so the arrangement cannot change it.
     */
    const review = reviewDepositFiles(['3.webp', '1.png', '2.jpg'], 3)
    expect(review.mode).toBe('numbered')
    expect(review.files.map((file) => file.index)).toEqual([3, 1, 2])
    expect(review.ready).toBe(true)
  })

  it('krever et komplett og entydig sett, aldri en delvis lesning', () => {
    // One name short of complete is not a numbering with a hole in it: it is a
    // set of ordinary names, and the person is asked for the order instead.
    expect(reviewDepositFiles(['1.png', '3.webp'], 3).mode).toBe('manual')
    // Two files claiming the same number say nothing either.
    expect(reviewDepositFiles(['1.jpg', '1.png', '2.png'], 3).mode).toBe('manual')
    // And a number outside the range is not this deck's numbering.
    expect(reviewDepositFiles(['1.png', '2.png', '9.png'], 3).mode).toBe('manual')
  })
})

describe('rekkefølgen er brukerens når filnavnene ikke sier den', () => {
  it('tar imot tre vilkårlig navngitte filer og plasserer dem etter posisjon', () => {
    const review = reviewDepositFiles(['IMG_4821.png', 'padmasambhava.webp', 'Screenshot.jpg'], 3)
    expect(review.mode).toBe('manual')
    expect(review.files.map((file) => file.index)).toEqual([1, 2, 3])
    expect(review.files.every((file) => file.problem === null)).toBe(true)
    expect(review.ready).toBe(true)
  })

  it('lar omrokering endre hvilken fil som blir bilde 1', () => {
    const picked = ['IMG_4821.png', 'padmasambhava.webp', 'Screenshot.jpg']
    const moved = [picked[2], picked[0], picked[1]]
    expect(reviewDepositFiles(moved, 3).files.map((file) => file.name)).toEqual(moved)
    expect(reviewDepositFiles(moved, 3).files.map((file) => file.index)).toEqual([1, 2, 3])
    // Position is the picture number, so the same three files in another order
    // are three different placements.
    expect(reviewDepositFiles(picked, 3).files[0].name).not.toBe(
      reviewDepositFiles(moved, 3).files[0].name,
    )
  })

  it('behandler navn som bare ligner på tall som vanlige navn, ikke som feil', () => {
    /*
     * The whole point of the rule: `01.png` is not picture 1 and it is not a
     * broken file either. Guessing would put a picture on the wrong slide;
     * rejecting would refuse a perfectly ordinary delivery.
     */
    const review = reviewDepositFiles(['01.png', 'bilde1.png', '1-final.png'], 3)
    expect(review.mode).toBe('manual')
    expect(review.files.every((file) => file.problem === null)).toBe(true)
    expect(review.files.map((file) => file.index)).toEqual([1, 2, 3])
    expect(review.ready).toBe(true)
  })

  it('går til manuell rekkefølge for en blanding som ikke utgjør 1..N', () => {
    const review = reviewDepositFiles(['1.png', 'slide2.jpg', '3.webp'], 3)
    expect(review.mode).toBe('manual')
    // And then `1.png` is simply the first file, not «picture 1 by name».
    expect(review.files.map((file) => file.index)).toEqual([1, 2, 3])
    expect(review.ready).toBe(true)
  })
})

describe('antallet filer', () => {
  it('er ikke klart med færre enn N, og sier hvilke som mangler', () => {
    const review = reviewDepositFiles(['IMG_1.png', 'IMG_2.png'], 3)
    expect(review.present).toEqual([1, 2])
    expect(review.missing).toEqual([3])
    expect(review.ready).toBe(false)
  })

  it('er ikke klart med flere enn N, og navngir de overskytende', () => {
    const review = reviewDepositFiles(['a.png', 'b.png', 'c.png', 'd.png'], 3)
    expect(review.files.map((file) => file.problem)).toEqual([null, null, null, 'EXCESS'])
    expect(review.files.map((file) => file.index)).toEqual([1, 2, 3, null])
    expect(review.ready).toBe(false)
  })

  it('er klart igjen når den overskytende filen er fjernet', () => {
    const picked = ['a.png', 'b.png', 'c.png', 'd.png']
    expect(reviewDepositFiles(picked, 3).ready).toBe(false)
    expect(reviewDepositFiles(picked.slice(0, 3), 3).ready).toBe(true)
  })

  it('avviser en fil som ikke er et bilde, uten å la den ta en bildeplass', () => {
    const review = reviewDepositFiles(['a.png', 'notat.txt', 'b.png', 'c.png'], 3)
    expect(review.files.map((file) => file.problem)).toEqual([null, 'TYPE', null, null])
    // The text file occupies nothing: the three pictures still get 1, 2 and 3.
    expect(review.files.map((file) => file.index)).toEqual([1, null, 2, 3])
    expect(review.present).toEqual([1, 2, 3])
    // …and «Fullfør» still waits, because something in the drop cannot be used.
    expect(review.ready).toBe(false)
  })

  it('er aldri klart uten en eneste plass å fylle', () => {
    expect(reviewDepositFiles([], 3).ready).toBe(false)
    expect(reviewDepositFiles([], 0).ready).toBe(false)
    expect(reviewDepositFiles(['a.png'], 0).ready).toBe(false)
  })
})

describe('listen brukeren leser', () => {
  it('viser indeks, kort beskrivelse og ønsket bildeforhold', () => {
    const { deck } = pendingDeck()
    const images = depositImages(deck)
    expect(images.map((image) => image.index)).toEqual([1, 2, 3])
    expect(images[1].subject).toBe('Homo erectus som bearbeider en håndøks')
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
