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
import { createContainer, createUntitledCard } from '../content'
import { estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { FONT_OPTIONS } from '../fonts'
import { imageNode, paragraphDoc, titleDoc } from '../richdoc'
import { defaultShape } from '../content'
import type { CardBody, Presentation, RichDoc, ZoneContent } from '../types'
import {
  setBodyAxis,
  setBodyWeights,
  setCardColor,
  setContainerPayload,
  setContentKind,
  setSlideTitle,
  setSubfieldCount,
  setSubfieldDoc,
  setTheme,
  setZoneContent,
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
 * 1. Global font changes
 * ------------------------------------------------------------------ */

describe('setTheme', () => {
  // 3600 characters fill the full-slide zone at the default advance but not at
  // Verdana's, which is 16% wider.
  const filled = (): Presentation => deckWith(cardWith([paragraphDoc(words(3600))]))

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
      setSlideTitle(blank, slideId, titleDoc('A'.repeat(62)), checkers),
    )

    expectRefused(setTheme(presentation, { headingFontFamily: stack('verdana') }, checkers))
    expect(setTheme(presentation, { headingFontFamily: stack('times') }, checkers).ok).toBe(true)
  })

  it('still allows a font change that reduces an existing overflow', () => {
    // Already overflowing on Verdana — the user must be able to get out of it.
    const overflowing = deckWith(cardWith([paragraphDoc(words(3600))]), {
      bodyFontFamily: stack('verdana'),
    })
    expect(setTheme(overflowing, { bodyFontFamily: stack('merriweather') }, checkers).ok).toBe(true)
    expect(setTheme(overflowing, { bodyFontFamily: stack('system') }, checkers).ok).toBe(true)
  })

  it('keeps enforcing the rule on content that already overflows', () => {
    const overflowing = deckWith(cardWith([paragraphDoc(words(3600))]), {
      bodyFontFamily: stack('merriweather'),
    })
    expectRefused(setTheme(overflowing, { bodyFontFamily: stack('verdana') }, checkers))
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
    const presentation = deckWith(cardWith([paragraphDoc(words(2800))]))
    expectRefused(setSubfieldCount(presentation, { ...target(presentation), count: 2, ...checkers }))
  })

  it('accepts a subfield count the existing text still fits', () => {
    const presentation = deckWith(cardWith([paragraphDoc(words(1200))]))
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
    // A full-width figure is as tall as its column is wide, so stacking two
    // side-by-side subfields costs it more height than it gains.
    const figure: RichDoc = { type: 'doc', content: [imageNode('asset-1')] }
    const presentation = deckWith(cardWith([figure, paragraphDoc('')], 'x', [1, 1]))
    expectRefused(setBodyAxis(presentation, { ...target(presentation), axis: 'y', ...checkers }))
  })

  it('accepts an axis flip the content still fits', () => {
    const figure: RichDoc = { type: 'doc', content: [imageNode('asset-1')] }
    const presentation = deckWith(cardWith([figure, paragraphDoc('')], 'y', [1, 1]))
    expect(setBodyAxis(presentation, { ...target(presentation), axis: 'x', ...checkers }).ok).toBe(
      true,
    )
  })
})

/* ------------------------------------------------------------------ *
 * 3. Content-kind conversion
 * ------------------------------------------------------------------ */

describe('setContentKind', () => {
  // Fits a container, which gives the whole zone to content; a titled card
  // spends CARD_HEADER_HEIGHT + 2 * CARD_PADDING of it on chrome.
  const filled = (): Presentation =>
    deckWith(createContainer({ type: 'richdoc', doc: paragraphDoc(words(3700)) }))

  it('refuses a conversion that adds chrome the content cannot afford', () => {
    const presentation = filled()
    expectRefused(
      setContentKind(presentation, { ...target(presentation), kind: 'titled-card', ...checkers }),
    )
  })

  it('accepts a conversion the content still fits', () => {
    const presentation = filled()
    const result = setContentKind(presentation, {
      ...target(presentation),
      kind: 'untitled-card',
      ...checkers,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses a container payload that no longer fits', () => {
    const presentation = deckWith(
      createContainer({ type: 'shape', shape: defaultShape() }),
    )
    // A figure is as tall as the zone is wide; the zone is far wider than tall.
    expectRefused(
      setContainerPayload(presentation, {
        ...target(presentation),
        payload: { type: 'richdoc', doc: { type: 'doc', content: [imageNode('asset-1')] } },
        ...checkers,
      }),
    )
    expect(
      setContainerPayload(presentation, {
        ...target(presentation),
        payload: { type: 'richdoc', doc: paragraphDoc(words(200)) },
        ...checkers,
      }).ok,
    ).toBe(true)
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
