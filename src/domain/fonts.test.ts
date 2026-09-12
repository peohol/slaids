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

describe('guaranteed web-font stacks', () => {
  it('adds a controlled symbol fallback without forgetting stored legacy stacks', () => {
    const canonical = fontStackFor('quicksand')

    expect(canonical).toContain(`'${SYMBOL_FALLBACK_WEB_FONT}'`)
    expect(findFontByStack(LEGACY_QUICKSAND)?.id).toBe('quicksand')
    expect(renderFontStack(LEGACY_QUICKSAND)).toBe(canonical)
    expect(webFontsFor([LEGACY_QUICKSAND])).toEqual(['Quicksand'])
  })

  it('requests the authored family and the symbol fallback from one stylesheet', () => {
    const href = googleFontsHref('Quicksand')

    expect(href).toContain('family=Quicksand:wght@400;600;700')
    expect(href).toContain('family=Noto+Sans+Symbols+2')
  })

  it('does not turn a local/system stack into a network font', () => {
    const system = "system-ui, 'Segoe UI', Roboto, Arial, sans-serif"
    expect(renderFontStack(system)).toBe(system)
    expect(webFontsFor([system])).toEqual([])
  })
})
