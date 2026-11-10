import type { CitationStyle } from './references'

export interface UserSettings {
  citationStyle: CitationStyle
  includeReferencesInProgress: boolean
}

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = {
  citationStyle: 'numbered',
  includeReferencesInProgress: false,
}
