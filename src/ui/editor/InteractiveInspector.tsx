/**
 * An interactive slide's properties panel.
 *
 * Two things, because the slide is two things: the name the cover shows, and
 * the file behind it. The name is typed here rather than on the stage — the
 * cover is a drawn page, not a form — and the file is replaced here through
 * the same door it came in through (`state/interactiveFile.ts`), so a
 * replacement that cannot be used is refused before anything changes and the
 * app that was there stays exactly as it was.
 *
 * Both changes are ordinary commands, so both are undone with Ctrl+Z like any
 * other edit. Nothing about a *running* app is a property of the slide: that
 * state is the surface's, and it is never stored.
 */

import { useRef, useState } from 'react'
import { setInteractiveSlideHtml, setInteractiveSlideName } from '../../domain/commands'
import {
  INTERACTIVE_FILE_ACCEPT,
  formatByteSize,
  interactiveByteSize,
} from '../../domain/interactive'
import { describeError } from '../../domain/result'
import type { InteractiveSlide } from '../../domain/types'
import { readInteractiveFile } from '../../state/interactiveFile'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import { Icon } from '../components/Icon'
import { INTERACTIVE_UPLOAD_NOTES } from './NewInteractiveModal'

export function InteractiveInspector({ slide }: { slide: InteractiveSlide }) {
  const run = useEditorStore((state) => state.run)
  /**
   * What is in the field while the author types, over what the document
   * holds. `null` between edits, so the field follows the document — an undo,
   * a redo — without anything having to synchronise it; the draft exists only
   * so a trailing space or an emptied field survives until the author is done.
   */
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const name = draft ?? slide.name

  const commitName = (value: string): void => {
    setDraft(value)
    // An empty field is a field being cleared to type into, not a rename to
    // nothing: the command refuses an empty name, so it is not asked.
    if (!value.trim()) return
    run(`typing:interactive:${slide.id}:name`, (current) =>
      setInteractiveSlideName(current, slide.id, value),
    )
  }

  const replace = async (file: File): Promise<void> => {
    setBusy(true)
    try {
      const read = await readInteractiveFile(file)
      if (!read.ok) {
        // Refused at the door: the slide, and the app it holds, are untouched.
        notify.error(describeError(read.error))
        return
      }
      const replaced = run('interactive-replace', (current) =>
        setInteractiveSlideHtml(current, slide.id, {
          fileName: read.value.fileName,
          html: read.value.html,
        }),
      )
      if (replaced) notify.info(`Miniappen ble byttet ut med «${read.value.fileName}».`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="inspector" data-testid="inspector">
      <section className="inspector__section">
        <h2 className="inspector__heading">Miniapp</h2>
        <p className="hint">
          Én selvstendig miniapp i én HTML-fil. Publikum ser forsiden med navnet, og starter appen
          med «Aktiver miniapp». Den kjører isolert fra Slaids og starter på nytt hver gang.
        </p>
      </section>

      <section className="inspector__section">
        <h2 className="inspector__heading">Navn</h2>
        <input
          className="input"
          value={name}
          aria-label="Navn på miniappen"
          data-testid="interactive-inspector-name"
          onChange={(event) => commitName(event.target.value)}
          onBlur={() => setDraft(null)}
        />
        <p className="hint">Vises på forsiden av sliden.</p>
      </section>

      <section className="inspector__section">
        <h2 className="inspector__heading">HTML-fil</h2>
        <div className="inspector__row">
          <span className="hint" data-testid="interactive-inspector-file">
            {slide.fileName}
          </span>
          <span className="hint" data-testid="interactive-inspector-size">
            {formatByteSize(interactiveByteSize(slide))}
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={INTERACTIVE_FILE_ACCEPT}
          style={{ display: 'none' }}
          data-testid="interactive-replace-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void replace(file)
          }}
        />
        <div className="inspector__actions">
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            data-testid="interactive-replace"
          >
            <Icon name="upload" size={14} /> {busy ? 'Leser …' : 'Erstatt HTML-fil'}
          </button>
        </div>
        <p className="hint">
          En fil som ikke kan brukes, avvises, og appen som ligger her beholdes uendret.
        </p>
      </section>

      <section className="inspector__section">
        <h2 className="inspector__heading">Slik virker det</h2>
        <ul className="interactive-notes">
          {INTERACTIVE_UPLOAD_NOTES.map((note) => (
            <li key={note} className="hint">
              {note}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
