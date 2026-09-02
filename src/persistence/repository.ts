/**
 * Storage abstraction.
 *
 * The UI depends on this interface only. There are two implementations —
 * `DexieSlaidsRepository` (IndexedDB, local/test mode) and
 * `SupabaseSlaidsRepository` (production) — and `activeRepository.ts` is the
 * one place that decides which of them is live.
 */

import type { SharedPresentationSnapshot } from '../domain/sharing'
import type {
  AssetRef,
  Folder,
  LayoutTemplate,
  Presentation,
  PresentationSummary,
} from '../domain/types'

export interface StoredAsset {
  ref: AssetRef
  blob: Blob
}

export interface SlaidsRepository {
  listPresentations(): Promise<PresentationSummary[]>
  loadPresentation(id: string): Promise<Presentation>
  savePresentation(presentation: Presentation): Promise<void>
  deletePresentation(id: string): Promise<void>

  listFolders(): Promise<Folder[]>
  saveFolder(folder: Folder): Promise<void>
  deleteFolder(id: string): Promise<void>

  listTemplates(): Promise<LayoutTemplate[]>
  saveTemplate(template: LayoutTemplate): Promise<void>
  deleteTemplate(id: string): Promise<void>

  putAsset(presentationId: string, ref: AssetRef, blob: Blob): Promise<void>
  getAsset(id: string): Promise<StoredAsset | null>
  listAssets(presentationId: string): Promise<AssetRef[]>
  /**
   * Which of these asset ids are already stored, no matter which presentation
   * owns them. Asset rows are keyed by id alone, so an importer has to know
   * this before writing, or it would overwrite someone else's file.
   */
  existingAssetIds(ids: readonly string[]): Promise<string[]>
  deleteAsset(id: string): Promise<void>
  deleteAssetsForPresentation(presentationId: string): Promise<void>
  /** Remove asset rows whose owning presentation no longer exists. */
  deleteOrphanAssets(): Promise<number>
}

/**
 * What the editor needs to know about sharing, and nothing more.
 *
 * `token` is `null` whenever `shared` is false — a revoked token is not a link,
 * and handing one out would let the UI show an address that cannot work.
 */
export interface ShareState {
  shared: boolean
  token: string | null
}

/**
 * Publishing a presentation to a secret link.
 *
 * Deliberately a separate interface from `SlaidsRepository`: sharing needs a
 * public backend, so it exists in Supabase mode and nowhere else. Local mode
 * has no answer to "what does an anonymous visitor see", and a pretend local
 * implementation would be worse than none — it would produce links that look
 * shareable and are not. `activeRepository.ts` decides whether there is one.
 */
export interface SharingRepository {
  /** The current state as stored, never as remembered. */
  readShareState(presentationId: string): Promise<ShareState>
  /**
   * Publish this snapshot under a **new** token, atomically. Any token handed
   * out before is dead from this moment, including one from an earlier share of
   * the same presentation.
   */
  enableSharing(
    presentationId: string,
    snapshot: SharedPresentationSnapshot,
  ): Promise<ShareState>
  /**
   * Stop sharing: the published copy is dropped and the token is rotated in the
   * same statement, so the link that was in circulation can never be revived.
   */
  disableSharing(presentationId: string): Promise<ShareState>
}

export class RepositoryError extends Error {
  readonly detail?: unknown

  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'RepositoryError'
    this.detail = detail
  }
}

/**
 * The row is not there.
 *
 * Told apart from every other repository failure on purpose: "this
 * presentation does not exist" and "the store did not answer" call for opposite
 * reactions, and a caller that cannot tell them apart will treat an outage as a
 * deletion. Only a genuinely absent row throws this — never a network error, a
 * refused query or a document that failed validation.
 */
export class RepositoryNotFoundError extends RepositoryError {
  constructor(message: string, detail?: unknown) {
    super(message, detail)
    this.name = 'RepositoryNotFoundError'
  }
}

/**
 * A write lost a race: the stored copy has moved on since the one being saved
 * was read, so writing it would silently discard whatever the other tab or
 * device did. The caller is told rather than overwritten.
 */
export class RepositoryConflictError extends RepositoryError {
  constructor(message: string, detail?: unknown) {
    super(message, detail)
    this.name = 'RepositoryConflictError'
  }
}
