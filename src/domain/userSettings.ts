export interface UserSettings {
  includeReferencesInProgress: boolean
  fewerDialogs: boolean
}

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = {
  includeReferencesInProgress: false,
  fewerDialogs: false,
}
