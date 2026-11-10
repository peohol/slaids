/**
 * The one place that decides which storage Slaids is talking to.
 *
 *  - Supabase configured  → `SupabaseSlaidsRepository` (production). Sign-in is
 *    required before the library or the editor is shown, so by the time any of
 *    these methods run there is a session; if there is not, the repository says
 *    so rather than writing anywhere else.
 *  - Supabase not configured → `DexieSlaidsRepository` (local development and
 *    the test suites), exactly as before.
 *  - Half configured → nothing at all. There is no repository to resolve, and
 *    asking for one raises.
 *
 * This is a mode, not a fallback. A configured Supabase that happens to be
 * unreachable must surface as an error: silently writing to IndexedDB instead
 * would leave two copies of the truth, neither of them complete. The same goes
 * for a build that only got half its variables — that is a deployment mistake,
 * and IndexedDB is never the answer to one.
 *
 * `repository` is a thin façade rather than a resolved instance, so callers can
 * keep a module-level import type { UserSettings } from '../domain/userSettings'
import while the decision stays here and stays late
 * enough to be testable.
 */

import { SupabaseConfigurationError, readSupabaseConfigState } from '../supabase/config'
import { getSupabaseClient } from '../supabase/client'
import { DexieSlaidsRepository } from './dexieRepository'
import { SupabaseSlaidsRepository } from './supabaseRepository'
import type {
  FolderSharingRepository,
  SaveGuard,
  ShareState,
  SharingRepository,
  SlaidsRepository,
  StoredAsset,
} from './repository'
import type { AutocorrectRule } from '../domain/autocorrect'
import type { SharedPresentationSnapshot } from '../domain/sharing'
import type {
  AssetRef,
  Folder,
  LayoutTemplate,
  Presentation,
  PresentationSummary,
} from '../domain/types'

export type StorageMode = 'supabase' | 'local' | 'misconfigured'

export function storageMode(): StorageMode {
  const state = readSupabaseConfigState()
  if (state.kind === 'configured') return 'supabase'
  if (state.kind === 'absent') return 'local'
  return 'misconfigured'
}

let dexieInstance: DexieSlaidsRepository | null = null
let supabaseInstance: SupabaseSlaidsRepository | null = null
let override: SlaidsRepository | null = null
let sharingOverride: SharingRepository | null = null
let folderSharingOverride: FolderSharingRepository | null = null

export function resolveRepository(): SlaidsRepository {
  if (override) return override
  const state = readSupabaseConfigState()
  // Half a configuration resolves to nothing. Dexie here would mean a
  // production deployment saving into the browser without anybody noticing.
  if (state.kind === 'incomplete') throw new SupabaseConfigurationError(state.missing)
  if (state.kind === 'configured') {
    supabaseInstance ??= new SupabaseSlaidsRepository(getSupabaseClient)
    return supabaseInstance
  }
  dexieInstance ??= new DexieSlaidsRepository()
  return dexieInstance
}

/** Test seam: pin the active repository, or pass `null` to go back to the mode. */
export function setRepositoryOverride(next: SlaidsRepository | null): void {
  override = next
}

/**
 * Sharing publishes to a public backend, which exists in Supabase mode only.
 *
 * Local mode is not a lesser version of it: there is no anonymous reader to
 * publish *to*, so there is nothing to build. A local stand-in would hand out
 * links that look shareable and are not, which is worse than the honest answer
 * the UI gives instead — the toggle is there, disabled, and says why.
 */
export function isSharingSupported(): boolean {
  return sharingOverride !== null || folderSharingOverride !== null || storageMode() === 'supabase'
}

export class SharingUnavailableError extends Error {
  constructor() {
    super('Deling krever at Slaids er satt opp mot Supabase.')
    this.name = 'SharingUnavailableError'
  }
}

/** The repository that publishes, which is the Supabase one or none at all. */
function publishingRepository(): SupabaseSlaidsRepository {
  const state = readSupabaseConfigState()
  if (state.kind === 'incomplete') throw new SupabaseConfigurationError(state.missing)
  if (state.kind !== 'configured') throw new SharingUnavailableError()
  supabaseInstance ??= new SupabaseSlaidsRepository(getSupabaseClient)
  return supabaseInstance
}

export function resolveSharing(): SharingRepository {
  return sharingOverride ?? publishingRepository()
}

/** Test seam: pin the sharing backend, or pass `null` to go back to the mode. */
export function setSharingOverride(next: SharingRepository | null): void {
  sharingOverride = next
}

/**
 * Folder sharing, which lives where presentation sharing does: on the Supabase
 * repository, in Supabase mode only.
 */
export function resolveFolderSharing(): FolderSharingRepository {
  return folderSharingOverride ?? publishingRepository()
}

/** Test seam: pin the folder sharing backend, or pass `null` to go back to the mode. */
export function setFolderSharingOverride(next: FolderSharingRepository | null): void {
  folderSharingOverride = next
}

/**
 * Drop everything the repositories remember about the current user. Called on
 * sign-out so the next session starts from the server, not from a cache that
 * belonged to somebody else.
 */
export function resetRepositoryCaches(): void {
  supabaseInstance = null
}

