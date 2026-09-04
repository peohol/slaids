/**
 * Regression tests for the content-fit gate.
 *
 * Each case is a change that used to be committable and would have left
 * previously visible content clipped by `overflow: hidden`. Every case is
 * tested in both directions: the change that no longer fits is refused, and an
 * equivalent change that still fits is accepted.
 *
 * The numbers come from the headless estimator in `domain/fit.ts`, which is
 * deliberately font-aware so a global font change is observable without a DOM.
 */

import { describe, expect, it } from 'vitest'
import { createPresentation } from '../presentation'
import {
  containerWithDoc,
  createImage,
  createUntitledCard,
} from '../content'
import { estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { DEFAULT_SPACING, FONT_SCALE_RANGE, SPACING_RANGE } from '../metrics'
import { findPresentationIssues } from '../validation'
import { FONT_OPTIONS } from '../fonts'
import { imageNode, paragraphDoc, titleDoc } from '../richdoc'
import type { CardBody, Presentation, RichDoc, ZoneContent } from '../types'
import {
  setBodyAxis,
  setBodyLayout,
  setBodyWeights,
  setCardColor,
  setContentKind,
  setSlideTitle,
  setSubfieldCount,
  setSubfieldDoc,
  setTheme,
  setZoneContent,
  splitLeaf,
} from './index'

/** What the editor and any future REST/MCP caller pass. */
const checkers = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }

const stack = (id: string): string => {
  const font = FONT_OPTIONS.find((option) => option.id === id)
  if (!font) throw new Error(`unknown font ${id}`)
  return font.stack
}

function words(chars: number): string {
  return 'ord '.repeat(Math.round(chars / 4))
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

function expectRefused(result: { ok: boolean; error?: { code: string } }): void {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error?.code).toBe('CONTENT_DOES_NOT_FIT')
}

/** A card whose body is exactly the given docs, laid out as asked. */
function cardWith(docs: RichDoc[], axis: CardBody['axis'] = 'y', weights?: number[]): ZoneContent {
  const base = createUntitledCard()
  return {
    ...base,
    body: {
      axis,
      weights: weights ?? docs.map(() => 1),
      subfields: docs.map((doc, index) => ({ id: `field-${index}`, doc })),
    },
  }
}

/** A one-slide deck, no title zone, with `content` filling the whole slide. */
function deckWith(content: ZoneContent, theme?: Partial<Presentation['theme']>): Presentation {
  const presentation = createPresentation({ title: 'Fit', firstSlideHasTitle: false, theme })
  const slide = presentation.slides[0]
  return unwrap(
    setZoneContent(presentation, { slideId: slide.id, nodeId: slide.root.id, content }),
  ).presentation
}

function target(presentation: Presentation): { slideId: string; nodeId: string } {
  const slide = presentation.slides[0]
  return { slideId: slide.id, nodeId: slide.root.id }
}

/* ------------------------------------------------------------------ *
 * 0. Global changes that move the geometry itself
 * ------------------------------------------------------------------ */

