import { afterEach, describe, expect, it } from 'vitest'
import { Editor, getSchema, type Extensions } from '@tiptap/core'
import { acceptsInlineImage } from './SlaidsImageExtension'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { alignmentIsActive, bodyExtensions, normalizePastedHtml, titleExtensions } from './extensions'
import { DEFAULT_TEXT_ALIGN, type AlignableBlock } from '../../domain/constants'
import { RichDocView } from '../slide/RichDocView'
import { dropAssetIds } from '../../domain/docs'
import type { DocField } from '../../domain/richdoc'
import { containerWithDoc } from '../../domain/content'
import { createLeaf } from '../../domain/layout'
import { createPresentation } from '../../domain/presentation'
import type { Presentation, RichDoc } from '../../domain/types'
import { contentAt, sectionAt } from '../../domain/testDecks'

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

describe('subscript and superscript: everywhere text can be typed', () => {
  const mounted: { editor: Editor; element: HTMLElement }[] = []

  function editorWith(extensions: Extensions): Editor {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions, content: '<p>x</p>' })
    mounted.push({ editor, element })
    return editor
  }

  afterEach(() => {
    for (const { editor, element } of mounted.splice(0)) {
      editor.destroy()
      element.remove()
    }
  })

  it.each([
    ['the body', bodyExtensions({})],
    ['a slide title', titleExtensions()],
    ['a cover line', titleExtensions(undefined, 'cover')],
  ])('toggles both marks in %s', (_label, extensions) => {
    const editor = editorWith(extensions)
    editor.commands.selectAll()

    editor.commands.toggleSuperscript()
    expect(editor.isActive('superscript')).toBe(true)

    // Applying subscript on top clears superscript rather than stacking: a
    // character cannot be sunk below the baseline and raised above it at once.
    editor.commands.toggleSubscript()
    expect(editor.isActive('subscript')).toBe(true)
    expect(editor.isActive('superscript')).toBe(false)

    editor.commands.toggleSubscript()
    expect(editor.isActive('subscript')).toBe(false)
  })

  it('draws the marks as the same tags the browser gives sub/sup their meaning from', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'H' },
            { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
            { type: 'text', text: 'O' },
            { type: 'text', text: '2', marks: [{ type: 'superscript' }] },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(createElement(RichDocView, { doc }))
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('<sup>2</sup>')
  })
})

describe('alignment: what is stored versus what is drawn', () => {
  const mounted: { editor: Editor; element: HTMLElement }[] = []

  function editorWith(content: RichDoc, extensions: Extensions = bodyExtensions({})): Editor {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions, content })
    mounted.push({ editor, element })
    return editor
  }

  afterEach(() => {
    for (const { editor, element } of mounted.splice(0)) {
      editor.destroy()
      element.remove()
    }
  })

  function docOfOne(type: string): RichDoc {
    return { type: 'doc', content: [{ type, content: [{ type: 'text', text: 'Hei' }] }] }
  }

  /**
   * Every kind of block that stores an alignment as text, in the field it is
   * written in. Each is drawn with its own kind's default when it stores none,
   * so every rule below has to hold for each of them, whatever the defaults are.
   */
  const KINDS: { name: string; block: AlignableBlock; doc: RichDoc; field: DocField; extensions: () => Extensions }[] = [
    { name: 'running text', block: 'text', doc: docOfOne('paragraph'), field: 'body', extensions: () => bodyExtensions({}) },
    { name: 'an accent', block: 'accent', doc: docOfOne('heading'), field: 'body', extensions: () => bodyExtensions({}) },
    { name: 'a title', block: 'title', doc: docOfOne('paragraph'), field: 'title', extensions: () => titleExtensions() },
  ]

  /** The alignment the first block of the emitted document actually carries. */
  function storedAlign(editor: Editor): unknown {
    const doc = editor.getJSON() as RichDoc
    return doc.content?.[0]?.attrs?.textAlign
  }

  describe.each(KINDS)('$name', ({ block, doc, field, extensions }) => {
    const fallback = DEFAULT_TEXT_ALIGN[block]
    const other = (['left', 'center', 'right'] as const).find((value) => value !== fallback)!

    it('stays unaligned after it is edited', () => {
      // The whole point of the default living in one constant is that it can be
      // moved later without rewriting documents — which only holds if absent
      // stays absent. A schema default would not: ProseMirror fills it into
      // every node and `getJSON` writes it straight back out, so the first
      // keystroke in an old field would freeze today's default into it forever.
      const editor = editorWith(doc, extensions())
      expect(storedAlign(editor)).toBeNull()

      editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'x')
      expect(editor.getText()).toBe('Heix')
      expect(storedAlign(editor)).toBeNull()
    })

    it('stores an alignment somebody picked, the default one included', () => {
      // Default-by-absence and the same value on purpose are two different
      // documents: the first follows the default wherever it goes, the second
      // does not.
      const editor = editorWith(doc, extensions())
      editor.commands.setTextAlign(fallback)
      expect(storedAlign(editor)).toBe(fallback)

      editor.commands.setTextAlign(other)
      expect(storedAlign(editor)).toBe(other)

      // And taking the choice back stores nothing again, rather than a third
      // state that means the same as the first.
      editor.commands.unsetTextAlign()
      expect(storedAlign(editor)).toBeNull()
    })

    it('is drawn with its own default by both renderers when it stores nothing', () => {
      // Both renderers write the same inline style, so one stylesheet can place a
      // heading pill and a picture — which are positioned by `margin-inline`
      // through selectors that read it — without knowing which one drew them.
      const editor = editorWith(doc, extensions())
      expect(editor.getHTML()).toContain(`text-align: ${fallback}`)
      expect(renderToStaticMarkup(createElement(RichDocView, { doc, field }))).toContain(`text-align:${fallback}`)
    })

    it('lights up the button for the alignment it is drawn with', () => {
      // The toolbar says what is on screen, not what is in the file: a block
      // nobody aligned reads as aligned the way its default draws it.
      const editor = editorWith(doc, extensions())
      expect(alignmentIsActive(editor, fallback)).toBe(true)
      expect(alignmentIsActive(editor, other)).toBe(false)

      editor.commands.setTextAlign(other)
      expect(alignmentIsActive(editor, other)).toBe(true)
      expect(alignmentIsActive(editor, fallback)).toBe(false)
    })
  })

  it('reads running text from the left, and sets titles and accents apart in the middle', () => {
    // The product decision itself, stated once: the defaults above are free to
    // be anything, but these are the ones a new field starts from.
    expect(DEFAULT_TEXT_ALIGN.text).toBe('left')
    expect(DEFAULT_TEXT_ALIGN.accent).toBe('center')
    expect(DEFAULT_TEXT_ALIGN.title).toBe('center')
  })
})

