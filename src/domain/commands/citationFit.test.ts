/**
 * Regression tests for citation-aware content fit.
 *
 * A citation stores reference ids, never a number. What it *renders* comes from
 * first-occurrence order across the whole deck, so a zone can lose room without
 * anyone editing it: insert a citation earlier in the document and `9` becomes
 * `10`; take one out of the middle of a run and `1–3` becomes `1, 2`.
 *
 * Two things have to hold for the fit gate to see any of that:
 *  - a measurement must include the label the citation will actually show, and
 *  - a command that changes first-occurrence order must be judged by its
 *    consequences everywhere, not only in the zone it was aimed at.
 */

import { describe, expect, it } from 'vitest'
import { createPresentation } from '../presentation'
import { createUntitledCard } from '../content'
import { estimateFit, estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { computeReferenceNumbering } from '../references'
import { computeMainRect } from '../geometry'
import { geometryForTheme } from '../metrics'
import type { Presentation, Rect, Reference, RichDoc, ZoneContent } from '../types'
import { findLeaf } from '../layout'
import { addSlide, moveSlide, setSubfieldDoc, setZoneContent } from './index'

const checkers = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }

/**
 * The zone a slide with no title gives its root, under a given theme.
 *
 * Asked of the geometry engine rather than written out here: the inset is the
 * theme's own gap and the progress indicator takes a strip off the bottom, so a
 * rect assembled from the raw constants would be measuring a slide that does
 * not exist — and these fixtures fill a zone to the very last line.
 */
function fullRect(theme: Presentation['theme']): Rect {
  return computeMainRect(false, geometryForTheme(theme))
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

function reference(id: string): Reference {
  return { id, title: `Kilde ${id}`, authors: '', url: '', year: '' }
}

/** A paragraph of `text`, followed by `count` citations of the same reference. */
function citingDoc(text: string, referenceId: string, count = 1): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text },
          ...Array.from({ length: count }, () => ({
            type: 'citation',
            attrs: { referenceIds: [referenceId] },
          })),
        ],
      },
    ],
  }
}

function cardWith(doc: RichDoc): ZoneContent {
  const base = createUntitledCard()
  return { ...base, body: { ...base.body, subfields: [{ id: 'field-0', doc }] } }
}

/* ------------------------------------------------------------------ *
 * 1. The measurement itself
 * ------------------------------------------------------------------ */

describe('measuring a citation', () => {
  const theme = createPresentation({ title: 'x' }).theme
  // Narrow and short on purpose: the pills have to change the line count for
  // the difference to be visible at all, which is exactly the case that used to
  // slip through.
  const TIGHT: Rect = { x: 0, y: 0, width: 220, height: 60 }

  it('includes the label the citation will actually render', () => {
    const content = cardWith(citingDoc('Tekst med kilde', 'r1', 30))
    const withLabel = estimateFit(content, TIGHT, { theme, numbering: new Map([['r1', 1]]) })
    const withoutNumbering = estimateFit(content, TIGHT, { theme, numbering: new Map() })
    // A citation whose reference has no number renders nothing at all, which is
    // exactly the hole this closes: measuring with an empty numbering measured
    // a document the user will never see.
    expect(withLabel.overflow).toBeGreaterThan(withoutNumbering.overflow)
  })

  it('sees a one-digit label as narrower than a two-digit one', () => {
    const content = cardWith(citingDoc('Tekst med kilde', 'r1', 30))
    const single = estimateFit(content, TIGHT, { theme, numbering: new Map([['r1', 9]]) })
    const double = estimateFit(content, TIGHT, { theme, numbering: new Map([['r1', 10]]) })
    expect(double.overflow).toBeGreaterThan(single.overflow)
  })

  it('sees a decompressed range as wider than a compressed one', () => {
    const grouped: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: Array.from({ length: 30 }, () => ({
            type: 'citation',
            attrs: { referenceIds: ['a', 'b', 'c'] },
          })),
        },
      ],
    }
    // 1, 2, 3 compresses to `1–3`; 1, 2, 4 has to be listed in full.
    const compressed = estimateFit(cardWith(grouped), TIGHT, {
      theme,
      numbering: new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
    })
    const listed = estimateFit(cardWith(grouped), TIGHT, {
      theme,
      numbering: new Map([
        ['a', 1],
        ['b', 2],
        ['c', 4],
      ]),
    })
    expect(listed.overflow).toBeGreaterThan(compressed.overflow)
  })
})

