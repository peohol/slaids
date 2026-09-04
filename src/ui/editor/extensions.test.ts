import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type Extensions } from '@tiptap/core'
import { acceptsInlineImage } from './SlaidsImageExtension'
import { bodyExtensions, normalizePastedHtml, titleExtensions } from './extensions'

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

describe('a field that can hold a picture', () => {
  const mounted: { editor: Editor; element: HTMLElement }[] = []

  function editorWith(extensions: Extensions): Editor {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions })
    mounted.push({ editor, element })
    return editor
  }

  afterEach(() => {
    for (const { editor, element } of mounted.splice(0)) {
      editor.destroy()
      element.remove()
    }
  })

  it('is the body, and only the body', () => {
    // The upload dialog asks this before it offers "in the text field". Get it
    // wrong for a title, a cover line or a caption and the file is stored
    // first, then the insert throws on a command that editor never had.
    expect(acceptsInlineImage(editorWith(bodyExtensions({})))).toBe(true)
    expect(acceptsInlineImage(editorWith(titleExtensions()))).toBe(false)
    expect(acceptsInlineImage(editorWith(titleExtensions(undefined, 'cover')))).toBe(false)
  })

  it('is nothing at all when no field has the caret', () => {
    expect(acceptsInlineImage(null)).toBe(false)
    expect(acceptsInlineImage(undefined)).toBe(false)
  })

  it('answers the same question the insert command does', () => {
    // The node and the command come from the same extension, so «has the node»
    // and «has the command» can only ever disagree by mistake — and it is the
    // command the dialog actually calls.
    const body = editorWith(bodyExtensions({}))
    const title = editorWith(titleExtensions())
    expect(typeof body.commands.insertSlaidsImage).toBe('function')
    expect(title.commands.insertSlaidsImage).toBeUndefined()
  })
})
