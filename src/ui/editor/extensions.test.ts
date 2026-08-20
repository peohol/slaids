import { describe, expect, it } from 'vitest'
import { normalizePastedHtml } from './extensions'

describe('normalizePastedHtml', () => {
  it('strips all inline styling', () => {
    const html = '<p style="font-size:48px;color:red" class="foreign">Tekst</p>'
    expect(normalizePastedHtml(html)).toBe('<p>Tekst</p>')
  })

  it('removes style and script elements entirely', () => {
    const html = '<style>p{color:red}</style><script>alert(1)</script><p>Trygt</p>'
    const result = normalizePastedHtml(html)
    expect(result).not.toContain('script')
    expect(result).not.toContain('style')
    expect(result).toContain('Trygt')
  })

  it('unwraps unsupported elements but keeps their text', () => {
    const html = '<div><span style="color:blue">Beholdt</span></div>'
    expect(normalizePastedHtml(html)).toBe('Beholdt')
  })

  it('flattens deep headings to the single supported level', () => {
    expect(normalizePastedHtml('<h3>Overskrift</h3>')).toBe('<h1>Overskrift</h1>')
    expect(normalizePastedHtml('<h1>Allerede</h1>')).toBe('<h1>Allerede</h1>')
  })

  it('keeps link targets but drops everything else on the anchor', () => {
    const html = '<a href="https://example.com" style="color:#f00" target="_blank">Lenke</a>'
    expect(normalizePastedHtml(html)).toBe('<a href="https://example.com">Lenke</a>')
  })

  it('keeps supported structure', () => {
    const html = '<ul><li><strong>Ett</strong></li><li><em>To</em></li></ul>'
    expect(normalizePastedHtml(html)).toBe(html)
  })

  it('drops images and embeds that would bypass the asset store', () => {
    const html = '<p>Før<img src="https://example.com/a.png" />Etter</p><iframe src="x"></iframe>'
    const result = normalizePastedHtml(html)
    expect(result).not.toContain('img')
    expect(result).not.toContain('iframe')
    expect(result).toContain('Før')
    expect(result).toContain('Etter')
  })

  it('keeps table structure without styling', () => {
    const html = '<table style="width:100px"><tr><td class="x">A</td></tr></table>'
    const result = normalizePastedHtml(html)
    expect(result).toContain('<td>A</td>')
    expect(result).not.toContain('class')
    expect(result).not.toContain('width')
  })

  it('handles empty input', () => {
    expect(normalizePastedHtml('')).toBe('')
  })
})
