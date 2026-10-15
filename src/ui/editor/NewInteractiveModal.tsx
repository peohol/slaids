/**
 * Asks for the one thing a new interactive slide cannot do without: its file.
 *
 * One `.html` file, picked or dropped, and read at the door — see
 * `state/interactiveFile.ts` — before anything else happens. The dialog shows
 * what was picked and how big it is, suggests the file's own name for the
 * slide, and stays open with the refusal on screen when the file cannot be
 * used. Nothing is created until a file has passed and the button is pressed:
 * cancelling, or closing on a refusal, leaves the deck exactly as it was.
 *
 * The notes under the picker are the contract the author is agreeing to, in
 * plain words. None of them is a safety claim: validation says the file can
 * be stored, and only the author can say whether it should be run.
 */

import { useRef, useState } from 'react'
import {
  INTERACTIVE_FILE_ACCEPT,
  formatByteSize,
  suggestedInteractiveName,
  type InteractiveSource,
} from '../../domain/interactive'
import { describeError } from '../../domain/result'
import { readInteractiveFile } from '../../state/interactiveFile'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { useTypedSubstitution } from './useTypedSubstitution'

/** What the author is told before a file becomes a slide. */
export const INTERACTIVE_UPLOAD_NOTES: readonly string[] = [
  'Alt appen trenger må ligge i denne ene filen: HTML, CSS og JavaScript. Eksterne skript, stilark, fonter, bilder og tjenester er ikke støttet i denne versjonen.',
  'Appen arver presentasjonens farger, fonter og mål. Den som skriver appen bruker Slaids\u2019 CSS-variabler, og da følger den temaet og inndelingen den ligger i.',
  'Appen kjører bare når noen trykker «Aktiver miniapp», og starter på nytt hver gang den avsluttes.',
  'Hele HTML-kilden følger med når presentasjonen deles.',
  'Aktiver bare filer du stoler på. Slaids sjekker at filen er en HTML-fil, ikke hva den gjør.',
]

interface PickedFile {
  name: string
  size: number
  outcome: { ok: true; source: InteractiveSource } | { ok: false; message: string }
}

export function NewInteractiveModal({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `true` when the slide was created; a refusal keeps the dialog open. */
  onCreate: (source: InteractiveSource, name: string) => boolean
}) {
  const [picked, setPicked] = useState<PickedFile | null>(null)
  const [name, setName] = useState('')
  /** Whether the author has typed a name of their own; a suggestion never overwrites one. */
  const [named, setNamed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const typed = useTypedSubstitution((value) => {
    setName(value)
    setNamed(true)
  })

  const reset = (): void => {
    setPicked(null)
    setName('')
    setNamed(false)
    setBusy(false)
    setDragOver(false)
  }

  const close = (): void => {
    reset()
    onOpenChange(false)
  }

  const pick = async (file: File): Promise<void> => {
    setBusy(true)
    try {
      const read = await readInteractiveFile(file)
      setPicked({
        name: file.name,
        size: file.size,
        outcome: read.ok
          ? { ok: true, source: read.value }
          : { ok: false, message: describeError(read.error) },
      })
      if (read.ok && !named) setName(suggestedInteractiveName(file.name))
    } finally {
      setBusy(false)
    }
  }

  const source = picked?.outcome.ok ? picked.outcome.source : null
  const trimmed = name.trim()
  const canCreate = source !== null && trimmed.length > 0 && !busy

  const submit = (): void => {
    if (!source || !trimmed) return
    if (onCreate(source, trimmed)) close()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="Ny miniapp"
      description="En miniapp er én selvstendig app fra én HTML-fil. Publikum ser en forside med navnet, og starter appen selv."
      testId="new-interactive-modal"
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canCreate}
            onClick={submit}
            data-testid="create-interactive"
          >
            Opprett
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={INTERACTIVE_FILE_ACCEPT}
        style={{ display: 'none' }}
        data-testid="interactive-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void pick(file)
        }}
      />

      <div
        className={dragOver ? 'dropzone dropzone--over' : 'dropzone'}
        data-testid="interactive-dropzone"
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          const file = event.dataTransfer.files?.[0]
          if (file) void pick(file)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
      >
        <Icon name="interactive" size={28} />
        <p>{busy ? 'Leser filen …' : 'Dra én .html-fil hit, eller klikk for å velge'}</p>
        <span className="hint">Én HTML-fil med alt innebygget</span>
      </div>

      {picked && (
        <div className="interactive-file" data-testid="interactive-file">
          <span className="interactive-file__name" data-testid="interactive-file-name">
            {picked.name}
          </span>
          <span className="interactive-file__size hint" data-testid="interactive-file-size">
            {formatByteSize(picked.size)}
          </span>
          {!picked.outcome.ok && (
            <p className="error-text" role="alert" data-testid="interactive-file-error">
              {picked.outcome.message}
            </p>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="new-interactive-name">Navn</label>
        <input
          id="new-interactive-name"
          className="input"
          value={name}
          data-testid="interactive-name-input"
          onChange={typed.onChange}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="F.eks. Quiz"
        />
        <p className="hint">Navnet vises på forsiden av sliden. Filnavnet foreslås.</p>
      </div>

      <ul className="interactive-notes" data-testid="interactive-notes">
        {INTERACTIVE_UPLOAD_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </Modal>
  )
}
