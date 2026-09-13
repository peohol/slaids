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
  createCaption,
  createContainer,
  createImage,
  createTitledCard,
  createTitledImageCard,
  createUntitledCard,
} from '../content'
import { CARD_TITLE_PART, estimateFit } from '../fit'
import { computeSlideGeometry } from '../geometry'
import { collectLeaves } from '../layout'
import { fitContextFor, slideOverflow } from './fitGuard'
import { estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { DEFAULT_SPACING, FONT_SCALE_RANGE, SPACING_RANGE, geometryForTheme } from '../metrics'
import { FIT_TOLERANCE } from '../constants'
import { findPresentationIssues } from '../validation'
import { FONT_OPTIONS } from '../fonts'
import { imageNode, paragraphDoc, titleDoc } from '../richdoc'
import type { CardBody, Presentation, Rect, RichDoc, ZoneContent } from '../types'
import {
  setBodyAxis,
  setBodyLayout,
  setBodyWeights,
  setCardColor,
  setCardTitle,
  setContentKind,
  setImageCaption,
  setSlideTitle,
  setSubfieldCount,
  setSubfieldDoc,
  setTheme,
  setZoneContent,
  splitLeaf,
} from './index'
import { contentAt } from '../testDecks'

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

/**
 * A wide banner with one line of text under it.
 *
 * The shape every layout case below is built on, because it is the one where a
 * figure's own rule bites: `.rd-image-wrapper` is capped at the height of its
 * field, so the picture is never what overflows — it takes the room it is
 * given and the text under it is what has nowhere to go. A figure on its own
 * would fit every layout there is, which is exactly the invariant
 * `en figur er alltid innelukket av feltet sitt` states.
 */
function bannerAndLine(aspect = 4): RichDoc {
  return {
    type: 'doc',
    content: [
      imageNode('asset-1', { aspect }),
      { type: 'paragraph', content: [{ type: 'text', text: 'En bildetekst.' }] },
    ],
  }
}

/** A one-slide deck, no title zone, with `content` filling the whole slide. */
function deckWith(content: ZoneContent, theme?: Partial<Presentation['theme']>): Presentation {
  const presentation = createPresentation({ title: 'Fit', firstSlideHasTitle: false, theme })
  const slide = contentAt(presentation, 1)
  return unwrap(
    setZoneContent(presentation, { slideId: slide.id, nodeId: slide.root.id, content }),
  ).presentation
}

/** The one zone's rectangle, under the deck's own theme. */
function rectOf(presentation: Presentation): Rect {
  const slide = contentAt(presentation, 1)
  const rect = computeSlideGeometry(slide, geometryForTheme(presentation.theme)).rects.get(
    slide.root.id,
  )
  if (!rect) throw new Error('the zone has no geometry')
  return rect
}

function target(presentation: Presentation): { slideId: string; nodeId: string } {
  const slide = contentAt(presentation, 1)
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

  /**
   * Seven columns, each holding an empty text container.
   *
   * The containers are the point. Empty zones have no minimum — nothing is
   * drawn in them, so no rectangle is too small for them — and a text zone is
   * the narrowest thing that *does* have one. Nothing overflows either way, so
   * the fit guard has nothing to say about any of this: what a wider gap breaks
   * here is the zone, not the text in it.
   */
  function splitWide(): Presentation {
    const presentation = createPresentation({
      title: 'Minstemål',
      firstSlideHasTitle: false,
      theme: { spacing: TIGHTEST },
    })
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        axis: 'x',
        weights: [1, 1, 1, 1, 1, 1, 1],
        ...checkers,
      }),
    ).presentation
    let filled = split
    for (const leaf of collectLeaves(contentAt(split, 1).root)) {
      filled = unwrap(
        setZoneContent(filled, {
          slideId: slide.id,
          nodeId: leaf.id,
          content: createContainer(),
          ...checkers,
        }),
      ).presentation
    }
    return filled
  }

  it('refuses air that would make the zones smaller than their content needs', () => {
    // Nothing overflows — the containers are empty — so the fit guard has
    // nothing to say. Committed anyway, this is a deck `findSlideIssues` calls
    // invalid: no container can be drawn that narrow.
    const result = setTheme(splitWide(), { spacing: DEFAULT_SPACING }, checkers)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ZONE_TOO_SMALL')
  })

  it('lets the same air through once the columns are deliberate space', () => {
    // The same seven columns at the same width, holding air instead of text:
    // legal, because nothing in them can be hidden by being narrow. This is the
    // whole of the new rule in one comparison.
    const air = splitWide()
    let emptied = air
    for (const leaf of collectLeaves(contentAt(air, 1).root)) {
      emptied = unwrap(
        setContentKind(emptied, {
          slideId: contentAt(air, 1).id,
          nodeId: leaf.id,
          kind: 'negative-space',
          ...checkers,
        }),
      )
    }
    expect(setTheme(emptied, { spacing: DEFAULT_SPACING }, checkers).ok).toBe(true)
  })

  it('accepts air the zones still satisfy', () => {
    expect(setTheme(splitWide(), { spacing: TIGHTEST + 0.1 }, checkers).ok).toBe(true)
  })

  it('refuses a change that makes an already too small zone smaller still', () => {
    // The case a set of node ids cannot see: the same zones are on the list
    // before and after, and every one of them got worse. The «Normal» rung
    // already leaves the seven columns a hair under what a container needs;
    // «Luftig» takes them further under. Nothing is hidden by it — the
    // containers are empty — so the fit guard has nothing to say either.
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
    expect(setTheme(broken, { spacing: 2.4 }, checkers).ok).toBe(true)
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
    const slideId = blank.slides[1].id
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
    const slideId = blank.slides[1].id
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
    // Nothing fit-relevant moved — the same fonts and the same scales — so
    // nothing is measured.
    expect(setTheme(filled(), { ...filled().theme }, counting).ok).toBe(true)
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
    // A figure is contained by its field and can never overflow on its own, so
    // what runs out of room is the line under it. Stacking gives the field half
    // the height; the banner grows to fill whatever it is given, and the
    // sentence below it is what falls off the bottom.
    const presentation = deckWith(cardWith([bannerAndLine(), paragraphDoc('')], 'x', [1, 1]))
    expectRefused(setBodyAxis(presentation, { ...target(presentation), axis: 'y', ...checkers }))
  })

  it('accepts an axis flip the content still fits', () => {
    // The same shape with a flatter banner: it is shorter than the stacked
    // field to begin with, so the flip changes nothing that has to fit.
    const presentation = deckWith(cardWith([bannerAndLine(8), paragraphDoc('')], 'y', [1, 1]))
    expect(setBodyAxis(presentation, { ...target(presentation), axis: 'x', ...checkers }).ok).toBe(
      true,
    )
  })

  it('lets a figure fill whatever field it is given, because it is contained by it', () => {
    // The rule the three cases above are built on, stated on its own. A
    // portrait photograph is three times as tall as it is wide, so uncapped it
    // would need three columns' worth of height — but `.rd-image-wrapper` is
    // `max-height: 100%`, so the browser draws it at the height of the field
    // and nothing is hidden. Every layout below therefore fits, and an
    // estimator that said otherwise would refuse slides the renderer draws
    // perfectly. Checked against a real browser in `src/render/fitParity.test.ts`.
    const portrait: RichDoc = { type: 'doc', content: [imageNode('asset-1', { aspect: 1 / 3 })] }
    const presentation = deckWith(cardWith([portrait]))
    const where = target(presentation)

    expect(setSubfieldCount(presentation, { ...where, count: 2, ...checkers }).ok).toBe(true)
    expect(
      setBodyLayout(presentation, { ...where, subfieldCount: 3, axis: 'y', ...checkers }).ok,
    ).toBe(true)
    expect(
      setBodyLayout(presentation, { ...where, subfieldCount: 2, axis: 'x', weights: [9, 1], ...checkers })
        .ok,
    ).toBe(true)
  })

  it('reaches in one gated step a layout the same layout in two steps cannot', () => {
    // This is why count, axis and weights are one command. Two subfields side
    // by side hold what two stacked subfields do not: stacking halves the
    // height, and a figure fills all of whatever height it is given, so the
    // line under it is pushed out — while splitting sideways makes the figure
    // narrower and therefore shorter, and leaves the line room. Asking for the
    // count first and the axis second never arrives — the intermediate is
    // measured on its own terms and refused — so the destination would be
    // unreachable, not merely awkward.
    const presentation = deckWith(cardWith([bannerAndLine()]))

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

  it('refuses turning a captioned picture into text it has no room for', () => {
    // Both halves of the conversion are contained on their own: the picture
    // filling the zone is cropped to it, and the same file inline is capped at
    // the height of the field. The caption is what has nowhere to go — over the
    // picture it is a label floating on top of it, and under it as text it is a
    // paragraph below a figure that already fills the field.
    const picture = createImage('asset-1')
    const presentation = deckWith({
      ...picture,
      image: { ...picture.image, caption: createCaption('bottom', paragraphDoc(words(400))) },
    })
    expectRefused(
      setContentKind(presentation, { ...target(presentation), kind: 'container', ...checkers }),
    )
  })
})

