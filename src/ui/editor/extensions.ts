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
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Placeholder } from '@tiptap/extensions'
import { bestTextColor } from '../../domain/color'
import { DEFAULT_TEXT_ALIGN } from '../../domain/constants'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import type { Editor, Extensions } from '@tiptap/react'
import { CitationExtension } from './CitationExtension'
import { SlaidsImageExtension } from './SlaidsImageExtension'
import { PlainPasteExtension } from './PlainPasteExtension'
import { TrailingLineExtension } from './TrailingLineExtension'
import { TypographyExtension } from './TypographyExtension'

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
 * Alignment: stored only when somebody picked one, drawn always.
 *
 * Two separate things, and Tiptap's own attribute conflates them. Its rule is
 * that whichever value is configured as the default becomes the attribute's
 * schema default *and* the one value whose style is left unwritten. Both halves
 * are wrong here.
 *
 * A schema default is not "absent": ProseMirror fills it into every node, and
 * `editor.getJSON()` writes it back out — so configuring `center` as the
 * default would stamp `textAlign: "center"` into every previously unaligned
 * paragraph the first time anyone typed in the field. That is the exact
 * opposite of what the default is for: absent has to *stay* absent, so the
 * default can be moved later without rewriting a single document, and so a
 * paragraph somebody centred on purpose stays distinguishable from one nobody
 * touched. `null` is how this codebase already stores "not chosen" — see the
 * heading pill's colour, a few lines down.
 *
 * And the style has to be written every time, including for absent. Omitting
 * it would make the editor's markup differ from `RichDocView`'s for exactly one
 * alignment — the common one — and that difference is not cosmetic: a heading
 * pill is `max-content` wide and a picture is narrower than its column, so both
 * are placed by `margin-inline` through selectors that read the inline style. A
 * centred pill would sit at the left while it was being edited and centred
 * everywhere else.
 */
const SlaidsTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return (this.parent?.() ?? []).map((group) => ({
      ...group,
      attributes: {
        ...group.attributes,
        textAlign: {
          ...(group.attributes as Record<string, object>).textAlign,
          default: null,
          parseHTML: (element: HTMLElement) => {
            const value = element.style.textAlign
            return (ALIGNMENTS as readonly string[]).includes(value) ? value : null
          },
          renderHTML: (attributes: Record<string, unknown>) => ({
            style: `text-align: ${
              typeof attributes.textAlign === 'string' ? attributes.textAlign : DEFAULT_TEXT_ALIGN
            }`,
          }),
        },
      },
    }))
  },
})

/**
 * The alignment extension every field shares, differing only in what it applies
 * to.
 *
 * No `defaultAlignment`: what an unaligned block looks like is decided by the
 * `renderHTML` above and by `RichDocView`, both from `DEFAULT_TEXT_ALIGN`.
 * Passing it here would only set the schema default this extension exists to
 * keep at `null`.
 */
function textAlignFor(types: string[]) {
  return SlaidsTextAlign.configure({ types, alignments: [...ALIGNMENTS] })
}

/**
 * Whether the caret sits in a block that is drawn with this alignment.
 *
 * Not the same question as "does it store this alignment": a block nobody has
 * aligned stores nothing and is drawn with `DEFAULT_TEXT_ALIGN`, so the toolbar
 * has to light that button up — it says what the text on screen looks like, and
 * the button and the slide would otherwise disagree.
 */
export function alignmentIsActive(editor: Editor, value: Alignment): boolean {
  if (editor.isActive({ textAlign: value })) return true
  return value === DEFAULT_TEXT_ALIGN && editor.isActive({ textAlign: null })
}

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

/**
 * Subscript and superscript exclude one another: text sunk below the baseline
 * and text raised above it are two different choices about the same
 * character, never both at once. Declaring the exclusion on both marks makes
 * it symmetric — toggling either one always clears the other, regardless of
 * which was applied first.
 */
const SlaidsSubscript = Subscript.extend({ excludes: 'superscript' })
const SlaidsSuperscript = Superscript.extend({ excludes: 'subscript' })

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
      // See `NO_LOCAL_HISTORY` below.
      undoRedo: false,
    }),
    SlaidsHeading,
    SlaidsSubscript,
    SlaidsSuperscript,
    TypographyExtension,
    // Alignment is per block, so a selection spanning three paragraphs aligns
    // three paragraphs and a caret in one aligns that one. An image is a block
    // among the others, and is aligned the same way — it is narrower than the
    // column it sits in, so where it sits is a decision to make.
    textAlignFor(['paragraph', 'heading', 'slaidsImage']),
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
 * Titles are one line of plain text (citations allowed) — no breaks, no
 * lists, and no marks besides subscript and superscript, which is what makes
 * the title zone geometrically deterministic: neither can wrap a line or
 * widen it by more than the character itself would.
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
    ...(cover ? [] : [textAlignFor(['paragraph'])]),
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
      // See `NO_LOCAL_HISTORY` below.
      undoRedo: false,
    }),
    SlaidsSubscript,
    SlaidsSuperscript,
    // A title is text somebody types, so it gets the same substitutions the
    // body does — there is no reading of «Del 1 - konklusjon» in which the
    // hyphen was meant.
    TypographyExtension,
    ...(cover ? [] : [CitationExtension]),
  ]
}

/**
 * Why no editor keeps a history of its own.
 *
 * Undo in Slaids is the *deck's*: `useEditorStore` snapshots the whole
 * presentation, so one Ctrl+Z steps back through structural changes and typing
 * alike, in the order they happened. A per-field ProseMirror history is a
 * second, competing record of the same edits — and because a keystroke reaches
 * both, Ctrl+Z in a text field used to run both: ProseMirror rolled the field
 * back, the store rolled the document back, and ProseMirror's rollback was then
 * committed on top as a fresh change. Which of the two the user saw depended on
 * where the caret happened to be, which is exactly why the toolbar buttons
 * always worked and the shortcut did not.
 *
 * The editors therefore keep no history, and `EditorView` handles the shortcut
 * in the capture phase. Input rules are still individually undoable through
 * Backspace (`undoInputRule`), which needs no history plugin.
 */
export const NO_LOCAL_HISTORY = true
