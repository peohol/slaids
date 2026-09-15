/**
 * How small a zone may be, given what is in it.
 *
 * The rule this file checks is the one that replaced a single global minimum:
 * a zone is too small when the thing inside it cannot be drawn there, and
 * nothing is inside an empty zone or a zone of deliberate air. The tests are
 * written against the general rule rather than against the layout that
 * prompted it — every kind is asked, and the two answers that have to agree
 * («may this kind exist here» and «does what is here fit») are compared
 * directly rather than trusted to stay in step.
 */

import { describe, expect, it } from 'vitest'
import { G, MIN_IMAGE_SIZE, MIN_TEXT_WIDTH } from './constants'
import { createContainer, createContentOfKind, ZONE_CONTENT_KINDS } from './content'
import {
  availableContentKinds,
  contentKindFitsRect,
  contentKindRefusal,
  minimumSizeForContent,
  minimumSizeForKind,
  zoneKindRefusal,
} from './contentSize'
import { estimateFit } from './fit'
import { computeSlideGeometry, validateSlideGeometry } from './geometry'
import { createLeaf, createSplit } from './layout'
import { paragraphDoc } from './richdoc'
import { geometryForTheme, themeMetrics, DEFAULT_SPACING, FONT_SCALE_RANGE } from './metrics'
import { createSlide } from './presentation'
import type { Rect, ZoneContentKind } from './types'

const at = (width: number, height: number): Rect => ({ x: 0, y: 0, width, height })

/**
 * The kinds that draw nothing on a slide, and therefore have no floor.
 *
 * Written out rather than derived from the minimums, because that is the
 * claim: these two are the kinds the domain says draw nothing, and the tests
 * below check that the arithmetic agrees. Deriving it would make the assertion
 * true by construction and test nothing at all.
 */
const SIZELESS_KINDS: ZoneContentKind[] = ['negative-space', 'note']

/** Every kind that draws something on the slide. */
const DRAWING_KINDS = ZONE_CONTENT_KINDS.filter((kind) => !SIZELESS_KINDS.includes(kind))

describe('typene som ikke tegner noe har ingen minstestørrelse', () => {
  it.each(SIZELESS_KINDS)('%s passer i et rektangel uten utstrekning i det hele tatt', (kind) => {
    expect(minimumSizeForKind(kind)).toEqual({ width: 0, height: 0 })
    expect(contentKindFitsRect(kind, at(0, 0))).toBe(true)
    expect(contentKindRefusal(kind, at(1, 1))).toBeNull()
  })

  it('er de eneste valgene når sonen er liten nok', () => {
    const tiny = at(24, 12)
    const available = ZONE_CONTENT_KINDS.filter((kind) => contentKindFitsRect(kind, tiny))
    expect(available).toEqual(SIZELESS_KINDS)
  })

  it.each(SIZELESS_KINDS)(
    '%s får aldri en fit-innvending, uansett hvor lite rektangelet er',
    (kind) => {
      const content = createContentOfKind(kind)
      expect(estimateFit(content, at(0, 0)).fits).toBe(true)
      expect(estimateFit(content, at(3, 2)).overflow).toBe(0)
      expect(estimateFit(content, at(3, 2)).parts).toEqual({})
    },
  )
})

describe('en tom sone, negativt rom og et notat er tre ting, ikke tre størrelser', () => {
  it('har alle null minstemål, fordi ingen av dem tegner noe', () => {
    expect(minimumSizeForContent(null)).toEqual({ width: 0, height: 0 })
    for (const kind of SIZELESS_KINDS) {
      expect(minimumSizeForContent(createContentOfKind(kind)), kind).toEqual({
        width: 0,
        height: 0,
      })
    }
  })

  it('skilles på innholdsobjektets kind, ikke på hva de tegner', () => {
    const empty = createLeaf(null)
    expect(empty.content).toBeNull()
    for (const kind of SIZELESS_KINDS) {
      expect(createLeaf(createContentOfKind(kind)).content?.kind).toBe(kind)
    }
  })
})

