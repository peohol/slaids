import { describe, expect, it } from 'vitest'
import { createPresentation } from '../../domain/presentation'
import { createTitledCard, createUntitledCard } from '../../domain/content'
import { setZoneContent, splitLeaf, setImageCaption, setContentKind } from '../../domain/commands'
import { estimateFitChecker } from '../../domain/fit'
import { paragraphDoc, titleDoc, docToPlainText } from '../../domain/richdoc'
import { contentAt, sectionAt } from '../../domain/testDecks'
import type { Presentation } from '../../domain/types'
import {
  readTextTarget,
  textTargetKey,
  textTargetsForSlide,
  typingLabelFor,
  variantFor,
  writeTextTarget,
  type TextTarget,
} from './textTarget'

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

describe('readTextTarget / writeTextTarget', () => {
  it('round-trips every kind of field through the command that owns it', () => {
    let deck = deckWithCard()
    const slide = contentAt(deck, 1)
    const targets = textTargetsForSlide(slide).map((entry) => entry.target)

    for (const target of targets) {
      const written = writeTextTarget(deck, target, paragraphDoc(`Skrevet i ${target.kind}`))
      expect(written.ok, `${target.kind} skulle kunne skrives`).toBe(true)
      if (!written.ok) continue
      deck = written.value
      expect(docToPlainText(readTextTarget(deck, target))).toBe(`Skrevet i ${target.kind}`)
    }
  })

  it('answers null for a field the document no longer has', () => {
    const deck = deckWithCard()
    const gone: TextTarget = {
      kind: 'body',
      slideId: contentAt(deck, 1).id,
      nodeId: contentAt(deck, 1).root.id,
      subfieldId: 'finnes-ikke',
    }
    expect(readTextTarget(deck, gone)).toBeNull()
  })

  it('refuses a field the content kind does not have, through the command', () => {
    const base = createPresentation({ title: 'Uten tittel i kortet' })
    const slide = contentAt(base, 1)
    const placed = setZoneContent(base, {
      slideId: slide.id,
      nodeId: slide.root.id,
      content: createUntitledCard(),
      ...fits,
    })
    if (!placed.ok) throw new Error('kunne ikke legge inn innhold')

    // A card with no title is not given one by writing to it here: the rule
    // belongs to `setCardTitle`, and this module only dispatches.
    const written = writeTextTarget(
      placed.value.presentation,
      { kind: 'card-title', slideId: slide.id, nodeId: slide.root.id },
      titleDoc('Nei'),
    )
    expect(written.ok).toBe(false)
  })
})

describe('field descriptions', () => {
  it('uses the same editor variants the stage uses', () => {
    expect(variantFor({ kind: 'body', slideId: 's', nodeId: 'n', subfieldId: 'f' })).toBe('body')
    expect(variantFor({ kind: 'caption', slideId: 's', nodeId: 'n' })).toBe('caption')
    expect(variantFor({ kind: 'slide-title', slideId: 's' })).toBe('title')
    expect(variantFor({ kind: 'section-title', slideId: 's' })).toBe('title')
  })

  /*
   * The undo label is what makes a run of typing coalesce into one step, so a
   * field opened on the focused surface has to carry the same label the stage
   * would have used for it — otherwise the same keystrokes would leave a
   * different history depending on where they were typed.
   */
  it('labels typing the way the stage labels it', () => {
    expect(typingLabelFor({ kind: 'body', slideId: 's', nodeId: 'n1', subfieldId: 'f1' })).toBe(
      'typing:n1:f1',
    )
    expect(typingLabelFor({ kind: 'card-title', slideId: 's', nodeId: 'n1' })).toBe('typing:n1:title')
    expect(typingLabelFor({ kind: 'caption', slideId: 's', nodeId: 'n1' })).toBe('typing:n1:caption')
    expect(typingLabelFor({ kind: 'slide-title', slideId: 's1' })).toBe('typing:s1:slide-title')
  })
})
