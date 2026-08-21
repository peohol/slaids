/**
 * Storage abstraction.
 *
 * The UI depends on this interface only. Today the single implementation is
 * Dexie/IndexedDB; a Supabase implementation can be dropped in later without
 * touching the domain or the UI.
 */

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

export class RepositoryError extends Error {
  readonly detail?: unknown

  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'RepositoryError'
    this.detail = detail
  }
}
