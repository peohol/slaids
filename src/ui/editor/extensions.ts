/**
 * Tiptap schema for Slaids.
 *
 * The schema is deliberately narrow: only nodes Slaids can lay out and measure
 * exist, so pasted content cannot smuggle in foreign structure. Styling is never
 * stored — a heading is a heading, not a font-size.
 */

import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import { Placeholder } from '@tiptap/extensions'
import { bestTextColor } from '../../domain/color'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import type { Extensions } from '@tiptap/react'
import { CitationExtension } from './CitationExtension'
import { SlaidsImageExtension } from './SlaidsImageExtension'

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

export const DEFAULT_HEADING_PILL_COLOR = '#33475b'

/**
 * Headings are pills. There is exactly one heading level; the only thing the
 * author picks is the pill colour, and the text colour follows from contrast.
 */
const SlaidsHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      color: {
        default: DEFAULT_HEADING_PILL_COLOR,
        parseHTML: (element) => element.getAttribute('data-color') ?? DEFAULT_HEADING_PILL_COLOR,
        renderHTML: (attributes) => {
          const color =
            typeof attributes.color === 'string' ? attributes.color : DEFAULT_HEADING_PILL_COLOR
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

export function bodyExtensions(options: ExtensionOptions = {}): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      heading: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { class: 'rd-link' } },
      // Slaids uses its own horizontal separators between subfields.
      horizontalRule: false,
      dropcursor: { color: '#4f8ef7', width: 2 },
    }),
    SlaidsHeading,
    CitationExtension,
    SlaidsImageExtension,
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
 */
export function titleExtensions(placeholder?: string): Extensions {
  return [
    Placeholder.configure({ placeholder: placeholder ?? '' }),
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
    CitationExtension,
  ]
}
