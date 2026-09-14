import { describe, expect, it } from 'vitest'
import { createPresentation } from '../../domain/presentation'
import { createTitledCard, createUntitledCard } from '../../domain/content'
import { setZoneContent, splitLeaf, setImageCaption, setContentKind } from '../../domain/commands'
import { estimateFitChecker } from '../../domain/fit'
import { paragraphDoc } from '../../domain/richdoc'
import {
  SECTION_SUBTITLE_NODE_ID,
  SECTION_TITLE_NODE_ID,
  TITLE_NODE_ID,
} from '../../domain/geometry'
import { contentAt, sectionAt } from '../../domain/testDecks'
import type { Presentation } from '../../domain/types'
import { activeFieldNodeId, textTargetKey, textTargetsForSlide } from './textTarget'

const fits = { fits: estimateFitChecker }

/** A deck whose second slide holds one titled card with two subfields. */
function deckWithCard(): Presentation {
  const base = createPresentation({ title: 'Mobiltest' })
  const slide = contentAt(base, 1)
  const placed = setZoneContent(base, {
    slideId: slide.id,
    nodeId: slide.root.id,
    content: createTitledCard('Korttittel', null, 2),
    ...fits,
  })
  if (!placed.ok) throw new Error('kunne ikke legge inn innhold')
  return placed.value.presentation
}

describe('textTargetsForSlide', () => {
  it('walks the layout tree rather than a list somebody has to maintain', () => {
    const deck = deckWithCard()
    const slide = contentAt(deck, 1)
    const entries = textTargetsForSlide(slide)

    // A slide title, the card's title, and one entry per subfield.
    expect(entries.map((entry) => entry.target.kind)).toEqual([
      'slide-title',
      'card-title',
      'body',
      'body',
    ])
    expect(entries[1].preview).toBe('Korttittel')
    // Two subfields, so they are told apart by number.
    expect(entries[2].label).not.toBe(entries[3].label)
    // Every entry addresses something different.
    expect(new Set(entries.map((entry) => textTargetKey(entry.target))).size).toBe(entries.length)
  })

  it('grows with the layout: splitting a zone gives the new zones their own entries', () => {
    const deck = deckWithCard()
    const slide = contentAt(deck, 1)
    const before = textTargetsForSlide(slide).length

    const split = splitLeaf(deck, {
      slideId: slide.id,
      nodeId: slide.root.id,
      axis: 'x',
      weights: [1, 1],
      contentTargetIndex: 0,
      ...fits,
    })
    if (!split.ok) throw new Error('kunne ikke splitte')
    const after = split.value.presentation
    const root = contentAt(after, 1).root
    if (root.kind !== 'split') throw new Error('roten skulle vært splittet')
    const filled = setZoneContent(after, {
      slideId: slide.id,
      nodeId: root.children[1].id,
      content: createUntitledCard(),
      ...fits,
    })
    if (!filled.ok) throw new Error('kunne ikke fylle den nye sonen')

    expect(textTargetsForSlide(contentAt(filled.value.presentation, 1)).length).toBeGreaterThan(
      before,
    )
  })

  it('lists a section as its two lines, and an interactive slide as nothing', () => {
    const deck = createPresentation({ title: 'Forside' })
    const entries = textTargetsForSlide(sectionAt(deck, 0))
    expect(entries.map((entry) => entry.target.kind)).toEqual([
      'section-title',
      'section-subtitle',
    ])
    expect(entries[0].preview).toBe('Forside')
  })

  it('offers a caption once a picture has one', () => {
    const deck = deckWithCard()
    const slide = contentAt(deck, 1)
    const asImage = setContentKind(deck, {
      slideId: slide.id,
      nodeId: slide.root.id,
      kind: 'titled-image-card',
      ...fits,
    })
    if (!asImage.ok) throw new Error('kunne ikke bytte innholdstype')
    const captioned = setImageCaption(asImage.value, {
      slideId: slide.id,
      nodeId: slide.root.id,
      doc: paragraphDoc('En bildetekst'),
      ...fits,
    })
    if (!captioned.ok) throw new Error('kunne ikke sette bildetekst')

    const entries = textTargetsForSlide(contentAt(captioned.value, 1))
    const caption = entries.find((entry) => entry.target.kind === 'caption')
    expect(caption?.preview).toBe('En bildetekst')
  })
})

/*
 * The list addresses fields; the stage focuses them by node id. The bridge
 * between the two is this one function, so a field the list offers has to name
 * something the stage can actually fill itself with — including the three that
 * are drawn outside the layout tree.
 */
describe('activeFieldNodeId', () => {
  it('names a zone by its own id, and the rest by the geometry engine\'s', () => {
    expect(activeFieldNodeId({ kind: 'body', slideId: 's', nodeId: 'n1', subfieldId: 'f1' })).toBe(
      'n1',
    )
    expect(activeFieldNodeId({ kind: 'card-title', slideId: 's', nodeId: 'n1' })).toBe('n1')
    expect(activeFieldNodeId({ kind: 'caption', slideId: 's', nodeId: 'n1' })).toBe('n1')
    expect(activeFieldNodeId({ kind: 'slide-title', slideId: 's' })).toBe(TITLE_NODE_ID)
    expect(activeFieldNodeId({ kind: 'section-title', slideId: 's' })).toBe(SECTION_TITLE_NODE_ID)
    expect(activeFieldNodeId({ kind: 'section-subtitle', slideId: 's' })).toBe(
      SECTION_SUBTITLE_NODE_ID,
    )
  })
})
