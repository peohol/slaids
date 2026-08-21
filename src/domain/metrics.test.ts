/**
 * The two theme dials, and the one rule that matters about them: every distance
 * moves together, and every type size moves together, so the deck stays a deck
 * with exactly one gap in it at any setting.
 */

import { describe, expect, it } from 'vitest'
import {
  BODY_FONT_SIZE,
  BLOCK_SPACING,
  CARD_PADDING,
  G,
  SUBFIELD_GAP,
  TITLE_FONT_SIZE,
  TITLE_ZONE_HEIGHT,
} from './constants'
import { FONT_SCALE_RANGE, SPACING_RANGE, geometryForTheme, themeMetrics } from './metrics'
import { defaultTheme } from './presentation'

describe('themeMetrics', () => {
  it('is the base tokens at the default settings', () => {
    const metrics = themeMetrics(defaultTheme())
    expect(metrics.gap).toBe(G)
    expect(metrics.cardPadding).toBe(CARD_PADDING)
    expect(metrics.subfieldGap).toBe(SUBFIELD_GAP)
    expect(metrics.blockSpacing).toBe(BLOCK_SPACING)
    expect(metrics.bodyFontSize).toBe(BODY_FONT_SIZE)
    expect(metrics.titleFontSize).toBe(TITLE_FONT_SIZE)
  })

  it('moves every distance together and leaves type alone', () => {
    const airy = themeMetrics({ ...defaultTheme(), spacing: 1.5 })
    expect(airy.gap).toBe(Math.round(G * 1.5))
    expect(airy.cardPadding).toBe(Math.round(CARD_PADDING * 1.5))
    expect(airy.subfieldGap).toBe(Math.round(SUBFIELD_GAP * 1.5))
    expect(airy.blockSpacing).toBe(Math.round(BLOCK_SPACING * 1.5))
    expect(airy.bodyFontSize).toBe(BODY_FONT_SIZE)
  })

  it('grows the boxes whose height is dictated by type along with the type', () => {
    const big = themeMetrics({ ...defaultTheme(), fontScale: 1.3 })
    expect(big.titleFontSize).toBe(Math.round(TITLE_FONT_SIZE * 1.3))
    // A bigger title must not land in a title zone built for a smaller one.
    expect(big.titleZoneHeight).toBe(Math.round(TITLE_ZONE_HEIGHT * 1.3))
    expect(big.gap).toBe(G)
  })

  it('clamps values outside the supported range instead of producing nonsense', () => {
    expect(themeMetrics({ spacing: 99 }).gap).toBe(Math.round(G * SPACING_RANGE.max))
    expect(themeMetrics({ fontScale: -4 }).bodyFontSize).toBe(
      Math.round(BODY_FONT_SIZE * FONT_SCALE_RANGE.min),
    )
    expect(themeMetrics({ spacing: Number.NaN }).gap).toBe(G)
  })

  it('gives the geometry engine the gap and title zone the theme dictates', () => {
    const geometry = geometryForTheme({ ...defaultTheme(), spacing: 1.5, fontScale: 1.3 })
    expect(geometry.gap).toBe(Math.round(G * 1.5))
    // The inset equals the gap by definition, at every setting.
    expect(geometry.inset).toBe(geometry.gap)
    expect(geometry.titleHeight).toBe(Math.round(TITLE_ZONE_HEIGHT * 1.3))
  })
})
