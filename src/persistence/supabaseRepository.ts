/**
 * Supabase implementation of `SlaidsRepository`.
 *
 * The remote schema deliberately mirrors the local one rather than normalising
 * it: a presentation is one row with the whole document in a `jsonb` column,
 * exactly the object the domain already knows. The indexable columns (`title`,
 * `folder_id`, `slide_count`) exist only so the library grid can be listed
 * without downloading every document.
 *
 * Two rules hold everywhere in this file:
 *
 *  - Nothing reaches the domain unvalidated. A document read back from Supabase
 *    goes through the very same migration and validation chain as one read from
 *    IndexedDB, so a stale or hand-edited row surfaces as a clear error instead
 *    of a broken editor.
 *  - `owner_id` is always taken from the authenticated session, never from the
 *    caller. RLS enforces the same thing server-side; this keeps the client from
 *    even trying to write someone else's row.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { migratePresentation } from '../domain/migrations'
import { assetRefSchema, folderSchema, validateLayoutTemplate } from '../domain/schema'
import type {
  AssetRef,
  Folder,
  LayoutTemplate,
  Presentation,
  PresentationSummary,
} from '../domain/types'
import { getSupabaseClient } from '../supabase/client'
import {
  RepositoryConflictError,
  RepositoryError,
  type SlaidsRepository,
  type StoredAsset,
} from './repository'

export const PRESENTATIONS_TABLE = 'slaids_presentations'
export const FOLDERS_TABLE = 'slaids_folders'
export const TEMPLATES_TABLE = 'slaids_templates'
export const ASSETS_TABLE = 'slaids_assets'
export const ASSETS_BUCKET = 'slaids-assets'

/** Postgres `unique_violation`, i.e. the row already exists. */
const UNIQUE_VIOLATION = '23505'

const EPOCH = new Date(0).toISOString()

interface PresentationListRow {
  id: string
  title: string
  folder_id: string | null
  slide_count: number | null
  version: number | null
  created_at: string | null
  updated_at: string | null
}

interface VersionRow {
  version: number | null
}

type FailureDetail = PostgrestError | { message: string } | null | undefined

function fail(what: string, error: FailureDetail): never {
  throw new RepositoryError(`${what} (${error?.message ?? 'ukjent feil'}).`, error)
}

