/**
 * Temaeditoren: temamaler, logo, fonter, luft, skriftstørrelse, skygger og
 * kortutseende for hele presentasjonen, og forsidens to farger.
 *
 * Fargene er forsidens, ikke globale: de er de samme to forsidens
 * egenskapspanel endrer, og senere inndelinger beholder sine egne (§ 8.5).
 * Dialogen er den samme om den åpnes fra menyen eller rett etter at et dekk er
 * opprettet (§ 15.1), og hver endring i den er en vanlig, angrebar endring.
 */

import { useState } from 'react'
import { setSectionAccentColor, setSectionBackgroundColor, setTheme } from '../../domain/commands'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import { TITLED_CARD_STYLES, type TitledCardStyle } from '../../domain/constants'
import { FONT_OPTIONS, findFontByStack } from '../../domain/fonts'
import { FONT_SCALE_PRESETS, SPACING_PRESETS, type ThemeScalePreset } from '../../domain/metrics'
import { bestTextColor } from '../../domain/color'
import type { PresentationTheme } from '../../domain/types'
import { notify } from '../../state/toast'
import { useEditorStore } from '../../state/store'
import { ensureWebFonts } from '../fonts'
import { Modal } from '../components/Modal'
import { ColorPickerButton } from '../components/ColorPicker'
import { ThemePreview } from './ThemePreview'
import { ThemeLogoSettings } from './ThemeLogoSettings'
import { ThemeTemplates } from './ThemeTemplates'
import { useThemeTemplateEdit } from './useThemeTemplateEdit'
import { deckLogoLayout } from '../../domain/logo'
import { ConfirmDialog } from '../components/ConfirmDialog'

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
 * Det en skjermleser hører for hvert kortutseende. Dialogen viser ingen navn –
 * bildene er valget – så dette er bare radioknappenes tilgjengelige navn.
 */
const TITLED_CARD_LOOK_LABELS: Record<TitledCardStyle, string> = {
  joined: 'Tittel og innhold i ett kort',
  tab: 'Tittel som fane bak innholdet',
  floating: 'Tittel som eget kort over innholdet',
}

