/**
 * Tiptap editor bound to a stored `RichDoc`.
 *
 * Pasted HTML is normalised before it can reach the schema.
 *
 * Hva en person skriver, tas alltid imot – i en sone, i en korttittel, i en
 * slidetittel og på en inndelingsside. Tekst som ikke får plass i normal
 * størrelse, tegnes mindre og merkes (`ui/slide/ZoneFitBox`,
 * `ui/slide/titleFit`); det gjelder også en sone et annet sted som får en
 * bredere citation-etikett fordi nummereringen endret seg.
 */

import { useEffect, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { trimTrailingBlankLines } from '../../domain/richdoc'
import type { RichDoc } from '../../domain/types'
import { useActiveEditor } from '../../state/activeEditor'
import { bodyExtensions, normalizePastedHtml, titleExtensions } from './extensions'

/**
 * The document the editor currently *means*.
 *
 * Not quite what it holds: a field being edited keeps an empty line under a
 * picture so there is somewhere to write on (see `TrailingLineExtension`), and
 * that line is chrome rather than content. Reading through one function is what
 * keeps the editor's idea of "unchanged" the same as the store's — otherwise
 * every trimmed emission would come straight back as an external change and
 * reset the editor under the caret.
 */
function currentDoc(editor: Editor): RichDoc {
  return trimTrailingBlankLines(editor.getJSON() as RichDoc)
}

/**
 * The four kinds of field, and what separates them.
 *
 * `title` is one line of plain text that never wraps. `cover` is a title with
 * the alignment and the citations taken out — see `titleExtensions` — and lays
 * out identically, so it shares the title's markup. `caption` is the same
 * restricted schema again, but it *does* wrap: a caption grows sideways until
 * it nears the walls of the picture and then takes another line, which is the
 * one thing a title may never do.
 */
export type EditorVariant = 'body' | 'title' | 'cover' | 'caption'

const FIELD_CLASS: Record<EditorVariant, string> = {
  body: 'rich-doc tiptap',
  title: 'rich-doc rich-doc--title tiptap',
  cover: 'rich-doc rich-doc--title tiptap',
  caption: 'rich-doc rich-doc--caption tiptap',
}

export interface RichTextEditorProps {
  doc: RichDoc
  onChange: (doc: RichDoc) => void
  variant?: EditorVariant
  editable?: boolean
  placeholder?: string
  className?: string
  autoFocus?: boolean
  /**
   * Take the caret the moment this turns true.
   *
   * Not the same thing as `autoFocus`, which is an option the editor is *built*
   * with: a field on the compact stage is built long before it becomes a
   * writing surface — it is drawn read-only until one is focused — so by the
   * time somebody asks for it, creating it with the caret is no longer on
   * offer. This is the same request made of an editor that already exists,
   * which is what lets the text list open one particular field.
   */
  takeCaret?: boolean
  onFocus?: () => void
  /** Used by the caption, which deletes itself when it is left empty. */
  onBlur?: () => void
  onEditorReady?: (editor: Editor | null) => void
}

export function RichTextEditor({
  doc,
  onChange,
  variant = 'body',
  editable = true,
  placeholder,
  className,
  autoFocus,
  takeCaret = false,
  onFocus,
  onBlur,
  onEditorReady,
}: RichTextEditorProps) {
  const lastEmitted = useRef<string>(JSON.stringify(doc))
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor(
    {
      extensions:
        variant === 'body'
          ? bodyExtensions({ placeholder })
          : titleExtensions(placeholder, variant === 'cover' ? 'cover' : 'slide'),
      content: doc,
      editable,
      autofocus: autoFocus ? 'end' : false,
      editorProps: {
        attributes: { class: FIELD_CLASS[variant] },
        transformPastedHTML: normalizePastedHtml,
        handleKeyDown: (_view, event) => {
          if (variant !== 'body' && event.key === 'Enter') {
            event.preventDefault()
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor: instance }) => {
        const json = currentDoc(instance)
        const serialized = JSON.stringify(json)
        if (serialized !== lastEmitted.current) {
          lastEmitted.current = serialized
          onChangeRef.current(json)
        }
      },
      onFocus: () => onFocus?.(),
      onBlur: () => onBlur?.(),
    },
    [variant, placeholder],
  )

  useEffect(() => {
    onEditorReady?.(editor ?? null)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  useEffect(() => {
    if (!editor) return
    if (editor.isEditable !== editable) editor.setEditable(editable)
    /*
     * A field that is no longer a writing surface is no longer anything's
     * target either.
     *
     * On a compact workspace the editors stay mounted when the focus moves —
     * they only turn read-only — so the unmount cleanup each field owns never
     * runs, and the toolbar, the reference dialog and the picture dialog would
     * all still be aimed at the field the user has just left. Formatting a
     * paragraph on a page nobody can see is the bug that follows, so the rule
     * is stated once, here, where `editable` actually changes.
     */
    if (!editable && useActiveEditor.getState().editor === editor) {
      useActiveEditor.getState().setEditor(null)
    }
  }, [editor, editable])

  /*
   * Declared after the one above so the editor is already editable when the
   * caret is asked for: `focus()` on a read-only ProseMirror does nothing.
   * Only the transition into `takeCaret` focuses, so a render that happens
   * while somebody is typing somewhere else cannot pull the caret back.
   */
  useEffect(() => {
    if (!editor || !takeCaret) return
    editor.commands.focus('end')
  }, [editor, takeCaret])

  // Adopt external changes (undo/redo, structural commands) without clobbering
  // what the user is currently typing.
  useEffect(() => {
    if (!editor) return
    const incoming = JSON.stringify(doc)
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    editor.commands.setContent(doc, { emitUpdate: false })
  }, [doc, editor])

  return <EditorContent editor={editor} className={className} />
}
