/**
 * Dexie/IndexedDB implementation of `SlaidsRepository`.
 *
 * Everything that comes back out of the database is migrated and validated
 * before it reaches the domain, so a corrupted or outdated record surfaces as a
 * clear error instead of a broken editor.
 */

import { migratePresentation } from '../domain/migrations'
import { presentationRevision } from '../domain/revision'
import { validateLayoutTemplate } from '../domain/schema'
import { documentByteSize, summarize } from '../domain/presentation'
import type {
  AssetRef,
  Folder,
  LayoutTemplate,
  Presentation,
  PresentationSummary,
} from '../domain/types'
import { db, type PresentationRecord, type SlaidsDatabase } from './db'
import {
  RepositoryConflictError,
  RepositoryError,
  RepositoryNotFoundError,
  type SaveGuard,
  type SlaidsRepository,
  type StoredAsset,
} from './repository'

/** Why a trashed presentation is not found: it is somewhere else, and can come back. */
export function trashedMessage(id: string): string {
  return `Presentasjonen «${id}» ligger i søppelkassen. Gjenopprett den fra biblioteket for å åpne den.`
}

export class DexieSlaidsRepository implements SlaidsRepository {
  constructor(private readonly database: SlaidsDatabase = db) {}

  async listPresentations(): Promise<PresentationSummary[]> {
    // Filtered in memory rather than by index: IndexedDB cannot index `null`,
    // and a record from before the trash existed has no `deletedAt` at all.
    const records = await this.database.presentations
      .orderBy('updatedAt')
      .reverse()
      .filter((record) => !record.deletedAt)
      .toArray()
    return records.map((record) => this.summaryOf(record))
  }

  async listTrashedPresentations(): Promise<PresentationSummary[]> {
    const records = await this.database.presentations
      .filter((record) => Boolean(record.deletedAt))
      .toArray()
    return records
      .map((record) => this.summaryOf(record))
      // ISO timestamps order as strings. Most recently trashed first, so what
      // was just deleted by mistake is at the top.
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
  }

  /**
   * A record as the library sees it.
   *
   * A record whose document no longer migrates still gets a row — with what the
   * record itself says, and the size of the bytes it holds — so a broken deck is
   * something the owner can see and delete rather than a gap in the grid.
   */
  private summaryOf(record: PresentationRecord): PresentationSummary {
    const deletedAt = record.deletedAt ?? null
    const migrated = migratePresentation(record.data)
    if (migrated.ok) return summarize(migrated.value, deletedAt)
    return {
      id: record.id,
      title: record.title,
      folderId: record.folderId,
      slideCount: 0,
      byteSize: documentByteSize(record.data),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt,
    }
  }

  async loadPresentation(id: string): Promise<Presentation> {
    const record = await this.database.presentations.get(id)
    if (!record) throw new RepositoryNotFoundError(`Fant ikke presentasjonen «${id}».`)
    // A trashed deck is not opened, edited or copied; it is restored first.
    // The refusal is the same kind as an absent row, because to everything
    // but the trash view that is what it is.
    if (record.deletedAt) throw new RepositoryNotFoundError(trashedMessage(id))
    const migrated = migratePresentation(record.data)
    if (!migrated.ok) throw new RepositoryError(migrated.error.message)
    return migrated.value
  }

  async savePresentation(presentation: Presentation, guard?: SaveGuard): Promise<void> {
    // Strip any accidental non-cloneable values and keep the record indexable.
    const data = JSON.parse(JSON.stringify(presentation)) as Presentation
    const record: PresentationRecord = {
      id: data.id,
      title: data.title,
      folderId: data.folderId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      deletedAt: null,
      data,
    }

    // Always inside a transaction, guarded or not, because a `put` replaces the
    // whole record and one field of it is not the document's to write:
    // `deletedAt` belongs to the store. A save carries the stored value over,
    // so a deck that was trashed in another tab stays in the trash when this tab
    // autosaves it — and a deck that was never trashed stays out of it.
    //
    // The guard, when there is one, is compared in the same transaction. There
    // is no version column here, so the comparison is against the stored
    // document itself — and it has to happen in the same transaction as the
    // write, or it is not a guard at all: two writers can both read, both agree
    // the document is the one they loaded, and the second `put` still wins.
    // IndexedDB serialises `rw` transactions on the same store, so this is the
    // compare-and-swap that the Supabase `version` guard is over there.
    await this.database.transaction('rw', this.database.presentations, async () => {
      const stored = await this.database.presentations.get(data.id)
      // No row means nothing to overwrite: an insert is not a lost update.
      if (guard && stored && presentationRevision(stored.data) !== guard.expectedRevision) {
        throw new RepositoryConflictError(
          `«${data.title}» er endret et annet sted siden den ble lest. Les den på nytt før du lagrer.`,
        )
      }
      await this.database.presentations.put({ ...record, deletedAt: stored?.deletedAt ?? null })
    })
  }

