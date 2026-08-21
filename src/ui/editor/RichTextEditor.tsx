/**
 * Tiptap editor bound to a stored `RichDoc`.
 *
 * Two rules make this component the enforcement point of the content-fit
 * invariant:
 *  - an edit that makes the content overflow its zone is rolled back to the
 *    last valid document (never mid-IME-composition, and never when the edit
 *    is what *reduces* the overflow), and
 *  - pasted HTML is normalised before it can reach the schema.
 */

import { useCallback, useEffect, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { FIT_TOLERANCE } from '../../domain/constants'
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
  /**
   * A second opinion on the document, for consequences this zone cannot
   * measure — a citation whose number changes what *other* zones need. Returns
   * a message to roll the edit back, or `null` to let it stand.
   */
  validateDoc?: (doc: RichDoc) => string | null
}

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
  validateDoc,
}: RichTextEditorProps) {
  const lastValid = useRef<{ doc: RichDoc; anchor: number }>({ doc, anchor: 1 })
  /** Overflow of the last accepted document, so an edit that improves it is allowed. */
  const lastOverflow = useRef(0)
  const deferredRef = useRef<number | null>(null)
  const initialised = useRef(false)
  const lastEmitted = useRef<string>(JSON.stringify(doc))
  const measureRef = useRef(measureOverflow)
  const onChangeRef = useRef(onChange)
  const validateDocRef = useRef(validateDoc)

  useEffect(() => {
    measureRef.current = measureOverflow
    onChangeRef.current = onChange
    validateDocRef.current = validateDoc
  }, [measureOverflow, onChange, validateDoc])

  /**
   * Decide whether the current document may stand.
   *
   * This runs *after* layout rather than inside `onUpdate`, because React node
   * views (images, figures, tables) mount asynchronously: measuring
   * synchronously would read a box that has not been laid out yet and reject
   * perfectly valid edits — including the very edit that would fix an overflow.
   */
  const validate = useCallback(
    (editor: Editor): void => {
      const measure = measureRef.current
      if (!measure || editor.isDestroyed || editor.view.composing) return

      const overflow = measure()
      // The first validation observes whatever the document arrived as; only
      // later ones can attribute an overflow to an edit.
      const isFirst = !initialised.current
      initialised.current = true

      const accept = (): void => {
        lastOverflow.current = overflow <= FIT_TOLERANCE ? 0 : overflow
        lastValid.current = {
          doc: editor.getJSON() as RichDoc,
          anchor: editor.state.selection.anchor,
        }
      }

      const rollBack = (message: string): void => {
        const restore = lastValid.current
        editor.commands.setContent(restore.doc, { emitUpdate: false })
        const size = editor.state.doc.content.size
        editor.commands.setTextSelection(Math.max(1, Math.min(restore.anchor, size)))
        lastOverflow.current = measure()

        const restored = editor.getJSON() as RichDoc
        const serialized = JSON.stringify(restored)
        if (serialized !== lastEmitted.current) {
          lastEmitted.current = serialized
          onChangeRef.current(restored)
        }
        notify.warning(message)
      }

      // Content can arrive overflowing — a theme change, a smaller zone, a file
      // that finished loading. Record it rather than fighting the user.
      if (isFirst) {
        accept()
        return
      }
      // Any edit that reduces the overflow is allowed, otherwise an overflowing
      // document could never be repaired.
      const fitsHere = overflow <= FIT_TOLERANCE || overflow < lastOverflow.current - FIT_TOLERANCE
      if (!fitsHere) {
        rollBack(overflowMessage)
        return
      }

      // Fits here, but this document is not the only thing it decides: a
      // citation added or moved renumbers labels across the deck.
      const elsewhere = validateDocRef.current?.(editor.getJSON() as RichDoc) ?? null
      if (elsewhere) {
        rollBack(elsewhere)
        return
      }
      accept()
    },
    [overflowMessage],
  )

  const scheduleValidate = useCallback(
    (editor: Editor) => {
      if (deferredRef.current !== null) cancelAnimationFrame(deferredRef.current)
      deferredRef.current = requestAnimationFrame(() => {
        deferredRef.current = null
        validate(editor)
      })
    },
    [validate],
  )

  useEffect(() => {
    return () => {
      if (deferredRef.current !== null) cancelAnimationFrame(deferredRef.current)
    }
  }, [])

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
        const json = instance.getJSON() as RichDoc
        const serialized = JSON.stringify(json)
        if (serialized !== lastEmitted.current) {
          lastEmitted.current = serialized
          onChangeRef.current(json)
        }
        scheduleValidate(instance)
      },
      onFocus: () => onFocus?.(),
    },
    [variant, placeholder],
  )

  // Establish the starting overflow, and re-check when the surrounding zone or
  // the theme changes underneath the editor.
  useEffect(() => {
    if (!editor) return
    scheduleValidate(editor)
  }, [editor, scheduleValidate])

  // Re-validate once an IME composition finishes, since edits made during
  // composition deliberately skip the fit check.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const handler = (): void => {
      scheduleValidate(editor)
    }
    dom.addEventListener('compositionend', handler)
    return () => dom.removeEventListener('compositionend', handler)
  }, [editor, scheduleValidate])

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
