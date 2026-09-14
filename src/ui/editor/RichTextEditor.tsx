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
import { trimTrailingBlankLines } from '../../domain/richdoc'
import type { RichDoc } from '../../domain/types'
import { notify } from '../../state/toast'
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
  takeCaret = false,
  onFocus,
  onBlur,
  onEditorReady,
  measureOverflow,
  overflowMessage = 'Innholdet får ikke plass i sonen.',
  validateDoc,
}: RichTextEditorProps) {
  const lastValid = useRef<{ doc: RichDoc; anchor: number }>({ doc, anchor: 1 })
  /** Overflow of the last accepted document, so an edit that improves it is allowed. */
  const lastOverflow = useRef(0)
  const deferredRef = useRef<number | null>(null)
  const rebaselineRef = useRef<number | null>(null)
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
          doc: currentDoc(editor),
          anchor: editor.state.selection.anchor,
        }
      }

      const rollBack = (message: string): void => {
        const restore = lastValid.current
        editor.commands.setContent(restore.doc, { emitUpdate: false })
        const size = editor.state.doc.content.size
        editor.commands.setTextSelection(Math.max(1, Math.min(restore.anchor, size)))
        lastOverflow.current = measure()

        const restored = currentDoc(editor)
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
      const elsewhere = validateDocRef.current?.(currentDoc(editor)) ?? null
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

  /**
   * Accept the current document as the baseline, whatever it measures.
   *
   * Some things change how much room the text needs without anyone editing it:
   * a web font arriving, an image finishing its download, the zone being
   * resized around it. The overflow that follows is not something to roll back
   * — there is no edit to undo — but it *must* be recorded, because
   * `lastOverflow` is what lets the next edit count as a repair. Left at zero,
   * an edit that removes half the excess reads as "still overflowing, and not
   * better than before" and gets rolled back, so the zone can never be fixed.
   */
  const rebaseline = useCallback((editor: Editor): void => {
    const measure = measureRef.current
    if (!measure || editor.isDestroyed || editor.view.composing) return
    const overflow = measure()
    lastOverflow.current = overflow <= FIT_TOLERANCE ? 0 : overflow
    lastValid.current = {
      doc: currentDoc(editor),
      anchor: editor.state.selection.anchor,
    }
  }, [])

  const scheduleRebaseline = useCallback(
    (editor: Editor) => {
      if (rebaselineRef.current !== null) cancelAnimationFrame(rebaselineRef.current)
      rebaselineRef.current = requestAnimationFrame(() => {
        rebaselineRef.current = null
        // An edit is being validated in the same frame; that measurement is the
        // more specific one and owns the outcome.
        if (deferredRef.current !== null) return
        rebaseline(editor)
      })
    },
    [rebaseline],
  )

  useEffect(() => {
    return () => {
      if (deferredRef.current !== null) cancelAnimationFrame(deferredRef.current)
      if (rebaselineRef.current !== null) cancelAnimationFrame(rebaselineRef.current)
    }
  }, [])

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
        scheduleValidate(instance)
      },
      onFocus: () => onFocus?.(),
      onBlur: () => onBlur?.(),
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

  // Layout changes nobody typed: an image that finished loading, a zone that
  // was resized, a web font that swapped in. Each of them moves the baseline.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onLoad = (): void => scheduleRebaseline(editor)
    dom.addEventListener('load', onLoad, true)

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => scheduleRebaseline(editor))
    observer?.observe(dom)

    let cancelled = false
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    if (fonts) {
      const onFonts = (): void => scheduleRebaseline(editor)
      fonts.addEventListener('loadingdone', onFonts)
      void fonts.ready.then(() => {
        if (!cancelled) scheduleRebaseline(editor)
      })
      return () => {
        cancelled = true
        fonts.removeEventListener('loadingdone', onFonts)
        dom.removeEventListener('load', onLoad, true)
        observer?.disconnect()
      }
    }
    return () => {
      cancelled = true
      dom.removeEventListener('load', onLoad, true)
      observer?.disconnect()
    }
  }, [editor, scheduleRebaseline])

  useEffect(() => {
    onEditorReady?.(editor ?? null)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  useEffect(() => {
    if (!editor) return
    if (editor.isEditable !== editable) editor.setEditable(editable)
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
    lastValid.current = { doc, anchor: 1 }
    editor.commands.setContent(doc, { emitUpdate: false })
  }, [doc, editor])

  return <EditorContent editor={editor} className={className} />
}
