/** Presentation-wide background, fonts, air and type size. */

import { useState } from 'react'
import { setTheme } from '../../domain/commands'
import { FONT_OPTIONS, findFontByStack } from '../../domain/fonts'
import { bestTextColor } from '../../domain/color'
import { domFitCheckers } from '../../state/measure'
import { notify } from '../../state/toast'
import { useEditorStore } from '../../state/store'
import { writeDefaultTheme } from '../../state/defaultTheme'
import { ensureWebFonts } from '../fonts'
import { Modal } from '../components/Modal'
import { ColorSwatchGrid } from '../components/ColorPicker'

/**
 * Luft: one multiplier on every distance — the global gap, card padding, the
 * space between subfields and between blocks of text. They move together, so a
 * roomier deck is still a deck with exactly one gap in it.
 */
const SPACING_STEPS: { label: string; value: number }[] = [
  { label: 'Tett', value: 0.75 },
  { label: 'Normal', value: 1 },
  { label: 'Luftig', value: 1.3 },
  { label: 'Ekstra luftig', value: 1.6 },
]

/** Skriftstørrelse: one multiplier on every type size on the slide. */
const FONT_STEPS: { label: string; value: number }[] = [
  { label: 'Liten', value: 0.85 },
  { label: 'Normal', value: 1 },
  { label: 'Stor', value: 1.15 },
  { label: 'Ekstra stor', value: 1.3 },
]

/** Steps are discrete, so the nearest one is the one to highlight. */
function isCurrent(value: number, current: number, steps: { value: number }[]): boolean {
  const nearest = steps.reduce((best, step) =>
    Math.abs(step.value - current) < Math.abs(best.value - current) ? step : best,
  )
  return nearest.value === value
}

export function ThemeModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)
  /** Which field is waiting for its font to become measurable. */
  const [loading, setLoading] = useState<'heading' | 'body' | null>(null)
  if (!presentation) return null
  const theme = presentation.theme

  /**
   * Pick a font — but only commit it once the browser can actually draw it.
   *
   * The fit gate answers "does this still fit?" by measuring the real DOM. Ask
   * it while the web font is still downloading and it measures the fallback,
   * approves the change, and the swap a moment later pushes text out of zones
   * that were just declared fine. So: load first, wait for readiness, then let
   * the command measure. A font that will not load is not silently accepted
   * against fallback metrics either — the change is refused and said out loud.
   */
  const applyFont = async (field: 'heading' | 'body', stack: string): Promise<void> => {
    setLoading(field)
    try {
      const { failed } = await ensureWebFonts([stack])
      if (failed.length > 0) {
        notify.error(
          `Fonten «${failed.join('», «')}» kunne ikke lastes, så den kan ikke tas i bruk nå. Sjekk nettverket og prøv igjen.`,
        )
        return
      }
      const patch =
        field === 'heading' ? { headingFontFamily: stack } : { bodyFontFamily: stack }
      run(`theme-${field}-font`, (current) => setTheme(current, patch, domFitCheckers))
    } finally {
      setLoading(null)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Tema"
      description="Gjelder hele presentasjonen. Enkeltslides kan ikke avvike."
      testId="theme-modal"
      width={560}
      footer={
        <>
          <button
            type="button"
            className="btn"
            data-testid="theme-as-default"
            onClick={() => {
              writeDefaultTheme(theme)
              notify.success('Temaet brukes som standard for nye presentasjoner.')
            }}
          >
            Bruk som standard for nye presentasjoner
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onOpenChange(false)}>
            Ferdig
          </button>
        </>
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
      <div className="new-presentation__fonts" data-font-loading={loading ?? 'none'}>
        <div className="field">
          <label htmlFor="theme-heading-font">Font for titler</label>
          <select
            id="theme-heading-font"
            className="select"
            value={theme.headingFontFamily}
            data-testid="theme-heading-font"
            disabled={loading !== null}
            // A wider heading font can push slide titles and card headers out
            // of their fixed-height zones, so the command validates the whole
            // deck against the prospective theme — after the font is loaded.
            onChange={(event) => void applyFont('heading', event.target.value)}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.id} value={font.stack} style={{ fontFamily: font.stack }}>
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
            disabled={loading !== null}
            onChange={(event) => void applyFont('body', event.target.value)}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.id} value={font.stack} style={{ fontFamily: font.stack }}>
                {font.label}
              </option>
            ))}
          </select>
        </div>
        {loading !== null && (
          <p className="hint" data-testid="font-loading">
            Laster {findFontByStack(
              loading === 'heading' ? theme.headingFontFamily : theme.bodyFontFamily,
            )?.label ?? 'fonten'}
            … endringen måles først når fonten er klar.
          </p>
        )}
      </div>
      <div className="field">
        <label>Luft</label>
        <div className="inspector__actions">
          {SPACING_STEPS.map((step) => (
            <button
              key={step.value}
              type="button"
              className={
                isCurrent(step.value, theme.spacing, SPACING_STEPS)
                  ? 'btn btn--sm btn--active'
                  : 'btn btn--sm'
              }
              data-testid={`theme-spacing-${step.value}`}
              aria-pressed={isCurrent(step.value, theme.spacing, SPACING_STEPS)}
              onClick={() =>
                run('theme-spacing', (current) =>
                  setTheme(current, { spacing: step.value }, domFitCheckers),
                )
              }
            >
              {step.label}
            </button>
          ))}
        </div>
        <p className="hint">
          Endrer mellomrommet mellom soner, polstringen i kort og avstanden mellom avsnitt og
          overskrifter under ett.
        </p>
      </div>

      <div className="field">
        <label>Skriftstørrelse</label>
        <div className="inspector__actions">
          {FONT_STEPS.map((step) => (
            <button
              key={step.value}
              type="button"
              className={
                isCurrent(step.value, theme.fontScale, FONT_STEPS)
                  ? 'btn btn--sm btn--active'
                  : 'btn btn--sm'
              }
              data-testid={`theme-font-scale-${step.value}`}
              aria-pressed={isCurrent(step.value, theme.fontScale, FONT_STEPS)}
              onClick={() =>
                run('theme-font-scale', (current) =>
                  setTheme(current, { fontScale: step.value }, domFitCheckers),
                )
              }
            >
              {step.label}
            </button>
          ))}
        </div>
        <p className="hint">Skalerer all tekst på slidene, inkludert tittelsonen og kortheader.</p>
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
