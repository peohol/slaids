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
 * keep a module-level import while the decision stays here and stays late
 * enough to be testable.
 */

import { SupabaseConfigurationError, readSupabaseConfigState } from '../supabase/config'
import { getSupabaseClient } from '../supabase/client'
import { DexieSlaidsRepository } from './dexieRepository'
import { SupabaseSlaidsRepository } from './supabaseRepository'
import type { SlaidsRepository, StoredAsset } from './repository'
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

export const repository: SlaidsRepository = {
  listPresentations: (): Promise<PresentationSummary[]> => on((repo) => repo.listPresentations()),
  loadPresentation: (id: string): Promise<Presentation> => on((repo) => repo.loadPresentation(id)),
  savePresentation: (presentation: Presentation): Promise<void> =>
    on((repo) => repo.savePresentation(presentation)),
  deletePresentation: (id: string): Promise<void> => on((repo) => repo.deletePresentation(id)),

  listFolders: (): Promise<Folder[]> => on((repo) => repo.listFolders()),
  saveFolder: (folder: Folder): Promise<void> => on((repo) => repo.saveFolder(folder)),
  deleteFolder: (id: string): Promise<void> => on((repo) => repo.deleteFolder(id)),

  listTemplates: (): Promise<LayoutTemplate[]> => on((repo) => repo.listTemplates()),
  saveTemplate: (template: LayoutTemplate): Promise<void> =>
    on((repo) => repo.saveTemplate(template)),
  deleteTemplate: (id: string): Promise<void> => on((repo) => repo.deleteTemplate(id)),

  putAsset: (presentationId: string, ref: AssetRef, blob: Blob): Promise<void> =>
    on((repo) => repo.putAsset(presentationId, ref, blob)),
  getAsset: (id: string): Promise<StoredAsset | null> => on((repo) => repo.getAsset(id)),
  listAssets: (presentationId: string): Promise<AssetRef[]> =>
    on((repo) => repo.listAssets(presentationId)),
  existingAssetIds: (ids: readonly string[]): Promise<string[]> =>
    on((repo) => repo.existingAssetIds(ids)),
  deleteAsset: (id: string): Promise<void> => on((repo) => repo.deleteAsset(id)),
  deleteAssetsForPresentation: (presentationId: string): Promise<void> =>
    on((repo) => repo.deleteAssetsForPresentation(presentationId)),
  deleteOrphanAssets: (): Promise<number> => on((repo) => repo.deleteOrphanAssets()),
}
