import { create } from 'zustand'
import { DEFAULT_USER_SETTINGS, type UserSettings } from '../domain/userSettings'
import type { SlaidsRepository } from '../persistence/repository'

interface UserSettingsState extends UserSettings {
  ownerId: string | null
  status: 'loading' | 'ready' | 'error'
}

export const useUserSettings = create<UserSettingsState>(() => ({
  ...DEFAULT_USER_SETTINGS,
  ownerId: null,
  status: 'loading',
}))

let generation = 0

export async function loadUserSettings(
  repository: SlaidsRepository,
  ownerId: string | null,
): Promise<void> {
  const request = ++generation
  useUserSettings.setState({ ...DEFAULT_USER_SETTINGS, ownerId, status: 'loading' })
  try {
    const settings = await repository.getUserSettings(ownerId)
    if (request === generation) useUserSettings.setState({ ...settings, status: 'ready' })
  } catch {
    if (request === generation) useUserSettings.setState({ status: 'error' })
  }
}

export async function saveUserSettings(
  repository: SlaidsRepository,
  patch: Partial<UserSettings>,
): Promise<void> {
  const { ownerId, status } = useUserSettings.getState()
  if (status !== 'ready') throw new Error('Brukerinnstillingene er ikke hentet ennå.')
  const request = generation
  await repository.updateUserSettings(ownerId, patch)
  if (request === generation) useUserSettings.setState(patch)
}

export function resetUserSettings(): void {
  generation += 1
  useUserSettings.setState({ ...DEFAULT_USER_SETTINGS, ownerId: null, status: 'loading' })
}
