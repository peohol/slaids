/**
 * The dialog behind the two pieces of plain editorial text Slaids holds: a
 * zone's note, and the deck's image brief.
 *
 * Both are the same surface — one large field, a way to copy all of it in one
 * gesture, and a bound the domain already enforces — because both exist for the
 * same errand: the author writes something here and pastes it into a chat
 * window somewhere else. Written once rather than twice so the two cannot
 * drift into looking like different features, and so the thing that is
 * genuinely different about a note (what it is *for*) is the only thing its own
 * dialog has to add.
 *
 * Saving is what typing does. Every keystroke runs the domain command, exactly
 * as typing into a zone does, so there is no unsaved state to lose to a closed
 * tab and no «Lagre» to forget — the editor's autosave carries it to storage
 * from there. Neither text can ever be refused for want of room: neither is
 * drawn on a slide.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { COPIED_FEEDBACK_MS, copyToClipboard } from '../components/clipboard'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'

export function EditorialTextModal({
  onClose,
  title,
  description,
  value,
  onChange,
  maxChars,
  placeholder,
  testId,
  /** Controls that belong to this one kind of text, above the field. */
  tools,
}: {
  /**
   * Mounted means open: the caller renders this only while its text exists, the
   * same way the upload and optimiser dialogs are mounted. That is what keeps
   * «Kopiert» from a dialog that has been closed out of the next one — the
   * state goes with the component instead of being reset by an effect.
   */
  onClose: () => void
  title: string
  description?: string
  value: string
  onChange: (value: string) => void
  maxChars: number
  placeholder?: string
  testId: string
  tools?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = async (): Promise<void> => {
    const ok = await copyToClipboard(value)
    setCopied(ok)
    setCopyFailed(!ok)
    if (!ok) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={title}
      description={description}
      testId={testId}
      width={720}
      footer={
        <>
          <span className="hint" data-testid={`${testId}-count`}>
            {value.length} / {maxChars} tegn
          </span>
          <button
            type="button"
            className="btn"
            data-testid={`${testId}-copy`}
            disabled={value.length === 0}
            onClick={() => void copy()}
          >
            <Icon name="copy" size={15} /> {copied ? 'Kopiert' : 'Kopier'}
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Lukk
          </button>
        </>
      }
    >
      {tools}
      <textarea
        className="editorial-text"
        data-testid={`${testId}-text`}
        value={value}
        maxLength={maxChars}
        placeholder={placeholder}
        spellCheck
        onChange={(event) => onChange(event.target.value)}
      />
      {copyFailed && (
        // The browser said no. Rather than claiming success, the text is still
        // right there to select by hand — which is what the field already is.
        <p className="hint" data-testid={`${testId}-copy-failed`}>
          Nettleseren tillot ikke kopiering. Merk teksten i feltet og kopier den selv.
        </p>
      )}
    </Modal>
  )
}
