/**
 * New-presentation dialog: title, the two global fonts, and the colours the
 * deck starts in.
 *
 * The fonts are presentation-wide by design — a slide can never diverge from
 * them. The background is not: it belongs to a section, and what is picked here
 * is the front page's, which every slide inherits until the next section says
 * otherwise. Starting a deck is exactly the moment there is only one section,
 * which is why one swatch grid is still the right question to ask.
 */

import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { ColorSwatchGrid } from '../components/ColorPicker'
import { FONT_OPTIONS } from '../../domain/fonts'
import { readDefaultTheme } from '../../state/defaultTheme'
import { bestTextColor } from '../../domain/color'
import { DEFAULT_BACKGROUND_COLOR } from '../../domain/constants'
import { ensureWebFonts } from '../fonts'
import type { PresentationTheme } from '../../domain/types'

export interface NewPresentationResult {
  title: string
  theme: PresentationTheme
  /** The front section's page colour, and with it every slide after it. */
  backgroundColor: string
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
  // Whatever the author last saved as their default is where a new deck starts.
  const [seed] = useState(readDefaultTheme)
  const [title, setTitle] = useState('')
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BACKGROUND_COLOR)
  const [headingFontFamily, setHeadingFontFamily] = useState(seed.headingFontFamily)
  const [bodyFontFamily, setBodyFontFamily] = useState(seed.bodyFontFamily)

  useEffect(() => {
    void ensureWebFonts([headingFontFamily, bodyFontFamily])
  }, [headingFontFamily, bodyFontFamily])

  const trimmed = title.trim()
  const valid = trimmed.length > 0

  const submit = (): void => {
    if (!valid) return
    onCreate({
      title: trimmed,
      theme: { ...seed, headingFontFamily, bodyFontFamily },
      backgroundColor,
    })
    setTitle('')
    setBackgroundColor(DEFAULT_BACKGROUND_COLOR)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Ny presentasjon"
      description="Fontene gjelder hele presentasjonen. Bakgrunnsfargen setter forsiden, og arves av slidene fram til neste inndeling."
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
              <option key={font.id} value={font.stack} style={{ fontFamily: font.stack }}>
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
              <option key={font.id} value={font.stack} style={{ fontFamily: font.stack }}>
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