/* ------------------------------------------------------------------ *
 * dropAssetIds against the schema the editor actually uses
 * ------------------------------------------------------------------ */

/**
 * A picture is a *block*, so it can be the only thing inside a quote or a table
 * cell — and both of those require at least one block. Removing it therefore
 * has to leave something behind, or the document stops being a document. The
 * check belongs here rather than beside `dropAssetIds` because the authority on
 * "is this a valid document" is the schema the editor is built from, not our
 * reading of it: `node.check()` is ProseMirror answering.
 */
function parsedByTheEditor(doc: RichDoc): void {
  getSchema(bodyExtensions()).nodeFromJSON(doc).check()
}

function deckWithDoc(doc: RichDoc): Presentation {
  const base = createPresentation({ title: 'Figur i en beholder' })
  return {
    ...base,
    slides: [sectionAt(base, 0),{ ...contentAt(base, 1), root: createLeaf(containerWithDoc(doc)) }],
  }
}

function docOf(presentation: Presentation): RichDoc {
  const content = contentAt(presentation, 1).root
  if (content.kind !== 'leaf' || !content.content) throw new Error('Fant ikke innholdet')
  const body = 'body' in content.content ? content.content.body : null
  if (!body) throw new Error('Fant ikke kroppen')
  return body.subfields[0].doc
}

const IMAGE = { type: 'slaidsImage', attrs: { assetId: 'borte', alt: '' } }

describe('dropAssetIds mot editorens schema', () => {
  it('bekrefter at en tom beholder faktisk er ugyldig', () => {
    // The premise of the two tests below, stated rather than assumed.
    expect(() => parsedByTheEditor({ type: 'doc', content: [{ type: 'blockquote' }] })).toThrow()
  })

  it('etterlater et gyldig dokument når figuren var alt sitatet hadde', () => {
    const doc: RichDoc = { type: 'doc', content: [{ type: 'blockquote', content: [IMAGE] }] }
    const dropped = dropAssetIds(deckWithDoc(doc), new Set(['borte']))
    const after = docOf(dropped)

    expect(JSON.stringify(after)).not.toContain('borte')
    expect(() => parsedByTheEditor(after)).not.toThrow()
  })

  it('etterlater et gyldig dokument når figuren var alt en tabellcelle hadde', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [IMAGE] },
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
              ],
            },
          ],
        },
      ],
    }
    const dropped = dropAssetIds(deckWithDoc(doc), new Set(['borte']))
    const after = docOf(dropped)

    expect(JSON.stringify(after)).not.toContain('borte')
    expect(() => parsedByTheEditor(after)).not.toThrow()
  })

  it('etterlater et gyldig dokument når figuren var alt et listepunkt hadde', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [IMAGE] }] }],
    }
    const dropped = dropAssetIds(deckWithDoc(doc), new Set(['borte']))
    expect(() => parsedByTheEditor(docOf(dropped))).not.toThrow()
  })
})
