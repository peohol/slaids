/**
 * Tiptap schema for Slaids.
 *
 * The schema is deliberately narrow: only nodes Slaids can lay out and measure
 * exist, so pasted content cannot smuggle in foreign structure. Styling is never
 * stored — a heading is a heading, not a font-size.
 */

import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import TextAlign from '@tiptap/extension-text-align'
import { Placeholder } from '@tiptap/extensions'
import { bestTextColor } from '../../domain/color'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import type { Extensions } from '@tiptap/react'
import { CitationExtension } from './CitationExtension'
import { SlaidsImageExtension } from './SlaidsImageExtension'
import { PlainPasteExtension } from './PlainPasteExtension'
import { TrailingLineExtension } from './TrailingLineExtension'

/** Tags we accept from an external paste. Everything else is unwrapped. */
const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'STRIKE',
  'DEL',
  'A',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'CODE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
  'HR',
])

/**
 * Strip every trace of foreign styling from pasted HTML and flatten headings to
 * the single heading level Slaids supports.
 */
export function normalizePastedHtml(html: string): string {
  if (typeof document === 'undefined') return html
  const parsed = new DOMParser().parseFromString(html, 'text/html')

  parsed.querySelectorAll('style, script, meta, link, svg, img, iframe, object').forEach((node) => {
    node.remove()
  })

  const walk = (element: Element): void => {
    for (const child of [...element.children]) walk(child)

    if (!ALLOWED_TAGS.has(element.tagName)) {
      // Keep the text, drop the element.
      element.replaceWith(...element.childNodes)
      return
    }

    for (const attribute of [...element.attributes]) {
      const keep = element.tagName === 'A' && attribute.name === 'href'
      if (!keep) element.removeAttribute(attribute.name)
    }

    if (/^H[2-6]$/.test(element.tagName)) {
      const heading = parsed.createElement('h1')
      heading.append(...element.childNodes)
      element.replaceWith(heading)
    }
  }

  for (const child of [...parsed.body.children]) walk(child)
  return parsed.body.innerHTML
}

/** The alignments a Slaids document can store. */
export const ALIGNMENTS = ['left', 'center', 'right'] as const
export type Alignment = (typeof ALIGNMENTS)[number]

/**
 * Headings are pills. There is exactly one heading level; the only thing the
 * author picks is the pill colour, and the text colour follows from contrast.
 *
 * The colour defaults to `null`, and that is the whole point: a heading nobody
 * picked a colour for stores nothing, and is painted with the deck's default —
 * `cover.pillColor`, delivered as the `--slaids-heading-pill` custom property.
 * So changing the colour on the cover repaints every such heading at once,
 * while a heading that *was* given a colour writes it as an inline style and
 * keeps it. Storing the default instead would make "no choice" and "chose this
 * exact blue" the same document, and neither could follow the cover again.
 */
const SlaidsHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-color'),
        renderHTML: (attributes) => {
          const color = typeof attributes.color === 'string' ? attributes.color : null
          if (!color) return { class: 'rd-heading' }
          return {
            'data-color': color,
            class: 'rd-heading',
            style: `background:${color};color:${bestTextColor(color)}`,
          }
        },
      },
    }
  },
}).configure({ levels: [1] })

interface ExtensionOptions {
  placeholder?: string
  enableTables?: boolean
}

/** A slide title, or one of the cover's two lines. */
export type TitleVariant = 'slide' | 'cover'

export function bodyExtensions(options: ExtensionOptions = {}): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      heading: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { class: 'rd-link' } },
      // Slaids uses its own horizontal separators between subfields.
      horizontalRule: false,
      dropcursor: { color: '#4f8ef7', width: 2 },
      // The line that keeps a caret reachable after a picture is Slaids' own:
      // StarterKit's writes it into the document, and a line of nothing at the
      // end of a field is chrome, not content. See `TrailingLineExtension`.
      trailingNode: false,
    }),
    SlaidsHeading,
    // Alignment is per block, so a selection spanning three paragraphs aligns
    // three paragraphs and a caret in one aligns that one. An image is a block
    // among the others, and is aligned the same way — it is narrower than the
    // column it sits in, so where it sits is a decision to make.
    TextAlign.configure({
      types: ['paragraph', 'heading', 'slaidsImage'],
      alignments: [...ALIGNMENTS],
    }),
    CitationExtension,
    SlaidsImageExtension,
    PlainPasteExtension,
    // The line below a picture, in place of StarterKit's: editor-only, and
    // only while the field is being edited.
    TrailingLineExtension,
    Placeholder.configure({ placeholder: options.placeholder ?? '' }),
  ]
  if (options.enableTables !== false) {
    extensions.push(
      Table.configure({ resizable: false, HTMLAttributes: { class: 'rd-table' } }),
      TableRow,
      TableHeader.configure({ HTMLAttributes: { class: 'rd-th' } }),
      TableCell.configure({ HTMLAttributes: { class: 'rd-td' } }),
    )
  }
  return extensions
}

/**
 * Titles are one line of plain text (citations allowed) — no marks, no breaks,
 * no lists. This is what makes the title zone geometrically deterministic.
 *
 * The cover's two lines are titles too, with two things taken away: they carry
 * no alignment, because a cover line is centred by construction and there is no
 * decision to store, and they cannot cite, because a citation's number comes
 * from where it first occurs among the *slides* — a citation on the cover would
 * render a pill with nothing in it. Both are removed from the schema rather
 * than hidden in the toolbar, so no paste, no shortcut and no future caller can
 * put one there.
 */
export function titleExtensions(placeholder?: string, variant: TitleVariant = 'slide'): Extensions {
  const cover = variant === 'cover'
  return [
    Placeholder.configure({ placeholder: placeholder ?? '' }),
    // A title is one paragraph, but it is still a paragraph: the same alignment
    // attribute, so a title reads the same in the editor and on the slide.
    ...(cover
      ? []
      : [TextAlign.configure({ types: ['paragraph'], alignments: [...ALIGNMENTS] })]),
    StarterKit.configure({
      heading: false,
      bold: false,
      italic: false,
      strike: false,
      underline: false,
      code: false,
      codeBlock: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      horizontalRule: false,
      hardBreak: false,
      link: false,
      dropcursor: false,
      gapcursor: false,
    }),
    ...(cover ? [] : [CitationExtension]),
  ]
}
