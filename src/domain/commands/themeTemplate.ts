/**
 * Bruk en temamal på en presentasjon (§ 15.4): ett steg som setter temaet,
 * forsidens to farger og logoen.
 *
 * Logofilen må allerede ligge i presentasjonens eget fillager når kommandoen
 * kjøres, og `logoAssetId` er dens id der. Å kopiere den inn er lagerets sak
 * (`state/themeTemplates.ts`); her kontrolleres bare at den finnes og er et
 * bilde, slik `setThemeLogo` gjør. En mal uten logo tar logoen bort: malen er
 * et helt øyeblikksbilde, ikke en endring av det som står.
 *
 * Temaet kontrolleres som alle andre temaendringer (`guardThemeChange`): en
 * person får det de valgte, og tekst som ikke lenger får plass, tegnes mindre;
 * en agent avvises.
 */

import { themeSchema } from '../schema'
import { err, ok, type Result } from '../result'
import { touch } from '../presentation'
import type { ThemeTemplateContent } from '../themeTemplate'
import type { Presentation, PresentationTheme, ThemeLogo } from '../types'
import { setSectionAccentColor, setSectionBackgroundColor } from './sections'
import { guardThemeChange } from './slides'
import type { StructuralOptions } from './types'

export function applyThemeTemplate(
  presentation: Presentation,
  content: ThemeTemplateContent,
  logoAssetId: string | null,
  options: StructuralOptions = {},
): Result<Presentation> {
  const logo = templateLogo(presentation, content, logoAssetId)
  if (!logo.ok) return logo
  const theme: PresentationTheme = { ...content.theme, ...(logo.value ? { logo: logo.value } : {}) }
  if (!themeSchema.safeParse(theme).success) {
    return err('INVALID_ARGUMENT', 'Temamalen er ugyldig og kan ikke brukes.')
  }

  const front = presentation.slides[0].id
  const themed = touch({ ...presentation, theme })
  const background = setSectionBackgroundColor(themed, front, content.front.backgroundColor)
  if (!background.ok) return background
  const colored = setSectionAccentColor(background.value, front, content.front.accentColor)
  if (!colored.ok) return colored
  return guardThemeChange(presentation, colored.value, content.theme, options)
}

function templateLogo(
  presentation: Presentation,
  content: ThemeTemplateContent,
  logoAssetId: string | null,
): Result<ThemeLogo | null> {
  if (!content.logo) return ok(null)
  if (!logoAssetId) return err('INVALID_ARGUMENT', 'Malens logo ble ikke kopiert inn i presentasjonen.')
  const asset = presentation.assets.find((entry) => entry.id === logoAssetId)
  if (!asset) return err('ASSET_NOT_FOUND', 'Fant ikke filen.', { assetId: logoAssetId })
  if (!asset.mimeType.startsWith('image/') || !(asset.width > 0) || !(asset.height > 0)) {
    return err('INVALID_ARGUMENT', 'Logoen må være et bilde.', { assetId: logoAssetId })
  }
  return ok({ ...content.logo.settings, assetId: logoAssetId, aspect: asset.width / asset.height })
}
