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
  depositIndexFromFileName,
  depositSlots,
  reviewDepositFiles,
} from './imageDeposit'
import { resolveImagePlan } from './imagePlan'
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
    expect(depositIndexFromFileName('1.png')).toBe(1)
    expect(depositIndexFromFileName('2.JPG')).toBe(2)
    expect(depositIndexFromFileName('12.webp')).toBe(12)
    expect(depositIndexFromFileName('3.svg')).toBe(3)
  })

  it('avviser alt annet enn et rent tall', () => {
    // Leading zeros are refused rather than trimmed: `01.png` and `1.png` in
    // one folder are two files for one picture, and a rule that took both would
    // have to guess which one was meant.
    expect(depositIndexFromFileName('01.png')).toBeNull()
    expect(depositIndexFromFileName('bilde1.png')).toBeNull()
    expect(depositIndexFromFileName('1a.png')).toBeNull()
    expect(depositIndexFromFileName('1')).toBeNull()
    expect(depositIndexFromFileName('1.txt')).toBeNull()
    expect(depositIndexFromFileName('1.png.png')).toBeNull()
    expect(depositIndexFromFileName('0.png')).toBeNull()
    expect(depositIndexFromFileName('')).toBeNull()
  })

  it('leser bare siste ledd når nettleseren leverer en mappesti', () => {
    expect(depositIndexFromFileName('bilder/2.png')).toBe(2)
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