/* ------------------------------------------------------------------ *
 * 2. Commands that change first-occurrence order
 * ------------------------------------------------------------------ */

/**
 * A two-slide deck: the first slide cites `r0` as many times as asked, the
 * second cites nine other references so that moving the first slide past it
 * turns `r0`'s label from `1` into `10`.
 */
function deck(citations: number, text: string): Presentation {
  const references = [reference('r0'), ...Array.from({ length: 9 }, (_, i) => reference(`r${i + 1}`))]
  let presentation: Presentation = {
    ...createPresentation({ title: 'Citations', firstSlideHasTitle: false }),
    references,
  }
  // The fixture is built without checkers on purpose: it exists to set up
  // states the commands under test then have to judge, including ones that are
  // deliberately right at the limit.
  presentation = unwrap(addSlide(presentation, { hasTitle: false, index: 1 }))
  const [first, second] = presentation.slides

  presentation = unwrap(
    setZoneContent(presentation, {
      slideId: first.id,
      nodeId: first.root.id,
      content: cardWith(citingDoc(text, 'r0', citations)),
    }),
  ).presentation

  const nine: RichDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: Array.from({ length: 9 }, (_, i) => ({
          type: 'citation',
          attrs: { referenceIds: [`r${i + 1}`] },
        })),
      },
    ],
  }
  presentation = unwrap(
    setZoneContent(presentation, {
      slideId: second.id,
      nodeId: second.root.id,
      content: cardWith(nine),
    }),
  ).presentation
  return presentation
}

/** A paragraph citing the first `count` references, in order. */
function earlierCitations(count: number): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: Array.from({ length: count }, (_, i) => ({
          type: 'citation',
          attrs: { referenceIds: [`r${i + 1}`] },
        })),
      },
    ],
  }
}

/**
 * `[A, B]` where A cites `earlier` references and B is filled to its limit with
 * a citation of `r0` — which therefore renders as `earlier + 1`.
 */
function trailingDeck(earlier: number, citations: number, text: string): Presentation {
  const references = [
    ...Array.from({ length: 9 }, (_, i) => reference(`r${i + 1}`)),
    reference('r0'),
  ]
  let presentation: Presentation = {
    ...createPresentation({ title: 'Citations', firstSlideHasTitle: false }),
    references,
  }
  presentation = unwrap(addSlide(presentation, { hasTitle: false, index: 1 }))
  const [first, second] = presentation.slides
  presentation = unwrap(
    setZoneContent(presentation, {
      slideId: first.id,
      nodeId: first.root.id,
      content: cardWith(earlierCitations(earlier)),
    }),
  ).presentation
  presentation = unwrap(
    setZoneContent(presentation, {
      slideId: second.id,
      nodeId: second.root.id,
      content: cardWith(citingDoc(text, 'r0', citations)),
    }),
  ).presentation
  return presentation
}

/** The longest text that still fits on the trailing slide as things stand. */
function fillTrailingSlide(earlier: number, citations: number): Presentation {
  let best: Presentation | null = null
  for (let length = 100; length <= 4000; length += 20) {
    const candidate = trailingDeck(earlier, citations, 'ord '.repeat(length / 4))
    const slide = candidate.slides[1]
    const content = findLeaf(slide.root, slide.root.id)?.content
    if (!content) throw new Error('expected content')
    const fit = estimateFit(content, fullRect(candidate.theme), {
      theme: candidate.theme,
      numbering: computeReferenceNumbering(candidate),
    })
    if (!fit.fits) break
    best = candidate
  }
  if (!best) throw new Error('could not fill the slide')
  return best
}

