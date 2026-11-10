/**
 * The theme's two looks — shadows on or off, and how a card with a title draws
 * it — as the domain sees them: stored, migrated, measured and guarded.
 */

import { describe, expect, it } from 'vitest'
import {
  CARD_RADIUS,
  CARD_SHADOW,
  DEFAULT_TITLED_CARD_STYLE,
  TITLED_CARD_STYLES,
  type TitledCardStyle,
} from './constants'
import { minimumSizeForKind } from './contentSize'
import { CARD_TITLE_PART, estimateFit, estimateFitChecker, estimateTitleFitChecker, subfieldPart } from './fit'
import { cardShadow, geometryForTheme, themeMetrics } from './metrics'
import { migratePresentation } from './migrations'
import { createPresentation, defaultTheme } from './presentation'
import { paragraphDoc, titleAlign, titleDoc } from './richdoc'
import { setTheme, setZoneContent } from './commands'
import { computeSlideGeometry } from './geometry'
import { setCardLookByHand } from './commands/manualLayout'
import { contentAt } from './testDecks'
import type { Presentation, Rect, TitledCardContent } from './types'

const RECT: Rect = { x: 0, y: 0, width: 600, height: 400 }

function card(title: string, body: string): TitledCardContent {
  return {
    id: 'kort',
    kind: 'titled-card',
    headerColor: null,
    title: titleDoc(title),
    body: { axis: 'y', weights: [1], subfields: [{ id: 'felt', doc: paragraphDoc(body) }] },
  }
}

function overflowUnder(style: TitledCardStyle, content: TitledCardContent, part: string): number {
  return estimateFit(content, RECT, { theme: { ...defaultTheme(), titledCardStyle: style } }).parts[part]
}

describe('tokenene et kortutseende flytter', () => {
  it('gir innholdet ett gap mindre høyde bare når tittelen svever', () => {
    for (const style of TITLED_CARD_STYLES) {
      const tokens = themeMetrics({ titledCardStyle: style })
      const gap = style === 'floating' ? tokens.gap : 0
      expect(tokens.cardBodyOffset, style).toBe(tokens.cardHeaderHeight + gap)
    }
  })

  it('tar én hjørneradius av tittelens bredde bare for en fane', () => {
    for (const style of TITLED_CARD_STYLES) {
      expect(themeMetrics({ titledCardStyle: style }).cardTitleInset, style).toBe(
        style === 'tab' ? CARD_RADIUS : 0,
      )
    }
  })

  it('leser et tema uten valget som det alle dekk så ut som før', () => {
    expect(themeMetrics({}).titledCardStyle).toBe(DEFAULT_TITLED_CARD_STYLE)
    expect(DEFAULT_TITLED_CARD_STYLE).toBe('joined')
  })

  it('endrer ikke hvor lite et kort kan være, så et bytte aldri gjør en sone ulovlig liten', () => {
    for (const kind of ['titled-card', 'titled-image-card'] as const) {
      const sizes = TITLED_CARD_STYLES.map((style) =>
        minimumSizeForKind(kind, themeMetrics({ titledCardStyle: style })),
      )
      for (const size of sizes) expect(size, kind).toEqual(sizes[0])
    }
  })
})

describe('skygger', () => {
  it('er standardskyggen når de er på, og ingen når de er av', () => {
    expect(cardShadow(defaultTheme())).toBe(CARD_SHADOW)
    expect(cardShadow({ ...defaultTheme(), boxShadows: false })).toBe('none')
    // A theme from before the choice existed had shadows.
    expect(cardShadow({})).toBe(CARD_SHADOW)
  })
})

describe('estimatoren', () => {
  // Text that overflows under every style, so each part reports how far.
  const content = card('Tittel '.repeat(40), 'ord '.repeat(3000))

  it('gir en fanetittel én hjørneradius mindre plass enn en tittel over hele kortet', () => {
    const joined = overflowUnder('joined', content, CARD_TITLE_PART)
    expect(overflowUnder('tab', content, CARD_TITLE_PART)).toBeCloseTo(joined + CARD_RADIUS, 0)
    expect(overflowUnder('floating', content, CARD_TITLE_PART)).toBeCloseTo(joined, 0)
  })

  it('gir innholdet ett gap mindre høyde når tittelen svever', () => {
    const part = subfieldPart('felt')
    const joined = overflowUnder('joined', content, part)
    expect(overflowUnder('tab', content, part)).toBeCloseTo(joined, 0)
    expect(overflowUnder('floating', content, part)).toBeCloseTo(joined + themeMetrics().gap, 0)
  })
})

