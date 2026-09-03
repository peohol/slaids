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

/**
 * A precondition on a write: only store this if the stored copy is still the
 * one the caller read.
 *
 * The revision is `domain/revision.ts`'s digest of the document that was
 * loaded. It exists because the two implementations guard the same window with
 * different currencies — Supabase has a `version` column and IndexedDB has
 * nothing — and a caller that wants "do not overwrite somebody else" should not
 * have to know which store it is talking to.
 */
export interface SaveGuard {
  expectedRevision: string
}

export interface SlaidsRepository {
  listPresentations(): Promise<PresentationSummary[]>
  loadPresentation(id: string): Promise<Presentation>
  /**
   * Store the document. With a `guard`, refuse — `RepositoryConflictError` —
   * if the stored copy has moved on since the revision the guard names.
   *
   * Without one the write is unconditional, which is what the editor's autosave
   * wants: it owns the document it is editing and re-saves it continuously.
   */
  savePresentation(presentation: Presentation, guard?: SaveGuard): Promise<void>
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
   * Which of these asset ids this account already has a file under, whichever
   * presentation it belongs to. Asset rows are keyed by id alone, so an importer
   * asks before writing rather than discovering the clash afterwards.
   *
   * It answers for this account and no further — a remote store shows a user
   * only their own rows, and the server-side repository writes that same limit
   * out because its key would otherwise see past it. An id that looks free can
   * therefore still be taken by an account nobody here can see; that is not this
   * method's job to catch, and it is not left to chance either. The write
   * refuses such an id with a `RepositoryConflictError` rather than taking the
   * row over, which is the same answer `savePresentation` already gives and the
   * one `persistence/backup.ts` already knows how to act on.
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
