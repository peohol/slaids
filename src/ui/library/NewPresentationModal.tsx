/**
 * Dialogen for ny presentasjon: tittelen, og ingenting annet.
 *
 * Alt annet et dekk starter i – fonter, luft, skriftstørrelse, kortutseende og
 * forsidens farger – velges i temaeditoren, som åpnes over dekket så snart det
 * er opprettet (§ 15.1). Det er den samme editoren **Presentasjon → Tema**
 * åpner, så det finnes bare ett sted å velge et tema.
 */

import { useState } from 'react'
import { Modal } from '../components/Modal'

export interface NewPresentationResult {
  title: string
}

export function NewPresentationModal({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (result: NewPresentationResult) => void
}) {
  const [title, setTitle] = useState('')

  const trimmed = title.trim()
  const valid = trimmed.length > 0

  const submit = (): void => {
    if (!valid) return
    onCreate({ title: trimmed })
    setTitle('')
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Ny presentasjon"
      description="Du velger fonter, farger og utseende i neste steg."
      testId="new-presentation-modal"
      width={460}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!valid}
            onClick={submit}
            data-testid="create-presentation"
          >
            Opprett
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-presentation-title">Tittel</label>
        <input
          id="new-presentation-title"
          className="input"
          value={title}
          autoFocus
          data-testid="presentation-title-input"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="F.eks. Kvartalsrapport"
        />
      </div>
    </Modal>
  )
}