/** The longest text that still fits on the first slide, as it stands today. */
function fillFirstSlide(citations: number): Presentation {
  let best: Presentation | null = null
  for (let length = 100; length <= 4000; length += 20) {
    const candidate = deck(citations, 'ord '.repeat(length / 4))
    const content = findLeaf(candidate.slides[0].root, candidate.slides[0].root.id)?.content
    if (!content) throw new Error('expected content')
    const fit = estimateFit(content, fullRect(candidate.theme), {
      theme: candidate.theme,
      numbering: computeReferenceNumbering(candidate),
    })
    if (!fit.fits) break
    best = candidate
  }
  if (!best) throw new Error('could not fill the slide')
  return best
}

describe('commands that renumber citations', () => {
  it('refuses a slide reorder that pushes a label from 1 to 10 in a full zone', () => {
    const presentation = fillFirstSlide(40)
    const moved = moveSlide(presentation, presentation.slides[0].id, 1, checkers)
    expect(moved.ok).toBe(false)
    if (!moved.ok) expect(moved.error.code).toBe('CONTENT_DOES_NOT_FIT')
  })

  it('allows the same reorder when the zone has room for the wider label', () => {
    const presentation = deck(40, 'ord '.repeat(20))
    const moved = moveSlide(presentation, presentation.slides[0].id, 1, checkers)
    expect(moved.ok).toBe(true)
  })

  it('allows a reorder that makes labels narrower', () => {
    const presentation = deck(40, 'ord '.repeat(20))
    const swapped = unwrap(moveSlide(presentation, presentation.slides[0].id, 1, checkers))
    // Back again: `10` becomes `1`, which can only free up room.
    const back = moveSlide(swapped, swapped.slides[1].id, 0, checkers)
    expect(back.ok).toBe(true)
  })

  it('refuses a citation inserted earlier in the deck when it overflows a later slide', () => {
    const presentation = fillFirstSlide(40)
    // The full slide is first, so its reference is number 1. Give the *second*
    // slide's document nine earlier citations by moving them ahead of it: a new
    // slide inserted in front with those citations does the same thing.
    const second = presentation.slides[1]
    const withEarlier: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: Array.from({ length: 9 }, (_, i) => ({
            type: 'citation',
            attrs: { referenceIds: [`r${i + 1}`] },
          })),
        },
      ],
    }
    const inserted = addSlide(presentation, {
      hasTitle: false,
      index: 0,
      root: {
        kind: 'leaf',
        id: 'seed',
        content: cardWith(withEarlier),
      },
      ...checkers,
    })
    expect(inserted.ok).toBe(false)
    if (!inserted.ok) expect(inserted.error.code).toBe('CONTENT_DOES_NOT_FIT')
    // The same slide without citations changes nothing and is allowed.
    const harmless = addSlide(presentation, { hasTitle: false, index: 0, ...checkers })
    expect(harmless.ok).toBe(true)
    expect(second).toBeDefined()
  })

  it('refuses a document edit that renumbers a full zone on another slide', () => {
    // Eight citations ahead of the full slide, so its own label is `9` and one
    // more citation ahead of it makes it `10`.
    const presentation = fillTrailingSlide(8, 40)
    const first = presentation.slides[0]
    const content = findLeaf(first.root, first.root.id)?.content
    if (!content || content.kind !== 'untitled-card') throw new Error('expected a card')
    const subfieldId = content.body.subfields[0].id

    const ninth = setSubfieldDoc(presentation, {
      slideId: first.id,
      nodeId: first.root.id,
      subfieldId,
      doc: earlierCitations(9),
      ...checkers,
    })
    expect(ninth.ok).toBe(false)
    if (!ninth.ok) expect(ninth.error.code).toBe('CONTENT_DOES_NOT_FIT')

    // Rewriting the same eight citations renumbers nothing and is allowed, so
    // the rule is about the consequence and not about touching citations.
    const same = setSubfieldDoc(presentation, {
      slideId: first.id,
      nodeId: first.root.id,
      subfieldId,
      doc: earlierCitations(8),
      ...checkers,
    })
    expect(same.ok).toBe(true)
  })
})