describe('luft / innhold / luft, med svært små luftsoner', () => {
  /**
   * The composition the rule exists for: air above, the point in the middle,
   * air below. The ratio is the far end of the ladder rather than a literal
   * `1 : 3 : 1`, because that is where the slivers get genuinely small — small
   * enough that no card and no line of text could live in them, which is
   * exactly the case that used to be refused.
   */
  const geometry = geometryForTheme()

  function slideWith(outer: 'negative-space' | 'container') {
    return createSlide({
      hasTitle: true,
      root: createSplit('y', [1, 10, 1], [
        createLeaf(createContentOfKind(outer)),
        createLeaf(createContentOfKind('container')),
        createLeaf(createContentOfKind(outer)),
      ]),
    })
  }

  it('er gyldig når luftsonene er negativt rom', () => {
    const slide = slideWith('negative-space')
    const rects = computeSlideGeometry(slide, geometry).rects
    const sliver = rects.get((slide.root as { children: { id: string }[] }).children[0].id)
    // Far below anything a card or a line of text could live in — which is the
    // whole point of the composition.
    expect(sliver?.height).toBeLessThan(minimumSizeForKind('container', geometry.metrics).height)
    expect(validateSlideGeometry(slide, geometry)).toEqual([])
  })

  it('er ugyldig når de samme sonene holder tekst', () => {
    const violations = validateSlideGeometry(slideWith('container'), geometry)
    expect(violations.filter((violation) => violation.kind === 'below-minimum')).not.toHaveLength(0)
  })
})

describe('minstemålet er innholdstypens, ikke sonens', () => {
  it('avviser innhold som trenger mer plass enn det lille rektangelet gir', () => {
    const sliver = at(MIN_TEXT_WIDTH, 20)
    for (const kind of DRAWING_KINDS) {
      const refusal = contentKindRefusal(kind, sliver)
      expect(refusal, kind).not.toBeNull()
      expect(refusal?.message, kind).toContain('for liten')
    }
  })

  it('stiller ulike krav til ulike typer', () => {
    const tokens = themeMetrics()
    // A card spends chrome a container does not: a header, padding on both
    // sides, and only then a line of text.
    expect(minimumSizeForKind('titled-card', tokens).height).toBeGreaterThan(
      minimumSizeForKind('untitled-card', tokens).height,
    )
    expect(minimumSizeForKind('untitled-card', tokens).height).toBeGreaterThan(
      minimumSizeForKind('container', tokens).height,
    )
    // A picture has no chrome at all, and no text to be narrow for.
    expect(minimumSizeForKind('image', tokens)).toEqual({
      width: MIN_IMAGE_SIZE,
      height: MIN_IMAGE_SIZE,
    })
  })

  it('vokser med skriftstørrelsen, fordi kortets krom faktisk gjør det', () => {
    const small = themeMetrics({ fontScale: FONT_SCALE_RANGE.min, spacing: DEFAULT_SPACING })
    const large = themeMetrics({ fontScale: FONT_SCALE_RANGE.max, spacing: DEFAULT_SPACING })
    expect(minimumSizeForKind('titled-card', large).height).toBeGreaterThan(
      minimumSizeForKind('titled-card', small).height,
    )
  })

  it('gir samme svar om man spør på typen eller på et faktisk innholdsobjekt', () => {
    for (const kind of ZONE_CONTENT_KINDS) {
      expect(minimumSizeForContent(createContentOfKind(kind)), kind).toEqual(
        minimumSizeForKind(kind),
      )
    }
  })
})

describe('minstemålet og fit-målingen er enige', () => {
  /**
   * The two gates have to agree at the boundary.
   *
   * A minimum that is smaller than what the fit check needs would let a zone
   * through the first gate only to be refused by the second — «you may put a
   * card here» followed immediately by «the card does not fit» — and there
   * would be no size at all at which the kind could be used.
   */
  it('lar hver innholdstype faktisk få plass i sitt eget minstemål', () => {
    for (const kind of ZONE_CONTENT_KINDS) {
      const minimum = minimumSizeForKind(kind)
      const rect = at(Math.max(1, minimum.width), Math.max(1, minimum.height))
      const fit = estimateFit(createContentOfKind(kind as ZoneContentKind), rect)
      expect(fit.fits, `${kind} ${JSON.stringify(minimum)}`).toBe(true)
    }
  })
})

