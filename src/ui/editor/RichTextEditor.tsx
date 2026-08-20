/**
 * Tiptap editor bound to a stored `RichDoc`.
 *
 * Two rules make this component the enforcement point of the content-fit
 * invariant:
 *  - an edit that makes the content overflow its zone is rolled back to the
 *    last valid document (never mid-IME-composition), and
 *  - pasted HTML is normalised before it can reach the schema.
 */

import { useCallback, useEffect, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { RichDoc } from '../../domain/types'
import { notify } from '../../state/toast'
import { bodyExtensions, normalizePastedHtml, titleExtensions } from './extensions'

export type EditorVariant = 'body' | 'title'

export interface RichTextEditorProps {
  doc: RichDoc
  onChange: (doc: RichDoc) => void
  variant?: EditorVariant
  editable?: boolean
  placeholder?: string
  className?: string
  autoFocus?: boolean
  onFocus?: () => void
  onEditorReady?: (editor: Editor | null) => void
  /**
   * Returns how much the surrounding zone currently overflows, in logical
   * pixels. When it is positive after an edit, the edit is rejected.
   */
  measureOverflow?: () => number
  overflowMessage?: string
}

const OVERFLOW_TOLERANCE = 0.75

export function RichTextEditor({
  doc,
  onChange,
  variant = 'body',
  editable = true,
  placeholder,
  className,
  autoFocus,
  onFocus,
  onEditorReady,
  measureOverflow,
  overflowMessage = 'Innholdet får ikke plass i sonen.',
}: RichTextEditorProps) {
  const lastValid = useRef<{ doc: RichDoc; anchor: number }>({ doc, anchor: 1 })
  const lastEmitted = useRef<string>(JSON.stringify(doc))
  const measureRef = useRef(measureOverflow)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    measureRef.current = measureOverflow
    onChangeRef.current = onChange
  }, [measureOverflow, onChange])

  const validate = useCallback((editor: Editor): void => {
    const measure = measureRef.current
    if (!measure) return
    if (editor.view.composing) return

    const overflow = measure()
    if (overflow <= OVERFLOW_TOLERANCE) return

    const restore = lastValid.current
    editor.commands.setContent(restore.doc, { emitUpdate: false })
    const size = editor.state.doc.content.size
    editor.commands.setTextSelection(Math.max(1, Math.min(restore.anchor, size)))
    notify.warning(overflowMessage)
  }, [overflowMessage])

  const editor = useEditor(
    {
      extensions:
        variant === 'title' ? titleExtensions(placeholder) : bodyExtensions({ placeholder }),
      content: doc,
      editable,
      autofocus: autoFocus ? 'end' : false,
      editorProps: {
        attributes: {
          class: variant === 'title' ? 'rich-doc rich-doc--title tiptap' : 'rich-doc tiptap',
        },
        transformPastedHTML: normalizePastedHtml,
        handleKeyDown: (_view, event) => {
          if (variant === 'title' && event.key === 'Enter') {
            event.preventDefault()
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor: instance }) => {
        validate(instance)
        const json = instance.getJSON() as RichDoc
        const serialized = JSON.stringify(json)
        if (serialized === lastEmitted.current) return
        lastEmitted.current = serialized
        lastValid.current = { doc: json, anchor: instance.state.selection.anchor }
        onChangeRef.current(json)
      },
      onFocus: () => onFocus?.(),
    },
    [variant, placeholder],
  )

  // Re-validate once an IME composition finishes, since edits made during
  // composition deliberately skip the fit check.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const handler = (): void => validate(editor)
    dom.addEventListener('compositionend', handler)
    return () => dom.removeEventListener('compositionend', handler)
  }, [editor, validate])

  useEffect(() => {
    onEditorReady?.(editor ?? null)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  useEffect(() => {
    if (!editor) return
    if (editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  // Adopt external changes (undo/redo, structural commands) without clobbering
  // what the user is currently typing.
  useEffect(() => {
    if (!editor) return
    const incoming = JSON.stringify(doc)
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    lastValid.current = { doc, anchor: 1 }
    editor.commands.setContent(doc, { emitUpdate: false })
  }, [doc, editor])

  return <EditorContent editor={editor} className={className} />
}
