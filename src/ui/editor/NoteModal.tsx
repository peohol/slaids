/**
 * A zone's note, opened.
 *
 * Everything about the surface is `EditorialTextModal`'s; what this adds is the
 * one thing that is a note's own — what it is for. A note marked
 * `image-prompt` reserves the rectangle a picture will occupy and holds the
 * prompt that will produce it, and the zone's own button says «Bildeprompt»
 * rather than «Notat» because of it.
 */

import { MAX_NOTE_CHARS } from '../../domain/constants'
import { NOTE_PURPOSES } from '../../domain/constants'
import { NOTE_PURPOSE_LABELS } from '../../domain/content'
import { setNoteText } from '../../domain/commands'
import { findLeaf } from '../../domain/layout'
import { useEditorStore } from '../../state/store'
import { EditorialTextModal } from './EditorialTextModal'

const PLACEHOLDER =
  'Skriv notatet her. Er det en bildeprompt, beskriv motivet, komposisjonen og formatet — stilen ligger allerede i bildebriefen.'

export function NoteModal({
  slideId,
  nodeId,
  onClose,
}: {
  slideId: string
  /** The zone whose note is open, or `null` when none is. */
  nodeId: string | null
  onClose: () => void
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)

  const slide = presentation?.slides.find((entry) => entry.id === slideId)
  const content =
    nodeId && slide?.kind === 'content' ? (findLeaf(slide.root, nodeId)?.content ?? null) : null
  /* The zone can stop being a note while the dialog is open — an undo, an
     agent, a replacement from the upload dialog — and then there is nothing
     left to edit. Closing is the honest answer; a dialog over a zone that no
     longer holds a note would write into nothing. */
  if (!nodeId || content?.kind !== 'note') return null

  const write = (input: Parameters<typeof setNoteText>[1]): void => {
    run(`typing:note:${nodeId}`, (current) => setNoteText(current, input))
  }

  return (
    <EditorialTextModal
      onClose={onClose}
      title={NOTE_PURPOSE_LABELS[content.purpose]}
      description="Redaksjonell tekst som hører til denne sonen. Den vises aldri for publikum."
      value={content.text}
      onChange={(text) => write({ slideId, nodeId, text })}
      maxChars={MAX_NOTE_CHARS}
      placeholder={PLACEHOLDER}
      testId="note-modal"
      tools={
        <div className="editorial-text__tools" role="radiogroup" aria-label="Hva notatet er">
          {NOTE_PURPOSES.map((purpose) => (
            <button
              key={purpose}
              type="button"
              role="radio"
              aria-checked={content.purpose === purpose}
              className={`btn btn--sm${content.purpose === purpose ? ' btn--active' : ''}`}
              data-testid={`note-purpose-${purpose}`}
              onClick={() => write({ slideId, nodeId, purpose })}
            >
              {NOTE_PURPOSE_LABELS[purpose]}
            </button>
          ))}
        </div>
      }
    />
  )
}
