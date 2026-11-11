/**
 * Logoen i temaet (§ 15.2): sett en fil som logo, endre innstillingene, eller
 * fjern den.
 *
 * Logoen er ett felt i temaet og gjelder hele presentasjonen. Hvor stor den
 * faktisk tegnes, avgjøres ikke her, men i `domain/logo.ts` hver gang dekket
 * tegnes – den lagrede høyden er et ønske. Det som kontrolleres her, er at
 * ønsket er et tall innenfor skjemaets grenser, og at innhold ikke presses ut
 * av sonene sine (`guardFit`, som slipper personer gjennom og holder agenter
 * strengt, som for alle andre temavalg).
 */

import {
  DEFAULT_LOGO_SECTION_HEIGHT,
  DEFAULT_LOGO_SLIDE_HEIGHT,
  LOGO_MIN_HEIGHT,
  LOGO_SECTION_PLACEMENTS,
  LOGO_SECTION_VISIBILITIES,
  LOGO_SLIDE_POSITIONS,
  SLIDE_HEIGHT,
} from '../constants'
import { themeWithoutLogo } from '../logo'
import { touch } from '../presentation'
import { err, ok, type Result } from '../result'
import type { Presentation, ThemeLogo } from '../types'
import { guardFit } from './fitGuard'
import type { StructuralOptions } from './types'

/** Det en endring av logoen kan si noe om. Det som ikke nevnes, står. */
export interface ThemeLogoPatch {
  sections?: Partial<ThemeLogo['sections']>
  slides?: Partial<ThemeLogo['slides']>
}

/** Innstillingene en logo får første gang den settes. */
export function defaultLogoSettings(): Pick<ThemeLogo, 'sections' | 'slides'> {
  return {
    sections: { visibility: 'front', placement: 'above', height: DEFAULT_LOGO_SECTION_HEIGHT },
    slides: { visible: true, position: 'bottom-right', height: DEFAULT_LOGO_SLIDE_HEIGHT },
  }
}

const REFUSAL =
  'Med logoen der får ikke innholdet plass lenger. Gjør logoen mindre, flytt den, eller kort ned innholdet først.'

/**
 * Bruk denne filen som logo. En logo som allerede står, beholder plassering og
 * størrelse og får bare den nye filen – og den nye filens form.
 */
export function setThemeLogo(
  presentation: Presentation,
  assetId: string,
  options: StructuralOptions = {},
): Result<Presentation> {
  const asset = presentation.assets.find((entry) => entry.id === assetId)
  if (!asset) return err('ASSET_NOT_FOUND', 'Fant ikke filen.', { assetId })
  if (!asset.mimeType.startsWith('image/') || !(asset.width > 0) || !(asset.height > 0)) {
    return err('INVALID_ARGUMENT', 'Logoen må være et bilde.', { assetId })
  }
  const current = presentation.theme.logo
  const logo: ThemeLogo = {
    ...(current ?? defaultLogoSettings()),
    assetId,
    aspect: asset.width / asset.height,
  }
  if (current && current.assetId === logo.assetId && current.aspect === logo.aspect) {
    return ok(presentation)
  }
  return commit(presentation, logo, options)
}

/** Endre hvor og hvor stor logoen står. */
export function updateThemeLogo(
  presentation: Presentation,
  patch: ThemeLogoPatch,
  options: StructuralOptions = {},
): Result<Presentation> {
  const current = presentation.theme.logo
  if (!current) return err('INVALID_ARGUMENT', 'Presentasjonen har ingen logo.')

  const sections = { ...current.sections, ...patch.sections }
  const slides = { ...current.slides, ...patch.slides }
  if (!LOGO_SECTION_VISIBILITIES.includes(sections.visibility)) {
    return err('INVALID_ARGUMENT', 'Ukjent valg for logo på inndelinger.')
  }
  if (!LOGO_SECTION_PLACEMENTS.includes(sections.placement)) {
    return err('INVALID_ARGUMENT', 'Logoen står enten over eller under overskriften.')
  }
  if (!LOGO_SLIDE_POSITIONS.includes(slides.position)) {
    return err('INVALID_ARGUMENT', 'Ukjent plassering for logoen.')
  }
  if (typeof slides.visible !== 'boolean') {
    return err('INVALID_ARGUMENT', 'Logoen på slides er enten på eller av.')
  }
  for (const height of [sections.height, slides.height]) {
    if (!Number.isFinite(height) || height < LOGO_MIN_HEIGHT || height > SLIDE_HEIGHT) {
      return err(
        'INVALID_ARGUMENT',
        `Logoens høyde må være mellom ${LOGO_MIN_HEIGHT} og ${SLIDE_HEIGHT}.`,
        { min: LOGO_MIN_HEIGHT, max: SLIDE_HEIGHT },
      )
    }
  }
  return commit(presentation, { ...current, sections, slides }, options)
}

/** Ta logoen bort. Filen blir liggende til ingenting viser den, som andre filer. */
export function removeThemeLogo(presentation: Presentation): Result<Presentation> {
  if (!presentation.theme.logo) return ok(presentation)
  // Å fjerne en logo gir bare mer plass, så det er ingenting å kontrollere.
  return ok(touch({ ...presentation, theme: themeWithoutLogo(presentation.theme) }))
}

function commit(
  presentation: Presentation,
  logo: ThemeLogo,
  options: StructuralOptions,
): Result<Presentation> {
  const updated = touch({ ...presentation, theme: { ...presentation.theme, logo } })
  return guardFit(presentation, updated, options, REFUSAL)
}
