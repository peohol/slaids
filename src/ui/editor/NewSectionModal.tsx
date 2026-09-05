/**
 * Asks the one thing a new section cannot do without: its heading.
 *
 * A section *is* a heading — an untitled one is a coloured page that says
 * nothing — so the button stays disabled until there is text, and the dialog
 * stays open if the command refuses it for being too long for one line. The
 * subheading is deliberately not asked for: it is optional, and it is typed
 * straight into the placeholder pill on the slide itself.
 */

import { useState } from 'react'
import { Modal } from '../components/Modal'

export function NewSectionModal({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `true` when the section was created; a refusal keeps the text on screen. */
  onCreate: (title: string) => boolean
}) {
  const [title, setTitle] = useState('')
  const trimmed = title.trim()
  // Cleared only once the section exists. A heading refused for being too long
  // for one line is exactly the text the author is about to shorten.
  const submit = (): void => {
    if (trimmed && onCreate(trimmed)) setTitle('')
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Ny seksjon"
      description="En seksjon åpner en del av dekket, og gir slidene etter seg farger og bakgrunn. Fargene arves fra forrige seksjon – du kan endre dem etterpå."
      testId="new-section-modal"
      width={460}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTitle('')
              onOpenChange(false)
            }}
          >
            Avbryt
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={trimmed.length === 0}
            onClick={submit}
            data-testid="create-section"
          >
            Opprett
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-section-title">Hovedoverskrift</label>
        <input
          id="new-section-title"
          className="input"
          value={title}
          autoFocus
          data-testid="section-title-input"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="F.eks. Resultater"
        />
        <p className="hint">
          Underoverskriften er valgfri og skrives rett inn i plassholderen på seksjonssliden.
        </p>
      </div>
    </Modal>
  )
}
