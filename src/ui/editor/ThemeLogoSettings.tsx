/**
 * Logoen i temaeditoren (§ 15.2): last opp, bytt eller fjern filen, og velg
 * hvor og hvor stor den står på inndelinger og på vanlige slides.
 *
 * Filen går gjennom den samme døren som alle andre bilder (`storeUploadedFile`
 * og `domain/assetIngress.ts`), så en SVG renses på nøyaktig samme måte. Hvor
 * stor logoen faktisk tegnes, er ikke denne dialogens sak: glidebryterne går
 * fra minstemålet til det dekket har plass til akkurat nå (`logoLimits`), og
 * resten avgjøres der logoen tegnes.
 */

import { useRef, useState } from 'react'
import {
  removeThemeLogo,
  updateThemeLogo,
  type ThemeLogoPatch,
} from '../../domain/commands'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import {
  LOGO_MIN_HEIGHT,
  LOGO_SECTION_PLACEMENTS,
  LOGO_SECTION_VISIBILITIES,
  type LogoSectionPlacement,
  type LogoSectionVisibility,
  type LogoSlidePosition,
} from '../../domain/constants'
import { IMAGE_FILE_ACCEPT } from '../../domain/imageBytes'
import { logoLimits } from '../../domain/logo'
import type { Presentation, ThemeLogo } from '../../domain/types'
import { useAssetUrl } from '../../state/assetSource'
import { uploadThemeLogo } from './logoUpload'
import { useEditorStore } from '../../state/store'

const VISIBILITY_LABELS: Record<LogoSectionVisibility, string> = {
  none: 'Ingen',
  front: 'Bare forsiden',
  all: 'Alle inndelinger',
}

const PLACEMENT_LABELS: Record<LogoSectionPlacement, string> = {
  above: 'Over overskriften',
  below: 'Under overskriften',
}

/** Navnet på hver plass, slik en skjermleser og et verktøytips sier det. */
export const LOGO_POSITION_LABELS: Record<LogoSlidePosition, string> = {
  'top-left': 'Øverst til venstre',
  top: 'Øverst i midten',
  'top-right': 'Øverst til høyre',
  left: 'Til venstre',
  right: 'Til høyre',
  'bottom-left': 'Nederst til venstre',
  bottom: 'Nederst i midten',
  'bottom-right': 'Nederst til høyre',
}

/** De åtte plassene som et rutenett på tre ganger tre, med midten tom. */
const POSITION_GRID: readonly (LogoSlidePosition | null)[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  null,
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
]

type Group = 'sections' | 'slides'

/**
 * Ett dra i en glidebryter er ett angresteg. Endringene slås sammen slik
 * skriving i ett felt gjør (`typing:`-merket i `store.ts`), så Ctrl+Z tar
 * tilbake hele draget og ikke ett hakk av gangen.
 */
const sizeLabel = (group: Group) => `typing:theme-logo-size:${group}`

