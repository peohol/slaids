import { describe, expect, it } from 'vitest'
import {
  SYMBOL_FALLBACK_WEB_FONT,
  findFontByStack,
  fontStackFor,
  googleFontsHref,
  renderFontStack,
  webFontsFor,
} from './fonts'

const LEGACY_QUICKSAND = "'Quicksand', 'Segoe UI', system-ui, sans-serif"
const SYMBOLS_2_QUICKSAND =
  "'Quicksand', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif"

describe('guaranteed web-font stacks', () => {
  it('uses the basic-Arrows symbol face and keeps both older stored stacks compatible', () => {
    const canonical = fontStackFor('quicksand')

    expect(SYMBOL_FALLBACK_WEB_FONT).toBe('Noto Sans Symbols')
    expect(canonical).toContain("'Noto Sans Symbols'")
    for (const legacy of [LEGACY_QUICKSAND, SYMBOLS_2_QUICKSAND]) {
      expect(findFontByStack(legacy)?.id).toBe('quicksand')
      expect(renderFontStack(legacy)).toBe(canonical)
      expect(webFontsFor([legacy])).toEqual(['Quicksand'])
    }
  })

  it('requests the authored family and the symbol fallback from one stylesheet', () => {
    const href = googleFontsHref('Quicksand')

    expect(href).toContain('family=Quicksand:wght@400;600;700')
    expect(href).toContain('family=Noto+Sans+Symbols')
    expect(href).not.toContain('family=Noto+Sans+Symbols+2')
  })

  it('does not turn a local/system stack into a network font', () => {
    const system = "system-ui, 'Segoe UI', Roboto, Arial, sans-serif"
    expect(renderFontStack(system)).toBe(system)
    expect(webFontsFor([system])).toEqual([])
  })
})
