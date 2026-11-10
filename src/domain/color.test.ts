import { describe, expect, it } from 'vitest'
import {
  BLACK,
  PALETTE,
  WHITE,
  bestTextColor,
  buildPalette,
  contrastRatio,
  hslLightness,
  hslToHex,
  MIN_TEXT_CONTRAST,
  PALETTE_COLUMNS,
  PALETTE_HUES,
  PALETTE_HUES_PER_ROW,
  PALETTE_LIGHTNESS,
  PALETTE_SATURATION,
  TEXT_LIGHTNESS_THRESHOLD,
  isDarkColor,
  isPaletteColor,
  paletteShade,
  normalizeHex,
  relativeLuminance,
  withAlpha,
} from './color'

describe('palette', () => {
  const hueRows = PALETTE.slice(0, -1)

  it('groups the hues by row, each running from darkest to lightest, then black and white', () => {
    expect(hueRows).toHaveLength(Math.ceil(PALETTE_HUES.length / PALETTE_HUES_PER_ROW))
    const runs = hueRows.flatMap((row) => {
      expect(row).toHaveLength(PALETTE_HUES_PER_ROW * PALETTE_LIGHTNESS.length)
      return Array.from({ length: PALETTE_HUES_PER_ROW }, (_, index) =>
        row.slice(index * PALETTE_LIGHTNESS.length, (index + 1) * PALETTE_LIGHTNESS.length),
      )
    })
    expect(runs).toEqual(
      PALETTE_HUES.map((hue) => PALETTE_LIGHTNESS.map((l) => hslToHex(hue, PALETTE_SATURATION, l))),
    )
    for (const run of runs) {
      const lightness = run.map(hslLightness)
      expect(lightness).toEqual([...lightness].sort((a, b) => a - b))
    }
    expect(PALETTE.at(-1)).toEqual([BLACK, WHITE])
  })

  it('is as wide as its widest row', () => {
    expect(PALETTE_COLUMNS).toBe(PALETTE_HUES_PER_ROW * PALETTE_LIGHTNESS.length)
  })

  it('has every hue once at each lightness step', () => {
    for (const l of PALETTE_LIGHTNESS) {
      const shade = paletteShade(l)
      expect(shade).toHaveLength(PALETTE_HUES.length)
      for (const color of shade) expect(PALETTE.flat()).toContain(color)
    }
    expect(new Set(PALETTE.flat()).size).toBe(PALETTE.flat().length)
  })

  it('knows its own colours in any hex spelling, and nothing else', () => {
    for (const color of PALETTE.flat()) expect(isPaletteColor(color.toUpperCase())).toBe(true)
    expect(isPaletteColor('#fff')).toBe(true)
    expect(isPaletteColor('#123456')).toBe(false)
    expect(isPaletteColor('papayawhip')).toBe(false)
  })

  it('is deterministic', () => {
    expect(buildPalette()).toEqual(PALETTE)
  })

  it('produces valid hex colours', () => {
    for (const row of PALETTE) {
      for (const color of row) expect(normalizeHex(color)).toBe(color)
    }
  })
})

describe('hslToHex', () => {
  it('converts the primary hues', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000')
    expect(hslToHex(120, 100, 50)).toBe('#00ff00')
    expect(hslToHex(240, 100, 50)).toBe('#0000ff')
  })

  it('handles greys and wraps hue', () => {
    expect(hslToHex(0, 0, 0)).toBe('#000000')
    expect(hslToHex(0, 0, 100)).toBe('#ffffff')
    expect(hslToHex(360, 100, 50)).toBe(hslToHex(0, 100, 50))
  })
})

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5)
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5)
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5)
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5)
  })

  it('derives HSL lightness from hex', () => {
    expect(hslLightness(BLACK)).toBe(0)
    expect(hslLightness(WHITE)).toBe(100)
    for (const l of PALETTE_LIGHTNESS) expect(hslLightness(hslToHex(90, 25, l))).toBeCloseTo(l, 0)
  })

  it('gives every swatch of one lightness the same text colour, chosen by lightness', () => {
    for (const l of PALETTE_LIGHTNESS) {
      const shade = paletteShade(l)
      const expected = l < TEXT_LIGHTNESS_THRESHOLD ? WHITE : BLACK
      expect(shade.map(bestTextColor)).toEqual(shade.map(() => expected))
    }
  })

  it('picks white on dark and black on light backgrounds', () => {
    expect(bestTextColor('#ffffff')).toBe(BLACK)
    expect(bestTextColor('#000000')).toBe(WHITE)
    expect(bestTextColor('#667788')).toBe(WHITE)
    expect(bestTextColor('#eeeeee')).toBe(BLACK)
  })

  it('always picks a text colour that clears the WCAG AA large-text threshold', () => {
    const saturated = PALETTE_HUES.flatMap((h) =>
      [30, 50, 70].flatMap((l) => [hslToHex(h, 100, l), hslToHex(h, 60, l)]),
    )
    for (const color of [...PALETTE.flat(), ...saturated]) {
      expect(contrastRatio(color, bestTextColor(color))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
    expect(bestTextColor('#0000ff')).toBe(WHITE)
  })

  it('classifies dark backgrounds', () => {
    expect(isDarkColor('#222222')).toBe(true)
    expect(isDarkColor('#f0f0f0')).toBe(false)
  })
})

describe('helpers', () => {
  it('normalises shorthand hex', () => {
    expect(normalizeHex('#678')).toBe('#667788')
    expect(normalizeHex('  #ABCDEF ')).toBe('#abcdef')
    expect(normalizeHex('rgb(0,0,0)')).toBeNull()
  })

  it('adds alpha', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })
})