/** Postgres timestamps are not ISO strings; the domain only ever stores ISO. */
function toIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export class SupabaseSlaidsRepository implements SlaidsRepository {
  /**
   * The `version` each presentation was last seen at. Every update is written
   * against that version, so a tab holding a stale copy is told it lost the
   * race instead of quietly overwriting the newer one.
   */
  private readonly versions = new Map<string, number>()

  /**
   * The client is resolved per call rather than stored, so constructing the
   * repository never requires Supabase to be configured.
   */
  constructor(private readonly resolveClient: () => SupabaseClient = getSupabaseClient) {}

  private get client(): SupabaseClient {
    return this.resolveClient()
  }

  /** Test seam: forget every cached version, as a fresh sign-in would. */
  forgetVersions(): void {
    this.versions.clear()
  }

  private async ownerId(): Promise<string> {
    const { data, error } = await this.client.auth.getSession()
    if (error) fail('Kunne ikke lese innloggingen', error)
    const id = data?.session?.user?.id
    if (!id) {
      throw new RepositoryError('Du er ikke logget inn. Logg inn på nytt for å fortsette.')
    }
    return id
  }

  /* ---------------------------------------------------------------- *
   * Presentations
   * ---------------------------------------------------------------- */

  async listPresentations(): Promise<PresentationSummary[]> {
    const { data, error } = await this.client
      .from(PRESENTATIONS_TABLE)
      .select('id, title, folder_id, slide_count, version, created_at, updated_at')
      .order('updated_at', { ascending: false })
    if (error) fail('Kunne ikke hente presentasjonene fra Supabase', error)

    return ((data ?? []) as PresentationListRow[]).map((row) => {
      if (typeof row.version === 'number') this.versions.set(row.id, row.version)
      const createdAt = toIso(row.created_at, EPOCH)
      return {
        id: row.id,
        title: row.title,
        folderId: row.folder_id ?? null,
        slideCount: numberOr(row.slide_count, 0),
        createdAt,
        updatedAt: toIso(row.updated_at, createdAt),
      }
    })
  }

  async loadPresentation(id: string): Promise<Presentation> {
    const { data, error } = await this.client
      .from(PRESENTATIONS_TABLE)
      .select('document, version')
      .eq('id', id)
      .maybeSingle()
    if (error) fail(`Kunne ikke hente presentasjonen «${id}»`, error)
    if (!data) throw new RepositoryError(`Fant ikke presentasjonen «${id}».`)

    const migrated = migratePresentation((data as { document: unknown }).document)
    if (!migrated.ok) throw new RepositoryError(migrated.error.message, migrated.error)

    const version = (data as VersionRow).version
    if (typeof version === 'number') this.versions.set(id, version)
    else this.versions.delete(id)
    return migrated.value
  }

  async savePresentation(presentation: Presentation): Promise<void> {
    const ownerId = await this.ownerId()
    // Same defensive round-trip as the Dexie repository: what goes on the wire
    // is plain JSON, never a live object with accidental extras.
    const document = JSON.parse(JSON.stringify(presentation)) as Presentation
    const row = {
      id: document.id,
      owner_id: ownerId,
      title: document.title,
      folder_id: document.folderId,
      document,
      slide_count: document.slides.length,
    }

    const known = this.versions.get(document.id)
    if (known === undefined) {
      // Never seen: this is a new presentation, and an insert is what makes
      // "new" mean new — an upsert here would overwrite a row we never read.
      const { data, error } = await this.client
        .from(PRESENTATIONS_TABLE)
        .insert({ ...row, created_at: document.createdAt, updated_at: document.updatedAt })
        .select('version')
        .single()
      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new RepositoryConflictError(
            `Presentasjonen «${document.title}» finnes allerede i Supabase. Åpne den på nytt før du lagrer.`,
            error,
          )
        }
        fail('Kunne ikke lagre presentasjonen', error)
      }
      this.versions.set(document.id, numberOr((data as VersionRow | null)?.version, 1))
      return
    }

    const { data, error } = await this.client
      .from(PRESENTATIONS_TABLE)
      .update(row)
      .eq('id', document.id)
      .eq('version', known)
      .select('version')
    if (error) fail('Kunne ikke lagre presentasjonen', error)

    const updated = (data ?? []) as VersionRow[]
    if (updated.length === 0) {
      // Nothing matched: the row is either gone or has moved on since we read
      // it. Drop the version so the next attempt has to re-read.
      this.versions.delete(document.id)
      throw new RepositoryConflictError(
        `«${document.title}» er endret et annet sted (en annen fane eller enhet). Åpne den på nytt – lagring nå ville overskrevet den nyere versjonen.`,
      )
    }
    this.versions.set(document.id, numberOr(updated[0]?.version, known + 1))
  }

  async deletePresentation(id: string): Promise<void> {
    // Files first. A failure here leaves the presentation whole and the delete
    // simply retryable, where the other order would leave objects in Storage
    // that nothing points at any more.
    await this.removeAssetObjects(await this.assetPaths(id))
    // The asset rows go with the presentation through the foreign key.
    const { error } = await this.client.from(PRESENTATIONS_TABLE).delete().eq('id', id)
    if (error) fail('Kunne ikke slette presentasjonen', error)
    this.versions.delete(id)
  }

  /* ---------------------------------------------------------------- *
   * Folders
   * ---------------------------------------------------------------- */

  async listFolders(): Promise<Folder[]> {
    const { data, error } = await this.client
      .from(FOLDERS_TABLE)
      .select('id, name, created_at')
      .order('name')
    if (error) fail('Kunne ikke hente mappene', error)

    const folders: Folder[] = []
    for (const row of (data ?? []) as { id: string; name: string; created_at: string | null }[]) {
      const candidate = { id: row.id, name: row.name, createdAt: toIso(row.created_at, EPOCH) }
      if (folderSchema.safeParse(candidate).success) folders.push(candidate)
    }
    return folders
  }

  async saveFolder(folder: Folder): Promise<void> {
    const ownerId = await this.ownerId()
    const { error } = await this.client.from(FOLDERS_TABLE).upsert({
      id: folder.id,
      owner_id: ownerId,
      name: folder.name,
      created_at: folder.createdAt,
    })
    if (error) fail('Kunne ikke lagre mappen', error)
  }

  /** Presentations in a deleted folder move back to the root rather than vanish. */
  async deleteFolder(id: string): Promise<void> {
    const { data, error } = await this.client
      .from(PRESENTATIONS_TABLE)
      .select('id, document, version')
      .eq('folder_id', id)
    if (error) fail('Kunne ikke hente presentasjonene i mappen', error)

    for (const row of (data ?? []) as { id: string; document: unknown; version: number | null }[]) {
      // The folder is named in two places — the column the library filters on
      // and the document itself — so both have to move back to the root.
      const document = { ...(row.document as Presentation), folderId: null }
      const known = numberOr(row.version, 0)
      const update = await this.client
        .from(PRESENTATIONS_TABLE)
        .update({ folder_id: null, document })
        .eq('id', row.id)
        .eq('version', known)
        .select('version')
      if (update.error) fail('Kunne ikke flytte presentasjonen ut av mappen', update.error)
      const updated = (update.data ?? []) as VersionRow[]
      if (updated.length === 0) {
        this.versions.delete(row.id)
        throw new RepositoryConflictError(
          'En presentasjon i mappen ble endret et annet sted. Last biblioteket på nytt og prøv igjen – mappen er ikke slettet.',
        )
      }
      this.versions.set(row.id, numberOr(updated[0]?.version, known + 1))
    }

    const removed = await this.client.from(FOLDERS_TABLE).delete().eq('id', id)
    if (removed.error) fail('Kunne ikke slette mappen', removed.error)
  }

  /* ---------------------------------------------------------------- *
   * Templates
   * ---------------------------------------------------------------- */

  async listTemplates(): Promise<LayoutTemplate[]> {
    const { data, error } = await this.client
      .from(TEMPLATES_TABLE)
      .select('template, created_at')
      .order('created_at')
    if (error) fail('Kunne ikke hente malene', error)

    const templates: LayoutTemplate[] = []
    for (const row of (data ?? []) as { template: unknown }[]) {
      const validated = validateLayoutTemplate(row.template)
      if (validated.ok && validated.value) templates.push(validated.value as LayoutTemplate)
    }
    return templates
  }

  async saveTemplate(template: LayoutTemplate): Promise<void> {
    if (!validateLayoutTemplate(template).ok) {
      throw new RepositoryError('Malen er ugyldig og kan ikke lagres.')
    }
    const ownerId = await this.ownerId()
    const payload = JSON.parse(JSON.stringify(template)) as LayoutTemplate
    const { error } = await this.client.from(TEMPLATES_TABLE).upsert({
      id: payload.id,
      owner_id: ownerId,
      name: payload.name,
      template: payload,
      created_at: payload.createdAt,
    })
    if (error) fail('Kunne ikke lagre malen', error)
  }

  async deleteTemplate(id: string): Promise<void> {
    const { error } = await this.client.from(TEMPLATES_TABLE).delete().eq('id', id)
    if (error) fail('Kunne ikke slette malen', error)
  }

  /* ---------------------------------------------------------------- *
   * Assets
   * ---------------------------------------------------------------- */

  /**
   * Storage paths start with the owner's UUID because that is exactly what the
   * Storage policies check. The path is derived, never taken from a caller.
   */
  private objectPath(ownerId: string, presentationId: string, assetId: string): string {
    return `${ownerId}/${presentationId}/${assetId}`
  }

  async putAsset(presentationId: string, ref: AssetRef, blob: Blob): Promise<void> {
    const ownerId = await this.ownerId()
    const objectPath = this.objectPath(ownerId, presentationId, ref.id)

    const upload = await this.client.storage.from(ASSETS_BUCKET).upload(objectPath, blob, {
      contentType: ref.mimeType || 'application/octet-stream',
      upsert: true,
    })
    if (upload.error) fail(`Kunne ikke laste opp «${ref.name}»`, upload.error)

    const { error } = await this.client.from(ASSETS_TABLE).upsert({
      id: ref.id,
      owner_id: ownerId,
      presentation_id: presentationId,
      ref: { ...ref },
      object_path: objectPath,
    })
    if (error) {
      // The file is up but nothing can reach it without its row, so take it
      // back out rather than leave it behind in the bucket.
      try {
        await this.client.storage.from(ASSETS_BUCKET).remove([objectPath])
      } catch {
        // The upload error below is the one worth reporting.
      }
      fail(`Kunne ikke lagre metadata for «${ref.name}»`, error)
    }
  }

  async getAsset(id: string): Promise<StoredAsset | null> {
    const { data, error } = await this.client
      .from(ASSETS_TABLE)
      .select('ref, object_path')
      .eq('id', id)
      .maybeSingle()
    if (error) fail('Kunne ikke hente filen', error)
    if (!data) return null

    const row = data as { ref: unknown; object_path: string }
    const parsed = assetRefSchema.safeParse(row.ref)
    if (!parsed.success) {
      throw new RepositoryError(`Metadata for filen «${id}» er ugyldig.`, parsed.error.issues)
    }

    const download = await this.client.storage.from(ASSETS_BUCKET).download(row.object_path)
    if (download.error || !download.data) {
      fail(`Kunne ikke laste ned «${parsed.data.name}»`, download.error)
    }
    return { ref: parsed.data, blob: download.data }
  }

  async listAssets(presentationId: string): Promise<AssetRef[]> {
    const { data, error } = await this.client
      .from(ASSETS_TABLE)
      .select('ref')
      .eq('presentation_id', presentationId)
    if (error) fail('Kunne ikke hente filene til presentasjonen', error)

    const refs: AssetRef[] = []
    for (const row of (data ?? []) as { ref: unknown }[]) {
      const parsed = assetRefSchema.safeParse(row.ref)
      if (parsed.success) refs.push(parsed.data)
    }
    return refs
  }

  async existingAssetIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const { data, error } = await this.client.from(ASSETS_TABLE).select('id').in('id', [...ids])
    if (error) fail('Kunne ikke sjekke hvilke filer som finnes fra før', error)
    return ((data ?? []) as { id: string }[]).map((row) => row.id)
  }

  async deleteAsset(id: string): Promise<void> {
    const { data, error } = await this.client
      .from(ASSETS_TABLE)
      .select('object_path')
      .eq('id', id)
      .maybeSingle()
    if (error) fail('Kunne ikke hente filen', error)
    if (!data) return

    await this.removeAssetObjects([(data as { object_path: string }).object_path])
    const removed = await this.client.from(ASSETS_TABLE).delete().eq('id', id)
    if (removed.error) fail('Kunne ikke slette filen', removed.error)
  }

  async deleteAssetsForPresentation(presentationId: string): Promise<void> {
    await this.removeAssetObjects(await this.assetPaths(presentationId))
    const { error } = await this.client
      .from(ASSETS_TABLE)
      .delete()
      .eq('presentation_id', presentationId)
    if (error) fail('Kunne ikke slette filene til presentasjonen', error)
  }

  /**
   * Nothing to reclaim remotely: an asset row cannot outlive its presentation
   * (the foreign key removes it), and every delete in this repository takes the
   * Storage object out *before* the row that points at it, so a half-finished
   * delete leaves a reachable row rather than an unreachable file. The sweep
   * that Dexie needs has no counterpart here.
   */
  async deleteOrphanAssets(): Promise<number> {
    return 0
  }

  private async assetPaths(presentationId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from(ASSETS_TABLE)
      .select('object_path')
      .eq('presentation_id', presentationId)
    if (error) fail('Kunne ikke hente filene til presentasjonen', error)
    return ((data ?? []) as { object_path: unknown }[])
      .map((row) => row.object_path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
  }

  private async removeAssetObjects(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return
    const { error } = await this.client.storage.from(ASSETS_BUCKET).remove([...paths])
    if (error) fail('Kunne ikke slette filene fra Supabase Storage', error)
  }
}
