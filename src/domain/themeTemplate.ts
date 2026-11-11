/**
 * Temamaler (§ 15.4).
 *
 * En temamal er et uavhengig øyeblikksbilde av tre ting: alle innstillingene i
 * temaeditoren, forsidens bakgrunns- og aksentfarge, og logoen med alle
 * innstillingene for visning, plassering og størrelse. Aldri tekst, slides
 * eller sonetrær.
 *
 * Logofilen er ikke en del av innholdet. Innholdet sier hva slags fil det er
 * (`ThemeTemplateLogoFile`), og bytene lagres for seg av lageret. Når malen
 * brukes, kopieres filen inn i presentasjonens eget fillager og får sin egen
 * id, så presentasjonen virker videre om malen slettes eller endres.
 *
 * Her står bare typene og de rene funksjonene: hvordan et øyeblikksbilde tas av
 * en presentasjon, og hvordan lagret innhold leses og repareres. Å bruke en mal
 * er kommandoen `applyThemeTemplate`; å flytte filen er lagerets sak.
 */

import { defaultTheme } from './presentation'
import { themeTemplateContentSchema } from './schema'
import type { AssetRef, Presentation, PresentationTheme, ThemeLogo } from './types'

/** Privat: bare eieren ser og bruker den. Delt: alle aktive Slaids-brukere. */
export const THEME_TEMPLATE_VISIBILITIES = ['private', 'shared'] as const
export type ThemeTemplateVisibility = (typeof THEME_TEMPLATE_VISIBILITIES)[number]

/** Lengste navn en mal kan ha. Det samme tallet står i databasens regel. */
export const THEME_TEMPLATE_NAME_MAX = 80

/** Logofilen i en mal: hva den er, ikke hvor den ligger. */
export type ThemeTemplateLogoFile = Omit<AssetRef, 'id'>

/** Logoens innstillinger i en mal. Fil-id-en er alltid presentasjonens egen. */
export type ThemeTemplateLogoSettings = Omit<ThemeLogo, 'assetId'>

export interface ThemeTemplateContent {
  theme: Omit<PresentationTheme, 'logo'>
  front: { backgroundColor: string; accentColor: string }
  logo: { file: ThemeTemplateLogoFile; settings: ThemeTemplateLogoSettings } | null
}

export interface ThemeTemplate {
  id: string
  name: string
  visibility: ThemeTemplateVisibility
  /** Om malen er denne brukerens egen. Bare eieren kan endre og slette den. */
  own: boolean
  content: ThemeTemplateContent
  createdAt: string
  updatedAt: string
}

/**
 * Øyeblikksbildet av presentasjonens tema, sammen med id-en til logofilen
 * lageret må kopiere bytene fra – `null` når presentasjonen ikke har logo.
 */
export function themeTemplateContent(presentation: Presentation): {
  content: ThemeTemplateContent
  logoAssetId: string | null
} {
  const { logo, ...theme } = presentation.theme
  const front = presentation.slides[0]
  const file = logo ? presentation.assets.find((asset) => asset.id === logo.assetId) : undefined
  const content: ThemeTemplateContent = {
    theme,
    front: { backgroundColor: front.backgroundColor, accentColor: front.accentColor },
    logo: null,
  }
  if (!logo || !file) return { content, logoAssetId: null }
  const { id: _id, ...fileWithoutId } = file
  const { assetId: _assetId, ...settings } = logo
  return { content: { ...content, logo: { file: fileWithoutId, settings } }, logoAssetId: logo.assetId }
}

/**
 * Lagret innhold, kontrollert og reparert, eller `null` når det ikke kan
 * brukes.
 *
 * Temaet legges over dagens standardverdier, slik standardtemaet gjør, så en
 * mal lagret før en innstilling fantes beholder alt sitt og får den nye
 * innstillingens standard i stedet for å bli ugyldig.
 */
export function parseThemeTemplateContent(input: unknown): ThemeTemplateContent | null {
  if (!input || typeof input !== 'object') return null
  const stored = input as { theme?: unknown }
  const theme =
    stored.theme && typeof stored.theme === 'object' ? { ...defaultTheme(), ...stored.theme } : stored.theme
  const parsed = themeTemplateContentSchema.safeParse({ ...stored, theme })
  return parsed.success ? (parsed.data as ThemeTemplateContent) : null
}

/** Et navn slik det lagres: uten luft rundt, og aldri lengre enn grensen. */
export function normalizeThemeTemplateName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, THEME_TEMPLATE_NAME_MAX)
}