  /**
   * Into the trash: the record stays, and only `deletedAt` changes.
   *
   * The guard is compared inside the transaction for the reason
   * `deletePresentation` gives, and an absent row fails it for the same reason
   * too. Unguarded, an absent row is a `RepositoryNotFoundError` — see the
   * interface for why that differs from the permanent delete.
   */
  async trashPresentation(id: string, guard?: SaveGuard): Promise<void> {
    await this.database.transaction('rw', this.database.presentations, async () => {
      const stored = await this.database.presentations.get(id)
      if (guard) {
        if (!stored || presentationRevision(stored.data) !== guard.expectedRevision) {
          throw new RepositoryConflictError(
            `«${stored?.title ?? id}» er endret eller slettet et annet sted siden den ble lest. Les den på nytt før du sletter den.`,
          )
        }
      } else if (!stored) {
        throw new RepositoryNotFoundError(`Fant ikke presentasjonen «${id}».`)
      }
      await this.database.presentations.put({ ...stored, deletedAt: new Date().toISOString() })
    })
  }

  async restorePresentation(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.presentations, async () => {
      const stored = await this.database.presentations.get(id)
      if (!stored) {
        throw new RepositoryNotFoundError(`Fant ikke presentasjonen «${id}» i søppelkassen.`)
      }
      if (stored.deletedAt) await this.database.presentations.put({ ...stored, deletedAt: null })
    })
  }

  /**
   * The document and its files, in one transaction.
   *
   * A `guard` is compared inside that same transaction, for exactly the reason
   * `savePresentation` compares there: reading the document, agreeing it is the
   * one the caller read, and *then* deleting is not a guard — the other writer
   * can land in between. IndexedDB serialises `rw` transactions on a store, so
   * this is a real compare-and-delete.
   *
   * A row that is not there fails the guard, and that is not the same rule as
   * the one `savePresentation` uses. A guarded save of an absent row is an
   * insert, which is not a lost update; a guarded delete names a document —
   * "remove the one I read" — and a row that is gone is not it. Somebody else
   * removed it, and the caller should read again rather than be told its own
   * delete is what happened. An *unguarded* delete is unchanged and still
   * idempotent, which is what the duplication rollback and the purge of the
   * trash rely on.
   */
  async deletePresentation(id: string, guard?: SaveGuard): Promise<void> {
    await this.database.transaction('rw', this.database.presentations, this.database.assets, async () => {
      if (guard) {
        const stored = await this.database.presentations.get(id)
        if (!stored || presentationRevision(stored.data) !== guard.expectedRevision) {
          throw new RepositoryConflictError(
            `«${stored?.title ?? id}» er endret eller slettet et annet sted siden den ble lest. Les den på nytt før du sletter den.`,
          )
        }
      }
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
    // The validator is also the repair — a template stored before zone ratios
    // became whole numbers is rewritten in them — so what comes back is its
    // value, never the row as it was read.
    const templates: LayoutTemplate[] = []
    for (const record of records) {
      const validated = validateLayoutTemplate(record)
      if (validated.ok && validated.value) templates.push(validated.value as LayoutTemplate)
    }
    return templates
  }

  async saveTemplate(template: LayoutTemplate): Promise<void> {
    const validation = validateLayoutTemplate(template)
    if (!validation.ok || !validation.value) {
      throw new RepositoryError('Malen er ugyldig og kan ikke lagres.')
    }
    await this.database.templates.put(JSON.parse(JSON.stringify(validation.value)) as LayoutTemplate)
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

  async deleteAsset(id: string): Promise<boolean> {
    // One store, one row: the bytes live in the row, so there is no second
    // removal that could fail on its own. Always `true` once the delete lands.
    await this.database.assets.delete(id)
    return true
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