describe('setTheme og minstemålet for en sone', () => {
  /**
   * A slide split as far across as the design space allows — at the tightest
   * setting the theme offers, which is the only one that allows this many.
   * Every step up the ladder from here takes a zone below the minimum.
   */
  const TIGHTEST = SPACING_RANGE.min

  function splitWide(): Presentation {
    const presentation = createPresentation({
      title: 'Minstemål',
      firstSlideHasTitle: false,
      theme: { spacing: TIGHTEST },
    })
    const slide = presentation.slides[0]
    return unwrap(
      splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        axis: 'x',
        weights: [1, 1, 1, 1, 1, 1, 1],
        ...checkers,
      }),
    ).presentation
  }

  it('refuses air that would make the zones smaller than the minimum', () => {
    // The zones are empty, so nothing overflows and the fit guard has nothing to
    // say. Committed anyway, this is a deck `findSlideIssues` calls invalid.
    const result = setTheme(splitWide(), { spacing: DEFAULT_SPACING }, checkers)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ZONE_TOO_SMALL')
  })

  it('accepts air the zones still satisfy', () => {
    expect(setTheme(splitWide(), { spacing: TIGHTEST + 0.1 }, checkers).ok).toBe(true)
  })

  it('refuses a change that makes an already too small zone smaller still', () => {
    // The case a set of node ids cannot see: the same zones are on the list
    // before and after, and every one of them got worse. The «Normal» rung
    // already leaves the seven zones a hair under the minimum; «Luftig» takes
    // them further under. Nothing is hidden by it — the zones are empty — so
    // the fit guard has nothing to say either.
    const tight = splitWide()
    const alreadyBroken: Presentation = {
      ...tight,
      theme: { ...tight.theme, spacing: DEFAULT_SPACING },
    }
    expect(findPresentationIssues(alreadyBroken).some((issue) => issue.code === 'ZONE_TOO_SMALL')).toBe(
      true,
    )

    const worse = setTheme(alreadyBroken, { spacing: 2.4 }, checkers)
    expect(worse.ok).toBe(false)
    if (!worse.ok) expect(worse.error.code).toBe('ZONE_TOO_SMALL')
  })

  it('still lets a deck that is already too tight be repaired', () => {
    // A document from an import, or from before a token changed: refusing every
    // theme change here would leave it with no way back.
    const tight = splitWide()
    const broken: Presentation = { ...tight, theme: { ...tight.theme, spacing: 2.4 } }
    expect(setTheme(broken, { spacing: TIGHTEST }, checkers).ok).toBe(true)
    // Less wrong is still allowed, all the way down to right.
    expect(setTheme(broken, { spacing: DEFAULT_SPACING }, checkers).ok).toBe(true)
    // And a change that leaves it exactly as broken is not a new regression.
    expect(setTheme(broken, { backgroundColor: '#123456' }, checkers).ok).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * 1. Global font changes
 * ------------------------------------------------------------------ */

describe('setTheme', () => {
  // This many characters fill the full-slide zone at the default advance but
  // not at Verdana's, which is 16% wider.
  const filled = (): Presentation => deckWith(cardWith([paragraphDoc(words(1600))]))

  it('refuses a body font that makes existing text too big', () => {
    expectRefused(setTheme(filled(), { bodyFontFamily: stack('verdana') }, checkers))
  })

  it('accepts a body font the same text still fits', () => {
    const result = setTheme(filled(), { bodyFontFamily: stack('calibri') }, checkers)
    expect(result.ok).toBe(true)
    expect(unwrap(result).theme.bodyFontFamily).toBe(stack('calibri'))
  })

  it('refuses a heading font that pushes a slide title out of its zone', () => {
    const blank = createPresentation({ title: 'Fit' })
    const slideId = blank.slides[0].id
    const presentation = unwrap(
      setSlideTitle(blank, slideId, titleDoc('A'.repeat(48)), checkers),
    )

    expectRefused(setTheme(presentation, { headingFontFamily: stack('verdana') }, checkers))
    expect(setTheme(presentation, { headingFontFamily: stack('times') }, checkers).ok).toBe(true)
  })

  it('still allows a font change that reduces an existing overflow', () => {
    // Already overflowing on Verdana — the user must be able to get out of it.
    const overflowing = deckWith(cardWith([paragraphDoc(words(1600))]), {
      bodyFontFamily: stack('verdana'),
    })
    expect(setTheme(overflowing, { bodyFontFamily: stack('merriweather') }, checkers).ok).toBe(true)
    expect(setTheme(overflowing, { bodyFontFamily: stack('system') }, checkers).ok).toBe(true)
  })

  it('keeps enforcing the rule on content that already overflows', () => {
    const overflowing = deckWith(cardWith([paragraphDoc(words(1600))]), {
      bodyFontFamily: stack('merriweather'),
    })
    expectRefused(setTheme(overflowing, { bodyFontFamily: stack('verdana') }, checkers))
  })

  it('refuses more air than the content can afford', () => {
    // More air takes room from the same text twice over: a wider gap shrinks
    // every zone, and more card padding shrinks what is left inside it.
    expectRefused(setTheme(filled(), { spacing: 2.4 }, checkers))
    expect(setTheme(filled(), { spacing: SPACING_RANGE.min }, checkers).ok).toBe(true)
  })

  it('refuses type larger than the content can afford', () => {
    expectRefused(setTheme(filled(), { fontScale: 1.6 }, checkers))
    expect(setTheme(filled(), { fontScale: FONT_SCALE_RANGE.min }, checkers).ok).toBe(true)
  })

  it('refuses a scale outside the supported range outright', () => {
    expect(setTheme(filled(), { spacing: 12 }, checkers).ok).toBe(false)
    expect(setTheme(filled(), { fontScale: 0 }, checkers).ok).toBe(false)
    expect(setTheme(filled(), { spacing: Number.NaN }, checkers).ok).toBe(false)
  })

  it('measures a title against the zone the new type size gives it', () => {
    const blank = createPresentation({ title: 'Fit' })
    const slideId = blank.slides[0].id
    const presentation = unwrap(
      setSlideTitle(blank, slideId, titleDoc('A'.repeat(48)), checkers),
    )
    // The title zone grows with the type, but not as fast as the glyphs do.
    expectRefused(setTheme(presentation, { fontScale: 1.6 }, checkers))
    expect(setTheme(presentation, { fontScale: FONT_SCALE_RANGE.min }, checkers).ok).toBe(true)
  })

  it('does not re-measure the deck for a colour-only change', () => {
    let measured = 0
    const counting = {
      fits: (...args: Parameters<typeof estimateFitChecker>) => {
        measured += 1
        return estimateFitChecker(...args)
      },
      fitsTitle: estimateTitleFitChecker,
    }
    expect(setTheme(filled(), { backgroundColor: '#123456' }, counting).ok).toBe(true)
    expect(measured).toBe(0)
  })
})

/* ------------------------------------------------------------------ *
 * 2. Subfield layout
 * ------------------------------------------------------------------ */

describe('card body layout', () => {
  it('refuses a subfield count that leaves the existing text too little room', () => {
    const presentation = deckWith(cardWith([paragraphDoc(words(1600))]))
    expectRefused(setSubfieldCount(presentation, { ...target(presentation), count: 2, ...checkers }))
  })

  it('accepts a subfield count the existing text still fits', () => {
    const presentation = deckWith(cardWith([paragraphDoc(words(600))]))
    expect(
      setSubfieldCount(presentation, { ...target(presentation), count: 2, ...checkers }).ok,
    ).toBe(true)
  })

  it('refuses a ratio change that squeezes the filled subfield', () => {
    const presentation = deckWith(
      cardWith([paragraphDoc(words(1400)), paragraphDoc('')], 'y', [1, 1]),
    )
    expectRefused(setBodyWeights(presentation, { ...target(presentation), weights: [1, 4], ...checkers }))
    // The opposite direction gives the same content more room.
    expect(
      setBodyWeights(presentation, { ...target(presentation), weights: [4, 1], ...checkers }).ok,
    ).toBe(true)
  })

  it('refuses an axis flip that shrinks the space the content needs', () => {
    // A full-width 4:3 figure is nearly as tall as its column is wide, so
    // stacking two side-by-side subfields costs it more height than it gains.
    // The ratio is stated rather than assumed: it is the file's own, and it is
    // what decides how much room the picture takes.
    const figure: RichDoc = { type: 'doc', content: [imageNode('asset-1', { aspect: 4 / 3 })] }
    const presentation = deckWith(cardWith([figure, paragraphDoc('')], 'x', [1, 1]))
    expectRefused(setBodyAxis(presentation, { ...target(presentation), axis: 'y', ...checkers }))
  })

  it('accepts an axis flip the content still fits', () => {
    const figure: RichDoc = { type: 'doc', content: [imageNode('asset-1', { aspect: 4 / 3 })] }
    const presentation = deckWith(cardWith([figure, paragraphDoc('')], 'y', [1, 1]))
    expect(setBodyAxis(presentation, { ...target(presentation), axis: 'x', ...checkers }).ok).toBe(
      true,
    )
  })

  it('reaches in one gated step a layout the same layout in two steps cannot', () => {
    // This is why count, axis and weights are one command. Two subfields side
    // by side hold a figure that two stacked subfields do not: stacking halves
    // the height the figure needs all of, while splitting sideways makes it
    // narrower and therefore shorter. Asking for the count first and the axis
    // second never arrives — the intermediate is measured on its own terms and
    // refused — so the destination would be unreachable, not merely awkward.
    const figure: RichDoc = {
      type: 'doc',
      content: [imageNode('asset-1', { widthPercent: 70, aspect: 4 / 3 })],
    }
    const presentation = deckWith(cardWith([figure]))

    expectRefused(
      setSubfieldCount(presentation, { ...target(presentation), count: 2, ...checkers }),
    )
    expect(
      setBodyLayout(presentation, {
        ...target(presentation),
        subfieldCount: 2,
        axis: 'x',
        ...checkers,
      }).ok,
    ).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * 3. Content-kind conversion
 * ------------------------------------------------------------------ */

describe('setContentKind', () => {
  // A container gives the whole zone to content; an untitled card spends
  // 2 * CARD_PADDING on chrome and a titled card another CARD_HEADER_HEIGHT on
  // top. One length is enough to show the difference: the same text that still
  // fits an untitled card no longer fits once a header is added.
  const filled = (chars: number): Presentation =>
    deckWith(containerWithDoc(paragraphDoc(words(chars))))

  it('refuses a conversion that adds chrome the content cannot afford', () => {
    const presentation = filled(1300)
    expectRefused(
      setContentKind(presentation, { ...target(presentation), kind: 'titled-card', ...checkers }),
    )
  })

  it('accepts a conversion the content still fits', () => {
    const presentation = filled(1300)
    const result = setContentKind(presentation, {
      ...target(presentation),
      kind: 'untitled-card',
      ...checkers,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses turning a picture into text it has no room for', () => {
    // A picture filling a zone is cropped to it and can never overflow; the
    // same file *inline* is as tall as the zone is wide, and the zone is far
    // wider than it is tall. So the conversion is where it stops fitting.
    const presentation = deckWith(createImage('asset-1'))
    expectRefused(
      setContentKind(presentation, { ...target(presentation), kind: 'container', ...checkers }),
    )
  })
})

/* ------------------------------------------------------------------ *
 * 4. The rules the gate must not break
 * ------------------------------------------------------------------ */

describe('fit gate boundaries', () => {
  it('validates text set through the command layer, for headless callers', () => {
    const presentation = deckWith(cardWith([paragraphDoc('kort')]))
    const overlong = {
      ...target(presentation),
      subfieldId: 'field-0',
      doc: paragraphDoc(words(6000)),
    }
    expectRefused(setSubfieldDoc(presentation, { ...overlong, ...checkers }))
  })

  it('leaves the document editable when no checkers are supplied', () => {
    // This is the editor's typing path: rollback happens against the live DOM
    // in `RichTextEditor`, which is what keeps IME composition intact.
    const presentation = deckWith(cardWith([paragraphDoc('kort')]))
    expect(
      setSubfieldDoc(presentation, {
        ...target(presentation),
        subfieldId: 'field-0',
        doc: paragraphDoc(words(6000)),
      }).ok,
    ).toBe(true)
  })

  it('lets an already-overflowing zone be repaired', () => {
    // A document that arrived overflowing (import, migration, an older build).
    const presentation = deckWith(cardWith([paragraphDoc(words(6000))]))
    const repaired = setSubfieldDoc(presentation, {
      ...target(presentation),
      subfieldId: 'field-0',
      doc: paragraphDoc(words(1000)),
      ...checkers,
    })
    expect(repaired.ok).toBe(true)

    // ... and that a change which makes it worse is still refused.
    expectRefused(
      setSubfieldDoc(presentation, {
        ...target(presentation),
        subfieldId: 'field-0',
        doc: paragraphDoc(words(9000)),
        ...checkers,
      }),
    )
  })

  it('does not block a change that cannot affect fit at all', () => {
    // Colour is not geometry: an overflowing card must still be recolourable.
    const presentation = deckWith(cardWith([paragraphDoc(words(6000))]))
    expect(
      setCardColor(presentation, { ...target(presentation), color: '#123456', ...checkers }).ok,
    ).toBe(true)
  })

  it('refuses a slide title that no longer fits, for headless callers', () => {
    const presentation = createPresentation({ title: 'Fit' })
    const slideId = presentation.slides[0].id
    expectRefused(setSlideTitle(presentation, slideId, titleDoc('A'.repeat(120)), checkers))
    expect(setSlideTitle(presentation, slideId, titleDoc('A'.repeat(120))).ok).toBe(true)
  })
})
