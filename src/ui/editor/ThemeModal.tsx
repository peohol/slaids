/**
 * Presentation-wide fonts, air and type size.
 *
 * The background colour used to be here and deliberately is not any more: it is
 * a section's, so a deck can change ground colour partway through, and it is
 * picked on the section slide that governs it. What is left is what genuinely
 * applies to every page at once.
 */

import { useState } from 'react'
import { setTheme } from '../../domain/commands'
import { FONT_OPTIONS, findFontByStack } from '../../domain/fonts'
import { FONT_SCALE_PRESETS, SPACING_PRESETS, type ThemeScalePreset } from '../../domain/metrics'
import { bestTextColor } from '../../domain/color'
import { domFitCheckers } from '../../state/measure'
import { notify } from '../../state/toast'
import { useEditorStore } from '../../state/store'
import { writeDefaultTheme } from '../../state/defaultTheme'
import { ensureWebFonts } from '../fonts'
import { Modal } from '../components/Modal'

/**
 * Which of the named settings is in force.
 *
 * Luft is one multiplier on every distance and skriftstørrelse one on every
 * type size. Both are continuous in the domain; the chooser offers the four
 * named values `domain/metrics.ts` declares — declared there rather than here
 * because the agent contract quotes the same list, and one list is what keeps
 * the two saying the same thing. A stored value between two of them highlights
 * the nearest.
 */
function isCurrent(value: number, current: number, steps: readonly ThemeScalePreset[]): boolean {
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
  // The deck no longer has one background, so a preview of its typography sits
  // on the ground the reader meets first: the front page's.
  const previewBackground = presentation.slides[0].backgroundColor

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
      description="Fonter, luft og skriftstørrelse gjelder hele presentasjonen. Farger velges per inndeling."
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
          {SPACING_PRESETS.map((step) => (
            <button
              key={step.value}
              type="button"
              className={
                isCurrent(step.value, theme.spacing, SPACING_PRESETS)
                  ? 'btn btn--sm btn--active'
                  : 'btn btn--sm'
              }
              data-testid={`theme-spacing-${step.value}`}
              aria-pressed={isCurrent(step.value, theme.spacing, SPACING_PRESETS)}
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
          {FONT_SCALE_PRESETS.map((step) => (
            <button
              key={step.value}
              type="button"
              className={
                isCurrent(step.value, theme.fontScale, FONT_SCALE_PRESETS)
                  ? 'btn btn--sm btn--active'
                  : 'btn btn--sm'
              }
              data-testid={`theme-font-scale-${step.value}`}
              aria-pressed={isCurrent(step.value, theme.fontScale, FONT_SCALE_PRESETS)}
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
        style={{ background: previewBackground, color: bestTextColor(previewBackground) }}
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