export function ThemeLogoSettings({ presentation }: { presentation: Presentation }) {
  const run = useEditorStore((state) => state.run)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const logo = presentation.theme.logo ?? null

  const upload = async (file: File): Promise<void> => {
    setBusy(true)
    try {
      await uploadThemeLogo(file)
    } finally {
      setBusy(false)
    }
  }

  const patch = (label: string, change: ThemeLogoPatch): void => {
    run(label, (current) => updateThemeLogo(current, change, HUMAN_EDIT))
  }

  return (
    <div className="field theme-logo" data-testid="theme-logo">
      <label id="theme-logo-label">Logo</label>
      <div className="theme-logo__file" role="group" aria-labelledby="theme-logo-label">
        {logo && <LogoThumbnail assetId={logo.assetId} />}
        <button
          type="button"
          className="btn btn--sm"
          data-testid="theme-logo-upload"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Laster opp …' : logo ? 'Bytt logo …' : 'Last opp logo …'}
        </button>
        {logo && (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="theme-logo-remove"
            disabled={busy}
            onClick={() => run('theme-logo-remove', removeThemeLogo)}
          >
            Fjern
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          hidden
          data-testid="theme-logo-file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </div>
      <p className="hint">
        Logoen gjelder hele presentasjonen. Den tar aldri plass fra overskrifter, titler eller
        fremdriftsindikatoren, og blir mindre av seg selv når det trengs.
      </p>
      {logo && <LogoPlacement presentation={presentation} logo={logo} patch={patch} />}
    </div>
  )
}

function LogoThumbnail({ assetId }: { assetId: string }) {
  const url = useAssetUrl(assetId)
  return (
    <span className="theme-logo__thumb" data-testid="theme-logo-thumb">
      {url && <img src={url} alt="Logoen" draggable={false} />}
    </span>
  )
}

function LogoPlacement({
  presentation,
  logo,
  patch,
}: {
  presentation: Presentation
  logo: ThemeLogo
  patch: (label: string, change: ThemeLogoPatch) => void
}) {
  const limits = logoLimits(presentation)!
  const sectionsShown = logo.sections.visibility !== 'none'

  return (
    <div className="theme-logo__groups">
      <fieldset className="theme-logo__group">
        <legend>På inndelinger</legend>
        <RadioRow
          label="Hvilke inndelinger"
          name="theme-logo-sections"
          options={LOGO_SECTION_VISIBILITIES}
          labels={VISIBILITY_LABELS}
          value={logo.sections.visibility}
          testId="theme-logo-sections"
          onChange={(visibility) => patch('theme-logo-sections', { sections: { visibility } })}
        />
        <RadioRow
          label="Plassering på inndelinger"
          name="theme-logo-placement"
          options={LOGO_SECTION_PLACEMENTS}
          labels={PLACEMENT_LABELS}
          value={logo.sections.placement}
          disabled={!sectionsShown}
          testId="theme-logo-placement"
          onChange={(placement) => patch('theme-logo-placement', { sections: { placement } })}
        />
        <SizeSlider
          group="sections"
          stored={logo.sections.height}
          limit={limits.sections}
          disabled={!sectionsShown}
          onChange={(height) => patch(sizeLabel('sections'), { sections: { height } })}
        />
      </fieldset>

      <fieldset className="theme-logo__group">
        <legend>På slides</legend>
        <div className="theme-modal__switch-row">
          <label htmlFor="theme-logo-slides-visible">Vis logoen på slides</label>
          <button
            id="theme-logo-slides-visible"
            type="button"
            role="switch"
            aria-checked={logo.slides.visible}
            className="switch"
            data-testid="theme-logo-slides-visible"
            onClick={() => patch('theme-logo-slides-visible', { slides: { visible: !logo.slides.visible } })}
          >
            <span className="switch__thumb" />
          </button>
        </div>
        <div
          className="theme-logo__positions"
          role="radiogroup"
          aria-label="Plassering på slides"
          data-testid="theme-logo-positions"
        >
          {POSITION_GRID.map((position, index) =>
            position ? (
              <label
                key={position}
                className="theme-logo__position"
                title={LOGO_POSITION_LABELS[position]}
                data-testid={`theme-logo-position-${position}`}
                data-checked={logo.slides.position === position ? '' : undefined}
              >
                <input
                  type="radio"
                  name="theme-logo-position"
                  value={position}
                  checked={logo.slides.position === position}
                  disabled={!logo.slides.visible}
                  aria-label={LOGO_POSITION_LABELS[position]}
                  onChange={() => patch('theme-logo-position', { slides: { position } })}
                />
              </label>
            ) : (
              <span key={`centre-${index}`} className="theme-logo__position-centre" aria-hidden="true" />
            ),
          )}
        </div>
        <SizeSlider
          group="slides"
          stored={logo.slides.height}
          limit={limits.slides}
          disabled={!logo.slides.visible}
          onChange={(height) => patch(sizeLabel('slides'), { slides: { height } })}
        />
      </fieldset>
    </div>
  )
}

export function RadioRow<T extends string>({
  label,
  name,
  options,
  labels,
  value,
  disabled = false,
  testId,
  onChange,
}: {
  label: string
  name: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  disabled?: boolean
  testId: string
  onChange: (value: T) => void
}) {
  return (
    <div className="inspector__actions" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label
          key={option}
          className={option === value ? 'btn btn--sm btn--active theme-logo__choice' : 'btn btn--sm theme-logo__choice'}
          data-testid={`${testId}-${option}`}
          aria-disabled={disabled || undefined}
        >
          <input
            type="radio"
            className="card-look-choice__input"
            name={name}
            value={option}
            checked={option === value}
            disabled={disabled}
            onChange={() => onChange(option)}
          />
          {labels[option]}
        </label>
      ))}
    </div>
  )
}

/**
 * Størrelsen, fra minstemålet til det dekket har plass til. Står det lagrede
 * ønsket høyere enn plassen, viser bryteren det som faktisk tegnes.
 */
function SizeSlider({
  group,
  stored,
  limit,
  disabled,
  onChange,
}: {
  group: Group
  stored: number
  limit: number
  disabled: boolean
  onChange: (height: number) => void
}) {
  const id = `theme-logo-size-${group}`
  if (limit < LOGO_MIN_HEIGHT) {
    return (
      <p className="hint" data-testid={`${id}-no-room`}>
        {group === 'sections'
          ? 'Det er ikke plass til logoen på inndelingene slik de står nå.'
          : 'Det er ikke plass til logoen på slidene slik de står nå. Prøv en annen plassering.'}
      </p>
    )
  }
  const value = Math.min(stored, limit)
  return (
    <div className="theme-logo__size">
      <label htmlFor={id}>Størrelse</label>
      <input
        id={id}
        type="range"
        min={LOGO_MIN_HEIGHT}
        max={limit}
        step={1}
        value={value}
        disabled={disabled}
        data-testid={id}
        aria-valuetext={`${value} av ${limit} punkter høy`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
