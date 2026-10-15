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
  PALETTE_LIGHTNESS,
  isDarkColor,
  normalizeHex,
  relativeLuminance,
  withAlpha,
} from './color'

describe('palette', () => {
  it('has four hue rows of twelve plus a black/white row', () => {
    expect(PALETTE).toHaveLength(5)
    for (const row of PALETTE.slice(0, 4)) expect(row).toHaveLength(12)
    expect(PALETTE[4]).toEqual([BLACK, WHITE])
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

  it('gives every swatch in a palette row the same text colour, chosen by lightness', () => {
    expect(PALETTE[0].map(bestTextColor)).toEqual(PALETTE[0].map(() => WHITE))
    expect(PALETTE[1].map(bestTextColor)).toEqual(PALETTE[1].map(() => WHITE))
    expect(PALETTE[2].map(bestTextColor)).toEqual(PALETTE[2].map(() => BLACK))
    expect(PALETTE[3].map(bestTextColor)).toEqual(PALETTE[3].map(() => BLACK))
  })

  it('picks white on dark and black on light backgrounds', () => {
    expect(bestTextColor('#ffffff')).toBe(BLACK)
    expect(bestTextColor('#000000')).toBe(WHITE)
    expect(bestTextColor('#667788')).toBe(WHITE)
    expect(bestTextColor('#eeeeee')).toBe(BLACK)
  })

  it('always picks a text colour that clears the WCAG AA large-text threshold', () => {
    for (const row of PALETTE) {
      for (const color of row) {
        expect(contrastRatio(color, bestTextColor(color))).toBeGreaterThan(3)
      }
    }
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
