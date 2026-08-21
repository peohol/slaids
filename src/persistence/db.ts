/**
 * IndexedDB schema (via Dexie).
 *
 * Presentations are stored as validated JSON; binary asset data is stored
 * separately as Blobs so the presentation document stays small.
 */

import Dexie, { type Table } from 'dexie'
import type { Folder, LayoutTemplate, Presentation } from '../domain/types'

export interface PresentationRecord {
  id: string
  title: string
  folderId: string | null
  createdAt: string
  updatedAt: string
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
  blob: Blob
}

export type TemplateRecord = LayoutTemplate
export type FolderRecord = Folder

export class SlaidsDatabase extends Dexie {
  presentations!: Table<PresentationRecord, string>
  assets!: Table<AssetRecord, string>
  templates!: Table<TemplateRecord, string>
  folders!: Table<FolderRecord, string>

  constructor(name = 'slaids') {
    super(name)
    this.version(1).stores({
      presentations: 'id, folderId, updatedAt, title',
      assets: 'id, presentationId',
      templates: 'id, name, createdAt',
      folders: 'id, name, createdAt',
    })
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