/* ------------------------------------------------------------------ *
 * 3.5. Every text surface, and none of them hiding behind another
 * ------------------------------------------------------------------ */

describe('hver tekstflate måles for seg', () => {
  /** A card title long enough that no header could ever hold it. */
  const LONG_TITLE = words(300)

  it('avviser en korttittel som er for bred for kortheaderen', () => {
    const presentation = deckWith(createTitledCard('Kort'))
    expectRefused(
      setCardTitle(presentation, {
        ...target(presentation),
        doc: titleDoc(LONG_TITLE),
        ...checkers,
      }),
    )
  })

  it('avviser den samme tittelen på et kort med bilde', () => {
    const presentation = deckWith(createTitledImageCard('asset-1', 'Kort'))
    expectRefused(
      setCardTitle(presentation, {
        ...target(presentation),
        doc: titleDoc(LONG_TITLE),
        ...checkers,
      }),
    )
  })

  it('lar ikke en full brødtekst skjule at tittelen begynner å flyte over', () => {
    /*
     * The hole a single worst number per zone left open.
     *
     * The body is already over its box — a legacy document, an import, a font
     * that arrived wider — so the zone's worst overflow is the body's. Growing
     * the title out of its header then changed nothing about that one number,
     * and «never worse» read as «nothing happened». Measured per region, the
     * header is its own place and the header got worse.
     */
    const card = createTitledCard('Kort')
    const overfull: ZoneContent = {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc(words(6000)) }],
      },
    }
    const presentation = deckWith(overfull)
    // Long enough not to fit the header, and deliberately *shorter* in overflow
    // than the body already is — so the zone's worst number is unchanged and
    // only a per-region comparison can see that anything happened. Asserted
    // rather than assumed: a title that grew past the body would make this
    // test pass for the wrong reason.
    const hiddenTitle = titleDoc(words(140))
    const before = slideOverflow(contentAt(presentation, 1), fitContextFor(presentation), checkers)
    const bodyOverflow = [...before.values()].reduce((worst, value) => Math.max(worst, value), 0)
    const after = estimateFit(
      { ...overfull, title: hiddenTitle },
      rectOf(presentation),
      fitContextFor(presentation),
    )
    expect(after.parts[CARD_TITLE_PART]).toBeGreaterThan(FIT_TOLERANCE)
    expect(after.parts[CARD_TITLE_PART]).toBeLessThan(bodyOverflow)
    expect(after.overflow).toBe(bodyOverflow)

    expectRefused(
      setCardTitle(presentation, { ...target(presentation), doc: hiddenTitle, ...checkers }),
    )
  })

  it('lar det samme kortet fortsatt repareres i riktig retning', () => {
    // The other half of the rule: an already overflowing document must stay
    // editable towards less overflow, per region as well as in total.
    const card = createTitledCard('Kort')
    const overfull: ZoneContent = {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc(words(6000)) }],
      },
    }
    const presentation = deckWith(overfull)
    const shorter = setSubfieldDoc(presentation, {
      ...target(presentation),
      subfieldId: card.body.subfields[0].id,
      doc: paragraphDoc(words(3000)),
      ...checkers,
    })
    expect(shorter.ok).toBe(true)
  })

  it('avviser en bildetekst som er for lang for bildet', () => {
    const picture = createImage('asset-1')
    const presentation = deckWith(picture)
    expectRefused(
      setImageCaption(presentation, {
        ...target(presentation),
        doc: paragraphDoc(words(4000)),
        ...checkers,
      }),
    )
  })

  it('rapporterer hvilken del av sonen som ikke får plass', () => {
    const presentation = deckWith(createTitledCard('Kort'))
    const refused = setCardTitle(presentation, {
      ...target(presentation),
      doc: titleDoc(LONG_TITLE),
      ...checkers,
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.details?.part).toBe(CARD_TITLE_PART)
  })

  it('gir read-only-valideringen den samme delen, for det samme dokumentet', () => {
    // The guard and the validator must agree about the same state: a document
    // that got past the guard some other way is described in the same terms.
    const presentation = deckWith({
      ...createTitledCard('Kort'),
      title: titleDoc(LONG_TITLE),
    })
    const issues = findPresentationIssues(presentation, checkers)
    const clipped = issues.find((issue) => issue.code === 'CONTENT_DOES_NOT_FIT')
    expect(clipped?.details?.part).toBe(CARD_TITLE_PART)
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
    const slideId = presentation.slides[1].id
    expectRefused(setSlideTitle(presentation, slideId, titleDoc('A'.repeat(120)), checkers))
    expect(setSlideTitle(presentation, slideId, titleDoc('A'.repeat(120))).ok).toBe(true)
  })
})
