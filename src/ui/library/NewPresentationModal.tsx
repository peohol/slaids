/**
 * New-presentation dialog: title, global background and the two global fonts.
 * These are presentation-wide by design — a slide can never diverge from them.
 */

import { useState } from 'react'
import { Modal } from '../components/Modal'
import { ColorSwatchGrid } from '../components/ColorPicker'
import { DEFAULT_BACKGROUND_COLOR } from '../../domain/constants'
import { FONT_OPTIONS } from '../../domain/fonts'
import { bestTextColor } from '../../domain/color'
import type { PresentationTheme } from '../../domain/types'

export interface NewPresentationResult {
  title: string
  theme: PresentationTheme
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
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BACKGROUND_COLOR)
  const [headingFontFamily, setHeadingFontFamily] = useState(FONT_OPTIONS[0].stack)
  const [bodyFontFamily, setBodyFontFamily] = useState(FONT_OPTIONS[0].stack)

  const trimmed = title.trim()
  const valid = trimmed.length > 0

  const submit = (): void => {
    if (!valid) return
    onCreate({ title: trimmed, theme: { backgroundColor, headingFontFamily, bodyFontFamily } })
    setTitle('')
    setBackgroundColor(DEFAULT_BACKGROUND_COLOR)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Ny presentasjon"
      description="Bakgrunn og fonter gjelder hele presentasjonen."
      testId="new-presentation-modal"
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

      <div className="field">
        <label>Bakgrunnsfarge</label>
        <ColorSwatchGrid value={backgroundColor} onSelect={setBackgroundColor} />
      </div>

      <div className="new-presentation__fonts">
        <div className="field">
          <label htmlFor="heading-font">Font for titler</label>
          <select
            id="heading-font"
            className="select"
            value={headingFontFamily}
            data-testid="heading-font-select"
            onChange={(event) => setHeadingFontFamily(event.target.value)}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.id} value={font.stack}>
                {font.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="body-font">Font for brødtekst</label>
          <select
            id="body-font"
            className="select"
            value={bodyFontFamily}
            data-testid="body-font-select"
            onChange={(event) => setBodyFontFamily(event.target.value)}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.id} value={font.stack}>
                {font.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className="new-presentation__preview"
        style={{ background: backgroundColor, color: bestTextColor(backgroundColor) }}
      >
        <span style={{ fontFamily: headingFontFamily, fontSize: 24, fontWeight: 600 }}>
          {trimmed || 'Slidetittel'}
        </span>
        <span style={{ fontFamily: bodyFontFamily, fontSize: 15 }}>
          Brødtekst vises slik i presentasjonen.
        </span>
      </div>
    </Modal>
  )
}
