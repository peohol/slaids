/**
 * Dexie/IndexedDB implementation of `SlaidsRepository`.
 *
 * Everything that comes back out of the database is migrated and validated
 * before it reaches the domain, so a corrupted or outdated record surfaces as a
 * clear error instead of a broken editor.
 */

import { migratePresentation } from '../domain/migrations'
import { validateLayoutTemplate } from '../domain/schema'
import { summarize } from '../domain/presentation'
import type {
  AssetRef,
  Folder,
  LayoutTemplate,
  Presentation,
  PresentationSummary,
} from '../domain/types'
import { db, type SlaidsDatabase } from './db'
import { RepositoryError, type SlaidsRepository, type StoredAsset } from './repository'

export class DexieSlaidsRepository implements SlaidsRepository {
  constructor(private readonly database: SlaidsDatabase = db) {}

  async listPresentations(): Promise<PresentationSummary[]> {
    const records = await this.database.presentations.orderBy('updatedAt').reverse().toArray()
    return records.map((record) => {
      const migrated = migratePresentation(record.data)
      if (migrated.ok) return summarize(migrated.value)
      return {
        id: record.id,
        title: record.title,
        folderId: record.folderId,
        slideCount: 0,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }
    })
  }

  async loadPresentation(id: string): Promise<Presentation> {
    const record = await this.database.presentations.get(id)
    if (!record) throw new RepositoryError(`Fant ikke presentasjonen «${id}».`)
    const migrated = migratePresentation(record.data)
    if (!migrated.ok) throw new RepositoryError(migrated.error.message)
    return migrated.value
  }

  async savePresentation(presentation: Presentation): Promise<void> {
    // Strip any accidental non-cloneable values and keep the record indexable.
    const data = JSON.parse(JSON.stringify(presentation)) as Presentation
    await this.database.presentations.put({
      id: data.id,
      title: data.title,
      folderId: data.folderId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      data,
    })
  }

  async deletePresentation(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.presentations, this.database.assets, async () => {
      await this.database.presentations.delete(id)
      await this.database.assets.where('presentationId').equals(id).delete()
    })
  }

  async listFolders(): Promise<Folder[]> {
    return this.database.folders.orderBy('name').toArray()
  }

  async saveFolder(folder: Folder): Promise<void> {
    await this.database.folders.put(folder)
  }

  /** Presentations in a deleted folder move back to the root rather than vanish. */
  async deleteFolder(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.folders, this.database.presentations, async () => {
      await this.database.folders.delete(id)
      const affected = await this.database.presentations.where('folderId').equals(id).toArray()
      for (const record of affected) {
        await this.database.presentations.put({
          ...record,
          folderId: null,
          data: { ...record.data, folderId: null },
        })
      }
    })
  }

  async listTemplates(): Promise<LayoutTemplate[]> {
    const records = await this.database.templates.orderBy('createdAt').toArray()
    return records.filter((record) => validateLayoutTemplate(record).ok)
  }

  async saveTemplate(template: LayoutTemplate): Promise<void> {
    const validation = validateLayoutTemplate(template)
    if (!validation.ok) throw new RepositoryError('Malen er ugyldig og kan ikke lagres.')
    await this.database.templates.put(JSON.parse(JSON.stringify(template)) as LayoutTemplate)
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.database.templates.delete(id)
  }

  async putAsset(presentationId: string, ref: AssetRef, blob: Blob): Promise<void> {
    await this.database.assets.put({ ...ref, presentationId, blob })
  }

  async getAsset(id: string): Promise<StoredAsset | null> {
    const record = await this.database.assets.get(id)
    if (!record) return null
    const { blob, presentationId: _presentationId, ...ref } = record
    return { ref, blob }
  }

  async listAssets(presentationId: string): Promise<AssetRef[]> {
    const records = await this.database.assets.where('presentationId').equals(presentationId).toArray()
    return records.map(({ blob: _blob, presentationId: _pid, ...ref }) => ref)
  }

  async existingAssetIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return []
    // `primaryKeys()` answers this without pulling any blobs into memory.
    const keys = await this.database.assets.where('id').anyOf([...ids]).primaryKeys()
    return keys as string[]
  }

  async deleteAsset(id: string): Promise<void> {
    await this.database.assets.delete(id)
  }

  async deleteAssetsForPresentation(presentationId: string): Promise<void> {
    await this.database.assets.where('presentationId').equals(presentationId).delete()
  }

  /**
   * Asset rows are only ever deleted with their presentation, so a write that
   * failed halfway could leave rows nothing can reach. This reclaims them.
   */
  async deleteOrphanAssets(): Promise<number> {
    return this.database.transaction(
      'rw',
      this.database.presentations,
      this.database.assets,
      async () => {
        const owners = new Set(await this.database.presentations.toCollection().primaryKeys())
        const orphans = await this.database.assets
          .filter((asset) => !owners.has(asset.presentationId))
          .primaryKeys()
        if (orphans.length > 0) await this.database.assets.bulkDelete(orphans)
        return orphans.length
      },
    )
  }
}
