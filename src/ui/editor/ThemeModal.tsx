/** Presentation-wide background and fonts. */

import { setTheme } from '../../domain/commands'
import { FONT_OPTIONS } from '../../domain/fonts'
import { bestTextColor } from '../../domain/color'
import { useEditorStore } from '../../state/store'
import { Modal } from '../components/Modal'
import { ColorSwatchGrid } from '../components/ColorPicker'

export function ThemeModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)
  if (!presentation) return null
  const theme = presentation.theme

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Bakgrunn og fonter"
      description="Gjelder hele presentasjonen. Enkeltslides kan ikke avvike."
      testId="theme-modal"
      width={560}
      footer={
        <button type="button" className="btn btn--primary" onClick={() => onOpenChange(false)}>
          Ferdig
        </button>
      }
    >
      <div className="field">
        <label>Bakgrunnsfarge</label>
        <ColorSwatchGrid
          value={theme.backgroundColor}
          onSelect={(backgroundColor) =>
            run('theme-background', (current) => setTheme(current, { backgroundColor }))
          }
        />
      </div>
      <div className="new-presentation__fonts">
        <div className="field">
          <label htmlFor="theme-heading-font">Font for titler</label>
          <select
            id="theme-heading-font"
            className="select"
            value={theme.headingFontFamily}
            data-testid="theme-heading-font"
            onChange={(event) =>
              run('theme-heading-font', (current) =>
                setTheme(current, { headingFontFamily: event.target.value }),
              )
            }
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.id} value={font.stack}>
                {font.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="theme-body-font">Font for brødtekst</label>
          <select
            id="theme-body-font"
            className="select"
            value={theme.bodyFontFamily}
            data-testid="theme-body-font"
            onChange={(event) =>
              run('theme-body-font', (current) =>
                setTheme(current, { bodyFontFamily: event.target.value }),
              )
            }
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
        style={{ background: theme.backgroundColor, color: bestTextColor(theme.backgroundColor) }}
      >
        <span style={{ fontFamily: theme.headingFontFamily, fontSize: 24, fontWeight: 600 }}>
          {presentation.title}
        </span>
        <span style={{ fontFamily: theme.bodyFontFamily, fontSize: 15 }}>
          Brødtekst vises slik i presentasjonen.
        </span>
      </div>
    </Modal>
  )
}
