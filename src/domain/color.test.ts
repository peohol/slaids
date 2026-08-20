import { describe, expect, it } from 'vitest'
import {
  BLACK,
  PALETTE,
  WHITE,
  bestTextColor,
  buildPalette,
  contrastRatio,
  hslToHex,
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

  it('picks the higher-contrast text colour', () => {
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