describe('titteljustering', () => {
  it('er tittelens egen, eller midtstilt når den ikke har noen', () => {
    expect(titleAlign(titleDoc('A'))).toBe('center')
    const left = titleDoc('A')
    left.content![0].attrs = { textAlign: 'left' }
    expect(titleAlign(left)).toBe('left')
  })
})

describe('lagring', () => {
  /** A deck as version 17 wrote it: no looks in the theme. */
  function storedBeforeLooks(): Record<string, unknown> {
    const deck = createPresentation({ title: 'Gammel' })
    const { boxShadows: _shadows, titledCardStyle: _style, ...theme } = deck.theme
    return { ...deck, schemaVersion: 17, theme }
  }

  it('gir et dekk fra før valgene skygger og tittel i ett kort, slik det så ut', () => {
    const migrated = migratePresentation(storedBeforeLooks())
    if (!migrated.ok) throw new Error(migrated.error.message)
    expect(migrated.value.theme).toMatchObject({ boxShadows: true, titledCardStyle: 'joined' })
  })

  it('reparerer en verdi temaet ikke kjenner i stedet for å avvise hele dekket', () => {
    const deck = createPresentation({ title: 'Rart' })
    const migrated = migratePresentation({
      ...deck,
      theme: { ...deck.theme, boxShadows: 'ja', titledCardStyle: 'sirkel' },
    })
    if (!migrated.ok) throw new Error(migrated.error.message)
    expect(migrated.value.theme).toMatchObject({ boxShadows: true, titledCardStyle: 'joined' })
  })

  it('beholder et valgt utseende', () => {
    const deck = createPresentation({ title: 'Ny' })
    const migrated = migratePresentation({
      ...deck,
      theme: { ...deck.theme, boxShadows: false, titledCardStyle: 'tab' },
    })
    if (!migrated.ok) throw new Error(migrated.error.message)
    expect(migrated.value.theme).toMatchObject({ boxShadows: false, titledCardStyle: 'tab' })
  })
})

describe('å bytte utseende', () => {
  const checkers = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }

  /** A titled card filling the slide, with as much text as fits it joined. */
  function fullCard(): Presentation {
    const deck = createPresentation({ title: 'Fullt', firstSlideHasTitle: false })
    const slide = contentAt(deck, 1)
    const rect = computeSlideGeometry(slide, geometryForTheme(deck.theme)).rects.get(slide.root.id)
    if (!rect) throw new Error('the zone has no geometry')
    // The longest body the estimator still calls fitting, found rather than assumed.
    const withText = (words: number) => card('Tittel', 'ord '.repeat(words))
    let low = 0
    let high = 4000
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2)
      if (estimateFit(withText(middle), rect, { theme: deck.theme }).fits) low = middle
      else high = middle
    }
    const placed = setZoneContent(deck, {
      slideId: slide.id,
      nodeId: slide.root.id,
      content: withText(low),
    })
    if (!placed.ok) throw new Error(placed.error.message)
    return placed.value.presentation
  }

  it('avvises for en agent når det ville skjult tekst, men går gjennom for en person', () => {
    const deck = fullCard()
    const refused = setTheme(deck, { titledCardStyle: 'floating' }, checkers)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('CONTENT_DOES_NOT_FIT')

    const chosen = setCardLookByHand(deck, { titledCardStyle: 'floating' })
    expect(chosen.ok).toBe(true)
    if (chosen.ok) expect(chosen.value.theme.titledCardStyle).toBe('floating')
  })

  it('slår av skygger uten å måle noe, fordi en skygge ikke skjuler noe', () => {
    const chosen = setCardLookByHand(fullCard(), { boxShadows: false })
    expect(chosen.ok).toBe(true)
    if (chosen.ok) expect(chosen.value.theme.boxShadows).toBe(false)
  })

  it('avviser et utseende temaet ikke kjenner', () => {
    const deck = createPresentation({ title: 'X' })
    const result = setTheme(deck, { titledCardStyle: 'sirkel' as TitledCardStyle })
    expect(result.ok).toBe(false)
  })
})