describe('«kan denne sonen bli type X?» har ett svar', () => {
  /**
   * The three readers of this rule — the command, the picker and the agent's
   * inspection — used to answer parts of it separately, and drifted in both
   * directions. Both skews are checked here, on the function all three now ask.
   */
  const roomy = at(1500, 800)

  it('tilbyr ikke negativt rom i en sone som har noe å miste', () => {
    const filled = createContainer()
    const withText = {
      ...filled,
      body: {
        ...filled.body,
        subfields: [{ ...filled.body.subfields[0], doc: paragraphDoc('noe tekst') }],
      },
    }
    expect(zoneKindRefusal('negative-space', roomy, withText)?.code).toBe('INVALID_CONTENT')
    expect(availableContentKinds(roomy, withText)).not.toContain('negative-space')

    // Den samme sonen uten tekst har ingenting å miste.
    expect(availableContentKinds(roomy, filled)).toContain('negative-space')
  })

  it('tilbyr fortsatt sonens egen type når sonen er for liten for den', () => {
    // Et importert dokument, eller ett fra før en token flyttet seg. Kallet med
    // den samme typen er med vilje tillatt — det er slik dokumentet repareres —
    // så en inspeksjon som utelot den ville sendt en agent bort fra reparasjonen.
    const cramped = at(60, 40)
    const card = createContentOfKind('titled-card')
    expect(contentKindRefusal('titled-card', cramped)).not.toBeNull()
    expect(zoneKindRefusal('titled-card', cramped, card)).toBeNull()
    expect(availableContentKinds(cramped, card)).toContain('titled-card')
    // Alle andre typer som trenger mer plass er fortsatt utelatt.
    expect(availableContentKinds(cramped, card)).not.toContain('untitled-card')
  })

  it('stiller bare størrelsesspørsmålet for en tom sone', () => {
    // Å plassere friskt innhold i en tom sone er nøyaktig størrelsesregelen.
    for (const kind of ZONE_CONTENT_KINDS) {
      expect(zoneKindRefusal(kind, roomy, null), kind).toBeNull()
    }
    expect(availableContentKinds(at(4, 3), null)).toEqual(SIZELESS_KINDS)
  })

  it('spør ikke om størrelse når det ikke finnes en sone å måle mot', () => {
    expect(availableContentKinds(null, null)).toEqual([...ZONE_CONTENT_KINDS])
  })
})

describe('en split trenger plass til mellomrommene sine, uansett hva den holder', () => {
  it('godtar ti luftsoner så lenge mellomrommene får plass', () => {
    const slide = createSlide({
      hasTitle: false,
      root: createSplit(
        'y',
        Array.from({ length: 10 }, () => 1),
        Array.from({ length: 10 }, () => createLeaf(createContentOfKind('negative-space'))),
      ),
    })
    const geometry = geometryForTheme()
    // Nine gaps of the deck's own gap: the one floor a split has that has
    // nothing to do with what is in it.
    const available = computeSlideGeometry(slide, geometry).mainRect.height
    expect(available).toBeGreaterThan(geometry.gap * 9)
    expect(validateSlideGeometry(slide, geometry)).toEqual([])
  })

  it('avviser en split der mellomrommene alene er lengre enn sonen', () => {
    const slide = createSlide({
      hasTitle: false,
      root: createSplit(
        'x',
        Array.from({ length: 10 }, () => 1),
        Array.from({ length: 10 }, () => createLeaf(createContentOfKind('negative-space'))),
      ),
    })
    // A narrow slide: nine gaps need more room than the whole design space has
    // across, and the children come out with no length at all — not a layout,
    // however little is in them.
    const cramped = { ...geometryForTheme(), slideWidth: G * 6 }
    const violations = validateSlideGeometry(slide, cramped)
    expect(violations.some((violation) => violation.kind === 'below-minimum')).toBe(true)
  })
})
