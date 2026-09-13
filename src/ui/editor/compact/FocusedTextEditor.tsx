/**
 * One field of text, on a surface you can actually read.
 *
 * A slide scaled to fit a phone puts body type at three or four pixels. Typing
 * there is not editing, it is guessing — so on a compact workspace a field is
 * opened here instead: the same Tiptap document, the same formatting commands,
 * the same undo history, at a size somebody can see.
 *
 * **The surface is not the measure.** How much text fits is decided by the zone
 * it will be drawn in, at 1600 × 900, under the deck's own typography and
 * citation numbering — `textTargetOverflow` asks exactly the geometry and the
 * checkers a domain command asks. This panel is bigger than the zone and would
 * happily hold a page; it is never asked. An edit that does not fit the *slide*
 * is rolled back here exactly as it is on the stage, with the same message, and
 * the text that was there before comes back rather than the draft vanishing.
 */

import { useCallback, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Editor } from '@tiptap/react'
import { docEditRenumberProblem } from '../../../state/citationFit'
import { useActiveEditor } from '../../../state/activeEditor'
import { useEditorStore } from '../../../state/store'
import type { RichDoc } from '../../../domain/types'
import { Icon } from '../../components/Icon'
import { RichTextEditor } from '../RichTextEditor'
import { TextToolbar } from '../TextToolbar'
import {
  activeFieldNodeId,
  overflowMessageFor,
  placeholderFor,
  readTextTarget,
  textTargetKey,
  textTargetOverflow,
  typingLabelFor,
  variantFor,
  writeTextTarget,
  type TextTarget,
} from '../textTarget'

export function FocusedTextEditor({
  target,
  label,
  onClose,
  onInsertReference,
  onOptimizeImage,
}: {
  target: TextTarget
  /** Where this field sits, in the author's words. */
  label: string
  onClose: () => void
  onInsertReference: () => void
  onOptimizeImage: (assetId: string) => void
}) {
  const doc = useEditorStore((state) =>
    state.presentation ? readTextTarget(state.presentation, target) : null,
  )
  const run = useEditorStore((state) => state.run)
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  const editorRef = useRef<Editor | null>(null)

  /*
   * The toolbars follow the caret, and the caret is in here now. Set on mount
   * rather than on focus: the panel opens with the field focused, and a press
   * on a toolbar button must find this editor even if the field lost focus to
   * the button itself.
   */
  useEffect(() => {
    setActiveField({
      nodeId: activeFieldNodeId(target),
      subfieldId: target.kind === 'body' ? target.subfieldId : null,
      kind: target.kind,
    })
    return () => {
      setActiveField(null)
      if (useActiveEditor.getState().editor === editorRef.current) setActiveEditor(null)
    }
  }, [target, setActiveField, setActiveEditor])

  /**
   * The overflow of the real zone, asked of the document as it stands now.
   *
   * `RichTextEditor` writes each keystroke through `onChange` before it asks,
   * so the deck this reads is the deck the edit produced — the same state the
   * stage's own measurement would have been looking at.
   */
  const measureOverflow = useCallback((): number => {
    const presentation = useEditorStore.getState().presentation
    return presentation ? textTargetOverflow(presentation, target) : 0
  }, [target])

  const validateDoc = useCallback(
    (next: RichDoc): string | null =>
      docEditRenumberProblem({
        nodeId: activeFieldNodeId(target),
        currentDoc: doc ?? next,
        nextDoc: next,
        commit: (presentation, value) => writeTextTarget(presentation, target, value),
      }),
    [doc, target],
  )

  // A field can disappear under the panel — an undo, a zone deleted from
  // another surface. There is then nothing to edit and nothing to save.
  useEffect(() => {
    if (doc === null) onClose()
  }, [doc, onClose])
  if (doc === null) return null

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="text-sheet" data-testid="focused-text-editor">
          <div className="text-sheet__head">
            <Dialog.Title className="text-sheet__title">{label}</Dialog.Title>
            <Dialog.Description className="hint">
              Teksten måles mot den virkelige sonen på sliden, ikke mot dette feltet.
            </Dialog.Description>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={onClose}
              data-testid="focused-text-done"
            >
              <Icon name="check" size={15} /> Ferdig
            </button>
          </div>

          <div className="text-sheet__body">
            <RichTextEditor
              key={textTargetKey(target)}
              doc={doc}
              variant={variantFor(target)}
              placeholder={placeholderFor(target)}
              className="text-sheet__field"
              autoFocus
              measureOverflow={measureOverflow}
              overflowMessage={overflowMessageFor(target)}
              validateDoc={validateDoc}
              onEditorReady={(editor) => {
                editorRef.current = editor
                if (editor) setActiveEditor(editor)
              }}
              onFocus={() => setActiveEditor(editorRef.current)}
              onChange={(next) =>
                run(typingLabelFor(target), (presentation) =>
                  writeTextTarget(presentation, target, next),
                )
              }
            />
          </div>

          <div className="text-sheet__tools">
            <TextToolbar onInsertReference={onInsertReference} onOptimizeImage={onOptimizeImage} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