/**
 * Et lite, stilisert kort i ett av utseendene, i dekkets egne første farger.
 * Et bilde av ideen, ikke en forminsket slide: det ekte kortet tegnes av
 * `ZoneContentFrame`, og dette skal bare skille tre valg fra hverandre med ett
 * blikk.
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
  const edit = useThemeTemplateEdit()
  /** Dialogen ble bedt om å lukkes midt i en endring av en mal. */
  const [closing, setClosing] = useState(false)
  if (!presentation) return null
  const theme = presentation.theme
  // Dekket har ikke én bakgrunn, så forhåndsvisningene står på den leseren møter
  // først: forsidens.
  const front = presentation.slides[0]
  const previewBackground = front.backgroundColor
  const previewAccent = front.accentColor

  /**
   * Alt i temadialogen er en persons valg: tekst som ikke lenger får plass i
   * normal størrelse etter et nytt tema, tegnes mindre og merkes, i stedet for
   * at valget avvises (`HUMAN_EDIT`). Agentens `set_theme` måles fortsatt.
   */
  const applyTheme = (label: string, patch: Partial<PresentationTheme>): void => {
    run(label, (current) => setTheme(current, patch, HUMAN_EDIT))
  }

  /**
   * Pick a font — but only commit it once the browser can actually draw it.
   *
   * A font that will not load is not silently accepted and drawn with the
   * fallback: the change is refused and said out loud.
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
      applyTheme(`theme-${field}-font`, patch)
    } finally {
      setLoading(null)
    }
  }

  /**
   * Lukkes dialogen mens en mal endres, spørres det først: ellers ville
   * endringene stå i presentasjonen og ikke i malen, uten at noen sa det.
   */
  const requestOpenChange = (next: boolean): void => {
    if (!next && edit.editing) setClosing(true)
    else onOpenChange(next)
  }

  const finishEditing = async (keep: boolean): Promise<void> => {
    setClosing(false)
    if (!keep) edit.cancel()
    else if (!(await edit.save())) return
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={requestOpenChange}
      title="Tema"
      description="Maler, logo, fonter, luft, skriftstørrelse og kortenes utseende gjelder hele presentasjonen. Fargene her er forsidens, og arves fram til neste inndeling."
      testId="theme-modal"
      width={600}
      footer={
        edit.editing ? (
          <>
            <button
              type="button"
              className="btn"
              data-testid="theme-template-edit-cancel"
              disabled={edit.pending}
              onClick={edit.cancel}
            >
              Avbryt
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="theme-template-edit-save"
              disabled={edit.pending || !edit.editing.name.trim()}
              onClick={() => void edit.save()}
            >
              {edit.pending ? 'Lagrer …' : 'Lagre i malen'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            data-testid="theme-done"
            onClick={() => onOpenChange(false)}
          >
            Ferdig
          </button>
        )
      }
    >
      <div className="theme-modal__preview">
        <ThemePreview
          theme={theme}
          background={previewBackground}
          accent={previewAccent}
          logo={deckLogoLayout(presentation)}
        />
      </div>

      <ThemeTemplates presentation={presentation} edit={edit} />

      <div className="field">
        <label id="theme-front-colors-label">Forsidens farger</label>
        <div className="theme-modal__colors" role="group" aria-labelledby="theme-front-colors-label">
          <ColorPickerButton
            value={front.backgroundColor}
            label="Bakgrunnsfarge"
            testId="theme-front-background"
            onChange={(color) =>
              run('section-background', (current) =>
                setSectionBackgroundColor(current, current.slides[0].id, color),
              )
            }
          />
          <ColorPickerButton
            value={front.accentColor}
            label="Aksentfarge"
            testId="theme-front-accent"
            onChange={(color) =>
              run('section-accent', (current) =>
                setSectionAccentColor(current, current.slides[0].id, color),
              )
            }
          />
        </div>
        <p className="hint">
          Gjelder forsiden og slidene fram til neste inndeling. Senere inndelinger beholder sine
          egne farger.
        </p>
      </div>

      <ThemeLogoSettings presentation={presentation} />

      <div className="theme-modal__fonts" data-font-loading={loading ?? 'none'}>
        <div className="field">
          <label htmlFor="theme-heading-font">Font for titler</label>
          <select
            id="theme-heading-font"
            className="select"
            value={theme.headingFontFamily}
            data-testid="theme-heading-font"
            disabled={loading !== null}
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
            … endringen tas i bruk når fonten er klar.
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
                applyTheme('theme-spacing', { spacing: step.value })
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
                applyTheme('theme-font-scale', { fontScale: step.value })
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
            onClick={() => applyTheme('theme-shadows', { boxShadows: !theme.boxShadows })}
          >
            <span className="switch__thumb" />
          </button>
        </div>
        <p className="hint">Skygge under kort, bilder og andre bokser på slidene.</p>
      </div>

      <div className="field">
        <label id="theme-titled-card-label">Kort med tittel</label>
        {/*
          Vanlige radioknapper med forhåndsvisningen som etikett: nettleseren gir
          gruppen ett tabulatorstopp, piltastene flytter og velger, og en
          skjermleser hører valget slik den hører alle andre radioknapper.
        */}
        <div
          className="inspector__actions"
          role="radiogroup"
          aria-labelledby="theme-titled-card-label"
        >
          {TITLED_CARD_STYLES.map((look) => {
            const chosen = theme.titledCardStyle === look
            return (
              <label
                key={look}
                title={TITLED_CARD_LOOK_LABELS[look]}
                className={chosen ? 'btn card-look-choice btn--active' : 'btn card-look-choice'}
                data-testid={`theme-titled-card-${look}`}
              >
                <input
                  type="radio"
                  name="theme-titled-card"
                  className="card-look-choice__input"
                  value={look}
                  checked={chosen}
                  aria-label={TITLED_CARD_LOOK_LABELS[look]}
                  onChange={() => applyTheme('theme-titled-card', { titledCardStyle: look })}
                />
                <TitledCardLookPreview
                  look={look}
                  theme={theme}
                  background={previewBackground}
                  accent={previewAccent}
                />
              </label>
            )
          })}
        </div>
        <p className="hint">
          Gjelder alle kort med tittel. Tekst som ikke lenger får plass, vises forminsket.
        </p>
      </div>

      <ConfirmDialog
        open={closing}
        title="Lagre endringene i malen?"
        message={
          edit.editing
            ? `Du har endret malen «${edit.editing.template.name}». «Ikke lagre» setter presentasjonen tilbake slik den var.`
            : ''
        }
        confirmLabel="Lagre i malen"
        confirmTone="primary"
        alternativeLabel="Ikke lagre"
        cancelLabel="Fortsett å endre"
        onConfirm={() => void finishEditing(true)}
        onAlternative={() => void finishEditing(false)}
        onCancel={() => setClosing(false)}
      />
    </Modal>
  )
}