/**
 * Resolving can fail — a half-configured build has no repository — and the
 * façade promises a promise, so the failure comes back as a rejection rather
 * than as a synchronous throw out of whatever called it.
 */
function on<T>(call: (repository: SlaidsRepository) => Promise<T>): Promise<T> {
  let resolved: SlaidsRepository
  try {
    resolved = resolveRepository()
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
  return call(resolved)
}

function onSharing<T>(call: (repository: SharingRepository) => Promise<T>): Promise<T> {
  let resolved: SharingRepository
  try {
    resolved = resolveSharing()
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
  return call(resolved)
}

function onFolderSharing<T>(call: (repository: FolderSharingRepository) => Promise<T>): Promise<T> {
  let resolved: FolderSharingRepository
  try {
    resolved = resolveFolderSharing()
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
  return call(resolved)
}

export const repository: SlaidsRepository = {
  listPresentations: (): Promise<PresentationSummary[]> => on((repo) => repo.listPresentations()),
  listTrashedPresentations: (): Promise<PresentationSummary[]> =>
    on((repo) => repo.listTrashedPresentations()),
  loadPresentation: (id: string): Promise<Presentation> => on((repo) => repo.loadPresentation(id)),
  // Both preconditions are forwarded rather than dropped. The editor never
  // passes one, but the façade is the interface for everyone: a guard silently
  // lost here would be an optimistic lock that quietly does not happen.
  savePresentation: (presentation: Presentation, guard?: SaveGuard): Promise<void> =>
    on((repo) => repo.savePresentation(presentation, guard)),
  deletePresentation: (id: string, guard?: SaveGuard): Promise<void> =>
    on((repo) => repo.deletePresentation(id, guard)),
  trashPresentation: (id: string, guard?: SaveGuard): Promise<void> =>
    on((repo) => repo.trashPresentation(id, guard)),
  restorePresentation: (id: string): Promise<void> => on((repo) => repo.restorePresentation(id)),
  purgePresentation: (id: string, deletedAt: string): Promise<boolean> =>
    on((repo) => repo.purgePresentation(id, deletedAt)),

  listFolders: (): Promise<Folder[]> => on((repo) => repo.listFolders()),
  saveFolder: (folder: Folder): Promise<void> => on((repo) => repo.saveFolder(folder)),
  renameFolder: (id: string, name: string): Promise<Folder | null> =>
    on((repo) => repo.renameFolder(id, name)),
  deleteFolder: (id: string): Promise<void> => on((repo) => repo.deleteFolder(id)),

  listTemplates: (): Promise<LayoutTemplate[]> => on((repo) => repo.listTemplates()),
  saveTemplate: (template: LayoutTemplate): Promise<void> =>
    on((repo) => repo.saveTemplate(template)),
  deleteTemplate: (id: string): Promise<void> => on((repo) => repo.deleteTemplate(id)),

  getUserSettings: (ownerId) => on((repo) => repo.getUserSettings(ownerId)),
  updateUserSettings: (ownerId, patch) => on((repo) => repo.updateUserSettings(ownerId, patch)),

  loadAutocorrectRules: (): Promise<AutocorrectRule[]> => on((repo) => repo.loadAutocorrectRules()),
  saveAutocorrectRules: (rules: readonly AutocorrectRule[]): Promise<void> =>
    on((repo) => repo.saveAutocorrectRules(rules)),

  putAsset: (presentationId: string, ref: AssetRef, blob: Blob): Promise<void> =>
    on((repo) => repo.putAsset(presentationId, ref, blob)),
  getAsset: (id: string): Promise<StoredAsset | null> => on((repo) => repo.getAsset(id)),
  listAssets: (presentationId: string): Promise<AssetRef[]> =>
    on((repo) => repo.listAssets(presentationId)),
  existingAssetIds: (ids: readonly string[]): Promise<string[]> =>
    on((repo) => repo.existingAssetIds(ids)),
  deleteAsset: (id: string): Promise<boolean> => on((repo) => repo.deleteAsset(id)),
  deleteAssetsForPresentation: (presentationId: string): Promise<void> =>
    on((repo) => repo.deleteAssetsForPresentation(presentationId)),
  deleteOrphanAssets: (): Promise<number> => on((repo) => repo.deleteOrphanAssets()),
}

export const sharing: SharingRepository = {
  readShareState: (presentationId: string): Promise<ShareState> =>
    onSharing((repo) => repo.readShareState(presentationId)),
  enableSharing: (
    presentationId: string,
    snapshot: SharedPresentationSnapshot,
  ): Promise<ShareState> => onSharing((repo) => repo.enableSharing(presentationId, snapshot)),
  disableSharing: (presentationId: string): Promise<ShareState> =>
    onSharing((repo) => repo.disableSharing(presentationId)),
}

export const folderSharing: FolderSharingRepository = {
  listFolderShareStates: (): Promise<Record<string, ShareState>> =>
    onFolderSharing((repo) => repo.listFolderShareStates()),
  enableFolderSharing: (folderId: string): Promise<ShareState> =>
    onFolderSharing((repo) => repo.enableFolderSharing(folderId)),
  disableFolderSharing: (folderId: string): Promise<ShareState> =>
    onFolderSharing((repo) => repo.disableFolderSharing(folderId)),
}
