export interface UserSettings {
  includeReferencesInProgress: boolean
}

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = {
  includeReferencesInProgress: false,
}
