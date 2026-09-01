/**
 * The one place that decides which storage Slaids is talking to.
 *
 *  - Supabase configured  → `SupabaseSlaidsRepository` (production). Sign-in is
 *    required before the library or the editor is shown, so by the time any of
 *    these methods run there is a session; if there is not, the repository says
 *    so rather than writing anywhere else.
 *  - Supabase not configured → `DexieSlaidsRepository` (local development and
 *    the test suites), exactly as before.
 *
 * This is a mode, not a fallback. A configured Supabase that happens to be
 * unreachable must surface as an error: silently writing to IndexedDB instead
 * would leave two copies of the truth, neither of them complete.
 *
 * `repository` is a thin façade rather than a resolved instance, so callers can
 * keep a module-level import while the decision stays here and stays late
 * enough to be testable.
 */

import { isSupabaseConfigured } from '../supabase/config'
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

export type StorageMode = 'supabase' | 'local'

export function storageMode(): StorageMode {
  return isSupabaseConfigured() ? 'supabase' : 'local'
}

let dexieInstance: DexieSlaidsRepository | null = null
let supabaseInstance: SupabaseSlaidsRepository | null = null
let override: SlaidsRepository | null = null

export function resolveRepository(): SlaidsRepository {
  if (override) return override
  if (storageMode() === 'supabase') {
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

export const repository: SlaidsRepository = {
  listPresentations: (): Promise<PresentationSummary[]> => resolveRepository().listPresentations(),
  loadPresentation: (id: string): Promise<Presentation> => resolveRepository().loadPresentation(id),
  savePresentation: (presentation: Presentation): Promise<void> =>
    resolveRepository().savePresentation(presentation),
  deletePresentation: (id: string): Promise<void> => resolveRepository().deletePresentation(id),

  listFolders: (): Promise<Folder[]> => resolveRepository().listFolders(),
  saveFolder: (folder: Folder): Promise<void> => resolveRepository().saveFolder(folder),
  deleteFolder: (id: string): Promise<void> => resolveRepository().deleteFolder(id),

  listTemplates: (): Promise<LayoutTemplate[]> => resolveRepository().listTemplates(),
  saveTemplate: (template: LayoutTemplate): Promise<void> =>
    resolveRepository().saveTemplate(template),
  deleteTemplate: (id: string): Promise<void> => resolveRepository().deleteTemplate(id),

  putAsset: (presentationId: string, ref: AssetRef, blob: Blob): Promise<void> =>
    resolveRepository().putAsset(presentationId, ref, blob),
  getAsset: (id: string): Promise<StoredAsset | null> => resolveRepository().getAsset(id),
  listAssets: (presentationId: string): Promise<AssetRef[]> =>
    resolveRepository().listAssets(presentationId),
  existingAssetIds: (ids: readonly string[]): Promise<string[]> =>
    resolveRepository().existingAssetIds(ids),
  deleteAsset: (id: string): Promise<void> => resolveRepository().deleteAsset(id),
  deleteAssetsForPresentation: (presentationId: string): Promise<void> =>
    resolveRepository().deleteAssetsForPresentation(presentationId),
  deleteOrphanAssets: (): Promise<number> => resolveRepository().deleteOrphanAssets(),
}
