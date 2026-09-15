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
  PARAGRAPH_SPACING,
  SUBFIELD_GAP,
  TITLE_FONT_SIZE,
  titleZoneHeightFor,
} from './constants'
import {
  DEFAULT_FONT_SCALE,
  DEFAULT_SPACING,
  FONT_SCALE_PRESETS,
  FONT_SCALE_RANGE,
  SPACING_PRESETS,
  SPACING_RANGE,
  geometryForTheme,
  themeMetrics,
} from './metrics'
import { defaultTheme } from './presentation'

/** Two settings inside the offered range, one on each ladder. */
const AIRY = SPACING_PRESETS[2].value
const BIG = FONT_SCALE_PRESETS[2].value

describe('themeMetrics', () => {
  it('is the base tokens at the default settings', () => {
    // The default is a rung on the ladder rather than the number 1: both dials
    // sit at «Normal», and «Normal» is airier and larger than the bare base
    // constants. What must hold is that every token is the base one scaled by
    // the dial that owns it — nothing has a default of its own.
    const metrics = themeMetrics(defaultTheme())
    expect(metrics.gap).toBe(Math.round(G * DEFAULT_SPACING))
    expect(metrics.cardPadding).toBe(Math.round(CARD_PADDING * DEFAULT_SPACING))
    expect(metrics.subfieldGap).toBe(Math.round(SUBFIELD_GAP * DEFAULT_SPACING))
    expect(metrics.blockSpacing).toBe(Math.round(BLOCK_SPACING * DEFAULT_SPACING))
    expect(metrics.paragraphSpacing).toBe(Math.round(PARAGRAPH_SPACING * DEFAULT_SPACING))
    expect(metrics.bodyFontSize).toBe(Math.round(BODY_FONT_SIZE * DEFAULT_FONT_SCALE))
    expect(metrics.titleFontSize).toBe(Math.round(TITLE_FONT_SIZE * DEFAULT_FONT_SCALE))
  })

  it('moves every distance together and leaves type alone', () => {
    const airy = themeMetrics({ ...defaultTheme(), spacing: AIRY })
    expect(airy.gap).toBe(Math.round(G * AIRY))
    expect(airy.cardPadding).toBe(Math.round(CARD_PADDING * AIRY))
    expect(airy.subfieldGap).toBe(Math.round(SUBFIELD_GAP * AIRY))
    expect(airy.blockSpacing).toBe(Math.round(BLOCK_SPACING * AIRY))
    expect(airy.paragraphSpacing).toBe(Math.round(PARAGRAPH_SPACING * AIRY))
    expect(airy.bodyFontSize).toBe(Math.round(BODY_FONT_SIZE * DEFAULT_FONT_SCALE))
  })

  it('grows the boxes whose height is dictated by type along with the type', () => {
    const big = themeMetrics({ ...defaultTheme(), fontScale: BIG })
    expect(big.titleFontSize).toBe(Math.round(TITLE_FONT_SIZE * BIG))
    // A bigger title must not land in a title zone built for a smaller one —
    // which holds by construction: the zone *is* the line the title sits on.
    expect(big.titleZoneHeight).toBe(titleZoneHeightFor(big.titleFontSize))
    expect(big.gap).toBe(Math.round(G * DEFAULT_SPACING))
  })

  it('clamps values outside the supported range instead of producing nonsense', () => {
    expect(themeMetrics({ spacing: 99 }).gap).toBe(Math.round(G * SPACING_RANGE.max))
    expect(themeMetrics({ fontScale: -4 }).bodyFontSize).toBe(
      Math.round(BODY_FONT_SIZE * FONT_SCALE_RANGE.min),
    )
    expect(themeMetrics({ spacing: Number.NaN }).gap).toBe(Math.round(G * DEFAULT_SPACING))
  })

  it('offers only settings the range allows, on both ladders', () => {
    for (const preset of SPACING_PRESETS) {
      expect(preset.value).toBeGreaterThanOrEqual(SPACING_RANGE.min)
      expect(preset.value).toBeLessThanOrEqual(SPACING_RANGE.max)
    }
    for (const preset of FONT_SCALE_PRESETS) {
      expect(preset.value).toBeGreaterThanOrEqual(FONT_SCALE_RANGE.min)
      expect(preset.value).toBeLessThanOrEqual(FONT_SCALE_RANGE.max)
    }
    // «Normal» is what a new deck opens in, on both.
    expect(SPACING_PRESETS.map((p) => p.value)).toContain(DEFAULT_SPACING)
    expect(FONT_SCALE_PRESETS.map((p) => p.value)).toContain(DEFAULT_FONT_SCALE)
  })

  it('gives the geometry engine the gap and title zone the theme dictates', () => {
    const geometry = geometryForTheme({ ...defaultTheme(), spacing: AIRY, fontScale: BIG })
    expect(geometry.gap).toBe(Math.round(G * AIRY))
    // The inset equals the gap by definition, at every setting.
    expect(geometry.inset).toBe(geometry.gap)
    expect(geometry.titleHeight).toBe(titleZoneHeightFor(Math.round(TITLE_FONT_SIZE * BIG)))
  })
})
