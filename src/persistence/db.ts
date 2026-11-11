/**
 * IndexedDB schema (via Dexie).
 *
 * Presentations are stored as validated JSON; binary asset data is stored
 * separately as Blobs so the presentation document stays small.
 */

import Dexie, { type Table } from 'dexie'
import type { ThemeTemplateContent, ThemeTemplateVisibility } from '../domain/themeTemplate'
import type { Folder, LayoutTemplate, Presentation } from '../domain/types'

export interface PresentationRecord {
  id: string
  title: string
  folderId: string | null
  createdAt: string
  updatedAt: string
  /**
   * When the presentation was moved to the trash. Absent on a record written
   * before the trash existed, and absent means the same as `null`: in the
   * library. Kept beside `data` rather than inside it on purpose — see
   * `PresentationSummary.deletedAt` — and never indexed: IndexedDB cannot index
   * `null`, and the library filters on it in memory instead.
   */
  deletedAt?: string | null
  data: Presentation
}

export interface AssetRecord {
  id: string
  presentationId: string
  name: string
  mimeType: string
  byteSize: number
  width: number
  height: number
  isVector: boolean
  /** See `AssetRef.contentHash`. Absent on a row written before it existed. */
  contentHash?: string
  blob: Blob
}

export type TemplateRecord = LayoutTemplate

/**
 * One of the user's own settings, by name. Local mode has one user, so the
 * name is the whole key; the value is repaired by whoever reads it.
 */
export interface SettingRecord {
  key: string
  value: unknown
}
export type FolderRecord = Folder

/**
 * En temamal (§ 15.4). Lokal modus har én bruker, så alle maler er brukerens
 * egne; synligheten lagres likevel, så modellen er den samme som i Supabase.
 * `content` kontrolleres av den som leser den.
 */
export interface ThemeTemplateRecord {
  id: string
  name: string
  visibility: ThemeTemplateVisibility
  content: ThemeTemplateContent
  createdAt: string
  updatedAt: string
}

/** Logofilen til en temamal, i en egen tabell så listen aldri henter bytene. */
export interface ThemeTemplateLogoRecord {
  templateId: string
  blob: Blob
}

export class SlaidsDatabase extends Dexie {
  presentations!: Table<PresentationRecord, string>
  assets!: Table<AssetRecord, string>
  templates!: Table<TemplateRecord, string>
  folders!: Table<FolderRecord, string>
  settings!: Table<SettingRecord, string>
  themeTemplates!: Table<ThemeTemplateRecord, string>
  themeTemplateLogos!: Table<ThemeTemplateLogoRecord, string>

  constructor(name = 'slaids') {
    super(name)
    this.version(1).stores({
      presentations: 'id, folderId, updatedAt, title',
      assets: 'id, presentationId',
      templates: 'id, name, createdAt',
      folders: 'id, name, createdAt',
    })
    this.version(2).stores({ settings: 'key' })
    this.version(3).stores({ themeTemplates: 'id, createdAt', themeTemplateLogos: 'templateId' })
  }
}

export const db = new SlaidsDatabase()

/**
 * Ask the browser not to evict our data. Best effort only — a local backup
 * export is still the real safety net.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export interface StorageEstimateInfo {
  usage: number
  quota: number
}

export async function estimateStorage(): Promise<StorageEstimateInfo | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}
