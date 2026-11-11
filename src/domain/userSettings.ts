import type { CitationStyle } from './references'

export interface UserSettings {
  citationStyle: CitationStyle
  includeReferencesInProgress: boolean
  fewerDialogs: boolean
  /**
   * Temamalen nye presentasjoner starter i (§ 15.4), eller `null` når brukeren
   * ikke har valgt noen. Da gjelder standardtemaet.
   */
  defaultThemeTemplateId: string | null
}

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = {
  citationStyle: 'numbered',
  includeReferencesInProgress: false,
  fewerDialogs: false,
  defaultThemeTemplateId: null,
}
