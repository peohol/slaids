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
import { setCardLookByHand } from '../../domain/commands/manualLayout'
import { TITLED_CARD_STYLES, type TitledCardStyle } from '../../domain/constants'
import { FONT_OPTIONS, findFontByStack } from '../../domain/fonts'
import { FONT_SCALE_PRESETS, SPACING_PRESETS, type ThemeScalePreset } from '../../domain/metrics'
import { bestTextColor } from '../../domain/color'
import type { PresentationTheme } from '../../domain/types'
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

/**
 * What a screen reader hears for each card look. The dialog shows no names —
 * the pictures are the choice — so these are only the buttons' accessible
 * labels.
 */
const TITLED_CARD_LOOK_LABELS: Record<TitledCardStyle, string> = {
  joined: 'Tittel og innhold i ett kort',
  tab: 'Tittel som fane bak innholdet',
  floating: 'Tittel som eget kort over innholdet',
}

/**
 * A small, stylised card in one of the looks, on the deck's own first colours.
 * A picture of the idea rather than a scaled slide: the real thing is drawn by
 * `ZoneContentFrame`, and this only has to tell three choices apart at a
 * glance.
 */
function TitledCardLookPreview({
  look,
  theme,
  background,
  accent,
}: {
  look: TitledCardStyle
  theme: PresentationTheme
  background: string
  accent: string
}) {
  return (
    <span
      className="card-look"
      data-look={look}
      data-shadows={theme.boxShadows ? 'on' : 'off'}
      style={{ background }}
      aria-hidden="true"
    >
      <span className="card-look__card">
        <span
          className="card-look__header"
          style={{ background: accent, color: bestTextColor(accent) }}
        />
        <span className="card-look__body" />
      </span>
    </span>
  )
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
  const previewAccent = presentation.slides[0].accentColor

  /**
   * The two looks are a person's choice of appearance, not a change to measure
   * against the deck: a shadow hides nothing, and text a title style leaves too
   * little room is drawn smaller, as in a zone dragged small.
   */
  const setLook = (
    label: string,
    patch: Partial<Pick<PresentationTheme, 'boxShadows' | 'titledCardStyle'>>,
  ): void => {
    run(label, (current) => setCardLookByHand(current, patch))
  }

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
      description="Fonter, luft, skriftstørrelse og kortenes utseende gjelder hele presentasjonen. Farger velges per inndeling."
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

      <div className="field">
        <div className="theme-modal__switch-row">
          <label htmlFor="theme-shadows">
            Skygger
          </label>
          <button
            id="theme-shadows"
            type="button"
            role="switch"
            aria-checked={theme.boxShadows}
            className="switch"
            data-testid="theme-shadows"
            onClick={() => setLook('theme-shadows', { boxShadows: !theme.boxShadows })}
          >
            <span className="switch__thumb" />
          </button>
        </div>
        <p className="hint">Skygge under kort, bilder og andre bokser på slidene.</p>
      </div>

      <div className="field">
        <label id="theme-titled-card-label">Kort med tittel</label>
        <div
          className="inspector__actions"
          role="radiogroup"
          aria-labelledby="theme-titled-card-label"
        >
          {TITLED_CARD_STYLES.map((look) => (
            <button
              key={look}
              type="button"
              role="radio"
              aria-checked={theme.titledCardStyle === look}
              aria-label={TITLED_CARD_LOOK_LABELS[look]}
              title={TITLED_CARD_LOOK_LABELS[look]}
              className={
                theme.titledCardStyle === look
                  ? 'btn card-look-choice btn--active'
                  : 'btn card-look-choice'
              }
              data-testid={`theme-titled-card-${look}`}
              onClick={() => setLook('theme-titled-card', { titledCardStyle: look })}
            >
              <TitledCardLookPreview
                look={look}
                theme={theme}
                background={previewBackground}
                accent={previewAccent}
              />
            </button>
          ))}
        </div>
        <p className="hint">
          Gjelder alle kort med tittel. Tekst som ikke lenger får plass, vises forminsket.
        </p>
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
