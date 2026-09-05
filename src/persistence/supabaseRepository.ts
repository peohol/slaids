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
import { newShareToken } from '../domain/ids'
import { migratePresentation } from '../domain/migrations'
import { presentationRevision } from '../domain/revision'
import { assetRefSchema, folderSchema, validateLayoutTemplate } from '../domain/schema'
import { buildSharedSnapshot, type SharedPresentationSnapshot } from '../domain/sharing'
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
  RepositoryNotFoundError,
  type SaveGuard,
  type ShareState,
  type SharingRepository,
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

/** How much of one Storage prefix a single `list` call is asked for. */
const STORAGE_LIST_LIMIT = 1000

/** How many ids one `in` filter carries; the filter travels in the URL. */
const ID_FILTER_BATCH = 200

/**
 * How many times a single presentation may lose the race out of a folder that is
 * being deleted before the deletion gives up on it.
 *
 * More than one, because one concurrent autosave tick is ordinary and should not
 * strand half an emptied folder. Not unbounded, because a row written in a loop
 * would keep a delete running forever.
 */
const FOLDER_MOVE_ATTEMPTS = 4

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

/** A presentation seen from the folder it sits in: enough to move it out of one. */
interface FolderMemberRow {
  id: string
  document: unknown
  version: number | null
}

interface SharedFlagRow {
  is_shared: boolean | null
}

interface ShareRow extends SharedFlagRow {
  share_token: string | null
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

/**
 * How many distinct readings to remember at once.
 *
 * A guarded save follows its own read immediately, so one entry is normally
 * created and consumed in the same operation. The cap only exists so a
 * long-lived repository cannot accumulate readings forever, and evicting the
 * least recently used one costs at worst a conflict — never an overwrite.
 */
const MAX_REMEMBERED_READINGS = 64

function readingKey(id: string, revision: string): string {
  return `${id}@${revision}`
}

export class SupabaseSlaidsRepository implements SlaidsRepository, SharingRepository {
  /**
   * The `version` each presentation was last seen at. Every update is written
   * against that version, so a tab holding a stale copy is told it lost the
   * race instead of quietly overwriting the newer one.
   *
   * Having an entry at all is the other half of the state: it says the row
   * exists, and therefore that this presentation is saved with an UPDATE rather
   * than an INSERT. That is why a conflict never removes one. "Nothing known"
   * means "new", so forgetting a row after a lost race would turn the next
   * autosave retry into an INSERT — and resurrect a presentation another tab
   * had just deleted, references to assets that went with it and all. A stale
   * entry keeps failing the guard instead, which stays true until the document
   * is read again.
   *
   * Only two things add an entry: reading the row, or an insert that created
   * it. Only one removes it: deleting the presentation through this repository,
   * which is a local decision rather than a surprise from somewhere else.
   */
  private readonly knownVersions = new Map<string, number>()
  /** `"<id>@<revisjon>"` → the version that reading came from. */
  private readonly versionOfReading = new Map<string, number>()

  /**
   * Whether each presentation was shared the last time this repository looked.
   *
   * It decides one thing only: whether a save carries a freshly built public
   * snapshot along with the private document. Being wrong is not dangerous in
   * either direction — the database refuses to keep a snapshot on a row that is
   * not shared, and a save that finds the row shared after all publishes the
   * snapshot it should have carried. See `savePresentation`.
   */
  private readonly knownShared = new Map<string, boolean>()

  /**
   * Storage paths whose removal failed after their row was already gone.
   * Nothing points at them any more, so they are retried in the background
   * rather than surfaced as an error on a delete that did succeed.
   */
  private readonly pendingObjectRemovals = new Set<string>()

  /** The full sweep costs two requests; once per sign-in is enough. */
  private sweptStorage = false

  /**
   * The client is resolved per call rather than stored, so constructing the
   * repository never requires Supabase to be configured.
   *
   * `pinnedOwnerId` is for a caller that has no browser session to ask — the
   * agent REST layer, which authenticates with an agent token and learns the
   * owner from the token's own row. It changes two things, and both matter:
   *
   *  - `owner_id` on a write comes from the pin instead of from
   *    `auth.getSession()`. The invariant is unchanged: the owner still comes
   *    from the authenticated principal, never from a caller's payload.
   *  - every query is filtered on that owner. A server-side client holds a
   *    secret key, which bypasses row level security, so the filter RLS would
   *    have applied has to be written down instead of assumed. In the browser
   *    there is no pin, no filter is added, and RLS is still the only thing
   *    deciding — exactly as before.
   */
  constructor(
    private readonly resolveClient: () => SupabaseClient = getSupabaseClient,
    private readonly pinnedOwnerId?: string,
  ) {}

  private get client(): SupabaseClient {
    return this.resolveClient()
  }

  /**
   * Narrow a query to the pinned owner, or leave it alone.
   *
   * Unconstrained on purpose. Writing the constraint out — "something with an
   * `eq` that returns itself" — makes the compiler expand PostgREST's whole
   * recursive builder generic at every call site, which it refuses to do for
   * the wider selects. What is left is one narrow cast in one place, and every
   * filter builder does return itself.
   */
  private scoped<Q>(query: Q): Q {
    if (!this.pinnedOwnerId) return query
    const filterable = query as { eq(column: string, value: string): Q }
    return filterable.eq('owner_id', this.pinnedOwnerId)
  }

  /**
   * Store a row this repository owns — and never one somebody else owns.
   *
   * The obvious spelling is an upsert, and it is the wrong one. `INSERT … ON
   * CONFLICT DO UPDATE` conflicts on the primary key alone, so an id that
   * already belongs to another owner is not a collision it refuses but a row it
   * takes over: `owner_id` is among the columns written, so the row simply
   * becomes ours. In the browser row level security stops that; with a server
   * key there is no row level security left to stop it, and "asset ids are
   * random enough" is not a security property.
   *
   * So: insert, and only if the id turns out to be taken, update it *as its
   * owner*. The two outcomes are exactly the ones a caller needs to tell apart —
   * the row was ours and is now saved, or the row is not ours and nothing
   * happened — and the second is a `RepositoryConflictError`, the same answer a
   * lost race gets, because the caller's move is the same: use a different id.
   *
   * Insert first rather than update first because the common case is a new row;
   * `saveTemplate` orders it the other way for the same reason in reverse, and
   * both reach the same place.
   */
  private async saveOwnedRow(
    table: string,
    id: string,
    row: Record<string, unknown>,
    what: string,
  ): Promise<void> {
    const inserted = await this.client.from(table).insert(row)
    if (!inserted.error) return
    if (inserted.error.code !== UNIQUE_VIOLATION) fail(what, inserted.error)

    // The id is taken. Whether it is *ours* is what the owner filter answers —
    // and in the browser, where there is no filter to add, row level security
    // answers the same question the same way.
    const updated = await this.scoped(
      this.client.from(table).update(row).eq('id', id),
    ).select('id')
    if (updated.error) fail(what, updated.error)
    if (((updated.data ?? []) as unknown[]).length > 0) return

    throw new RepositoryConflictError(
      `${what}: id-en «${id}» er allerede i bruk av en rad denne økten ikke eier. Bruk en annen id.`,
    )
  }

  /** Test seam: forget every known row, as a fresh sign-in would. */
  forgetVersions(): void {
    this.knownVersions.clear()
    this.knownShared.clear()
    this.versionOfReading.clear()
  }

  /**
   * Which database version a particular *reading* came from.
   *
   * `knownVersions` cannot answer that. It holds one number per row and moves
   * forward on every write, which is right for the editor — it owns the
   * document it is editing and always saves the newest thing it has — and
   * exactly wrong for a guarded save: two operations can read version 1, the
   * first can save and leave the map at 2, and the second would then guard its
   * version-1 document with version 2 and overwrite the first. The guard has to
   * be bound to the read it belongs to, not to whatever the row has reached
   * since, so it is keyed by the content that read returned.
   */
  private rememberReading(id: string, revision: string, version: number): void {
    const key = readingKey(id, revision)
    // Re-inserting moves the entry to the end, so the eviction below drops what
    // has actually gone longest without being read.
    this.versionOfReading.delete(key)
    this.versionOfReading.set(key, version)
    while (this.versionOfReading.size > MAX_REMEMBERED_READINGS) {
      const oldest = this.versionOfReading.keys().next().value
      if (oldest === undefined) break
      this.versionOfReading.delete(oldest)
    }
  }

  private async ownerId(): Promise<string> {
    if (this.pinnedOwnerId) return this.pinnedOwnerId
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
    const { data, error } = await this.scoped(
      this.client
        .from(PRESENTATIONS_TABLE)
        .select('id, title, folder_id, slide_count, version, created_at, updated_at'),
    ).order('updated_at', { ascending: false })
    if (error) fail('Kunne ikke hente presentasjonene fra Supabase', error)

    return ((data ?? []) as PresentationListRow[]).map((row) => {
      // A listing establishes that a row exists, which is enough to save it
      // with an update. It does not refresh a version a read gave us, though:
      // that would hand a stale editor a fresh guard to overwrite with.
      if (typeof row.version === 'number' && !this.knownVersions.has(row.id)) {
        this.knownVersions.set(row.id, row.version)
      }
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
    const { data, error } = await this.scoped(
      this.client
        .from(PRESENTATIONS_TABLE)
        // `is_shared` comes along so a save knows whether it also has to publish,
        // without a second round trip and without depending on the share UI
        // having asked first.
        .select('document, version, is_shared')
        .eq('id', id),
    ).maybeSingle()
    if (error) fail(`Kunne ikke hente presentasjonen «${id}»`, error)
    if (!data) throw new RepositoryNotFoundError(`Fant ikke presentasjonen «${id}».`)

    const migrated = migratePresentation((data as { document: unknown }).document)
    if (!migrated.ok) throw new RepositoryError(migrated.error.message, migrated.error)

    // The row came back, so it exists. `0` never matches one (`version >= 1`),
    // so a row whose version we could not read fails the guard rather than
    // being inserted as if it were new.
    const version = numberOr((data as VersionRow).version, 0)
    this.knownVersions.set(id, version)
    this.knownShared.set(id, (data as SharedFlagRow).is_shared === true)
    // Keyed by the document actually handed to the caller, so a guarded save of
    // *this* reading can find the version it belongs to no matter what the row
    // has moved on to since.
    this.rememberReading(id, presentationRevision(migrated.value), version)
    return migrated.value
  }

  /**
   * Store the document, guarded by a version the database compares atomically.
   *
   * Which version depends on who is asking, and the difference matters:
   *
   *  - **Without a `guard`** — the editor's autosave — the version is the last
   *    one this repository saw for the row. That is the right answer for a
   *    caller that owns the document and saves it over and over: each save
   *    builds on the one before it.
   *  - **With a `guard`** the version is the one the *named reading* came from,
   *    looked up by that reading's revision. Reading it from `knownVersions`
   *    instead would be a lost update waiting to happen: two operations read
   *    version 1, the first saves and leaves the map at 2, and the second would
   *    then guard its version-1 document with version 2 — matching the row the
   *    first one just wrote, and overwriting it. A guard that a later write can
   *    refresh is not a guard.
   *
   * Either way the condition is `.eq('version', …)` inside the UPDATE, so the
   * comparison and the write are one atomic statement in the database. Nothing
   * here reads the row first and writes it after.
   */
  async savePresentation(presentation: Presentation, guard?: SaveGuard): Promise<void> {
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

    // A guarded save is pinned to its own reading and never falls back to the
    // shared map. An unknown revision means this repository cannot prove which
    // version the caller read, and refusing is the only safe answer left —
    // guessing a version is how the overwrite this guard exists to stop happens.
    if (guard) {
      const version = this.versionOfReading.get(readingKey(document.id, guard.expectedRevision))
      if (version === undefined) {
        throw new RepositoryConflictError(
          `«${document.title}» ble ikke lest av denne økten, eller lesingen er for gammel til å skrives mot. Les den på nytt før du lagrer.`,
        )
      }
      await this.updateGuarded(document, row, version)
      return
    }

    const known = this.knownVersions.get(document.id)
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
      this.knownVersions.set(document.id, numberOr((data as VersionRow | null)?.version, 1))
      // A presentation that has just been created is not shared. Sharing is
      // never inherited — not by a copy, not by an import, not by a new row.
      this.knownShared.set(document.id, false)
      return
    }

    await this.updateGuarded(document, row, known)
  }

  /**
   * The one conditional write, shared by both save paths.
   *
   * `expectedVersion` is the whole guard: the statement below only touches a
   * row that still has it, so a concurrent writer cannot be overwritten — it
   * either got there first, in which case nothing matches and this is a
   * conflict, or it has not written yet, in which case it will meet the same
   * condition and lose.
   */
  private async updateGuarded(
    document: Presentation,
    row: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<void> {
    // A shared presentation is published by the same write that stores it, so a
    // save that succeeded can never leave the audience on an older version than
    // the owner just wrote. When the row turns out not to be shared, the
    // database drops the snapshot again (see the migration's trigger), so
    // sending one on a stale reading publishes nothing.
    const believedShared = this.knownShared.get(document.id) === true
    const payload = believedShared
      ? { ...row, shared_document: buildSharedSnapshot(document) }
      : row

    const { data, error } = await this.scoped(
      this.client.from(PRESENTATIONS_TABLE).update(payload).eq('id', document.id),
    )
      .eq('version', expectedVersion)
      .select('version, is_shared')
    if (error) fail('Kunne ikke lagre presentasjonen', error)

    const updated = (data ?? []) as (VersionRow & SharedFlagRow)[]
    if (updated.length === 0) {
      // Nothing matched: the row has either moved on since we read it or is
      // gone. The version stays exactly as it was — every retry keeps making
      // the same guarded update and keeps failing, until the document is read
      // again. Forgetting it here is what would turn the next attempt into an
      // insert, and an insert of a row somebody deleted is not a save but a
      // resurrection.
      throw new RepositoryConflictError(
        `«${document.title}» er endret eller slettet et annet sted (en annen fane eller enhet). Åpne den på nytt – lagring nå ville overskrevet den nyere versjonen eller gjenopprettet en slettet presentasjon.`,
      )
    }
    const version = numberOr(updated[0]?.version, expectedVersion + 1)
    this.knownVersions.set(document.id, version)

    // The row itself has the last word on whether it is shared.
    const actuallyShared = updated[0]?.is_shared === true
    this.knownShared.set(document.id, actuallyShared)
    if (actuallyShared && !believedShared) {
      // Sharing was switched on elsewhere while this editor was open, so the
      // write that just landed carried no snapshot and the audience would be
      // looking at the version published at the time. Publish the one it should
      // have carried, against the version it belongs to; a share-only update
      // does not move the document version, so this cannot turn into a conflict
      // for the next autosave.
      await this.publishSnapshot(document.id, buildSharedSnapshot(document), version)
    }
  }

  /**
   * Delete the row, then reclaim the objects it pointed at.
   *
   * The row carries more than the document: the asset rows hang off it through
   * a foreign key, and `is_shared`, `share_token` and `shared_document` are
   * columns on it. So one `DELETE` takes the presentation, its file list and its
   * published copy at once — a shared deck stops being reachable through the
   * public function in the same statement, with no separate revocation to
   * forget.
   *
   * The row goes first and the stored bytes after it. Removing the files first
   * would, if the row delete then failed, leave a presentation that is still
   * listed and still opens — with its pictures permanently gone. Losing data
   * something still points at is worse than leaving data nothing points at, and
   * the latter is what `deleteOrphanAssets` reclaims.
   */
  async deletePresentation(id: string, guard?: SaveGuard): Promise<void> {
    const paths = await this.assetPaths(id)
    // The asset rows go with the presentation through the foreign key.
    if (guard) {
      await this.deleteGuarded(id, guard)
    } else {
      const { error } = await this.scoped(
        this.client.from(PRESENTATIONS_TABLE).delete().eq('id', id),
      )
      if (error) fail('Kunne ikke slette presentasjonen', error)
    }
    // Deleting through this repository is a local decision, so this is the one
    // place the row may be forgotten: a later save of the same id really is new.
    this.knownVersions.delete(id)
    this.knownShared.delete(id)
    await this.reclaimObjects(paths)
  }

  /**
   * The conditional delete, which is `updateGuarded` with nothing left to write.
   *
   * The version comes from the *named reading* rather than from
   * `knownVersions`, for the reason spelled out there: a number a later write
   * can refresh is not a guard. An unknown revision is refused outright — this
   * session cannot prove which version the caller read, and guessing one on a
   * delete is the one guess with no way back.
   *
   * Nothing matching means the row moved on or is already gone. Both are a
   * conflict here rather than a silent success, because the caller named a
   * reading: it is asking to delete *that* document, and this is no longer it.
   * An unguarded delete of an absent row still succeeds, as it always did.
   */
  private async deleteGuarded(id: string, guard: SaveGuard): Promise<void> {
    const version = this.versionOfReading.get(readingKey(id, guard.expectedRevision))
    if (version === undefined) {
      throw new RepositoryConflictError(
        `Presentasjonen «${id}» ble ikke lest av denne økten, eller lesingen er for gammel til å slettes mot. Les den på nytt før du sletter den.`,
      )
    }
    const { data, error } = await this.scoped(
      this.client.from(PRESENTATIONS_TABLE).delete().eq('id', id),
    )
      .eq('version', version)
      .select('id')
    if (error) fail('Kunne ikke slette presentasjonen', error)
    if (((data ?? []) as unknown[]).length === 0) {
      throw new RepositoryConflictError(
        `Presentasjonen «${id}» er endret eller slettet et annet sted siden den ble lest. Les den på nytt før du sletter den.`,
      )
    }
  }

  /* ---------------------------------------------------------------- *
   * Sharing
   *
   * Every write here touches share columns only. The trigger installed by the
   * sharing migration leaves `version` and `updated_at` alone for exactly those
   * writes, so publishing or revoking never makes an open editor's known
   * version stale — and therefore never turns the next autosave into a false
   * "changed somewhere else" conflict.
   *
   * Publishing still *reads* the version, though, for the opposite reason. A
   * snapshot is a picture of one particular version of the document, so it may
   * only be written while that is still the version stored. Revoking is not
   * like that and is deliberately unguarded: taking a link out of circulation
   * must work whatever the document has been doing.
   * ---------------------------------------------------------------- */

  async readShareState(presentationId: string): Promise<ShareState> {
    const { data, error } = await this.scoped(
      this.client
        .from(PRESENTATIONS_TABLE)
        .select('is_shared, share_token')
        .eq('id', presentationId),
    ).maybeSingle()
    if (error) fail('Kunne ikke lese delingsstatusen', error)
    if (!data) throw new RepositoryNotFoundError(`Fant ikke presentasjonen «${presentationId}».`)
    return this.rememberShareState(presentationId, data as ShareRow)
  }

  async enableSharing(
    presentationId: string,
    snapshot: SharedPresentationSnapshot,
  ): Promise<ShareState> {
    // A new token on every activation, so a link that was revoked earlier stays
    // revoked forever rather than coming back to life on the next share.
    const token = newShareToken()
    // The snapshot pictures the version this repository last saw. Publishing it
    // over a document another tab has moved on from would hand the audience a
    // deck the owner has already replaced — and, because the row would then be
    // shared with a snapshot nobody is about to rewrite, leave it that way until
    // somebody happens to save again. Guarded, that race turns into a conflict
    // the user can answer instead.
    const known = this.knownVersions.get(presentationId)
    const guarded = this.scoped(
      this.client
        .from(PRESENTATIONS_TABLE)
        .update({ is_shared: true, share_token: token, shared_document: snapshot })
        .eq('id', presentationId),
    )
    const { data, error } = await (known === undefined
      ? guarded
      : guarded.eq('version', known)
    ).select('is_shared, share_token')
    if (error) fail('Kunne ikke dele presentasjonen', error)

    const rows = (data ?? []) as ShareRow[]
    if (rows.length === 0) throw await this.explainMissedShareWrite(presentationId)
    return this.rememberShareState(presentationId, rows[0])
  }

  /**
   * Why a guarded share write matched nothing: the row is gone, or it has moved
   * on since we read it. One extra request, only on the failure path, so the
   * message the user gets is true rather than a guess.
   */
  private async explainMissedShareWrite(presentationId: string): Promise<RepositoryError> {
    const { data } = await this.scoped(
      this.client.from(PRESENTATIONS_TABLE).select('id').eq('id', presentationId),
    ).maybeSingle()
    if (!data) {
      return new RepositoryError(
        'Fant ikke presentasjonen i Supabase. Den kan være slettet et annet sted.',
      )
    }
    return new RepositoryConflictError(
      'Presentasjonen ble endret et annet sted (en annen fane eller enhet) mens den skulle deles. ' +
        'Åpne den på nytt og prøv igjen – ellers ville lenken vist en eldre versjon enn den som er lagret.',
    )
  }

  async disableSharing(presentationId: string): Promise<ShareState> {
    // Rotated on the way out too: from here the address that was in circulation
    // is dead, whatever happens next.
    const token = newShareToken()
    const { data, error } = await this.scoped(
      this.client
        .from(PRESENTATIONS_TABLE)
        .update({ is_shared: false, share_token: token, shared_document: null })
        .eq('id', presentationId),
    ).select('is_shared, share_token')
    if (error) fail('Kunne ikke slå av delingen', error)

    const rows = (data ?? []) as ShareRow[]
    if (rows.length === 0) {
      throw new RepositoryError(
        'Fant ikke presentasjonen i Supabase. Den kan være slettet et annet sted.',
      )
    }
    return this.rememberShareState(presentationId, rows[0])
  }

  /** A token is only ever handed out while the share it belongs to is live. */
  private rememberShareState(presentationId: string, row: ShareRow): ShareState {
    const shared = row.is_shared === true
    this.knownShared.set(presentationId, shared)
    return { shared, token: shared ? (row.share_token ?? null) : null }
  }

  /**
   * Refresh the published copy without touching the private document.
   *
   * Guarded on the version the snapshot pictures, and on the row still being
   * shared: publishing to an unshared row would violate the state invariant,
   * and publishing over a newer document would put the audience behind. A guard
   * that matches nothing is not an error here — it means somebody else's write
   * got there first, and that write brings its own snapshot along.
   */
  private async publishSnapshot(
    presentationId: string,
    snapshot: SharedPresentationSnapshot,
    version: number,
  ): Promise<void> {
    const { error } = await this.scoped(
      this.client
        .from(PRESENTATIONS_TABLE)
        .update({ shared_document: snapshot })
        .eq('id', presentationId),
    )
      .eq('version', version)
      .eq('is_shared', true)
    if (error) fail('Kunne ikke oppdatere den delte kopien', error)
  }

  /* ---------------------------------------------------------------- *
   * Folders
   * ---------------------------------------------------------------- */

  async listFolders(): Promise<Folder[]> {
    const { data, error } = await this.scoped(
      this.client.from(FOLDERS_TABLE).select('id, name, created_at'),
    ).order('name')
    if (error) fail('Kunne ikke hente mappene', error)

    const folders: Folder[] = []
    for (const row of (data ?? []) as { id: string; name: string; created_at: string | null }[]) {
      const candidate = { id: row.id, name: row.name, createdAt: toIso(row.created_at, EPOCH) }
      if (folderSchema.safeParse(candidate).success) folders.push(candidate)
    }
    return folders
  }

  async saveFolder(folder: Folder): Promise<void> {
    await this.saveOwnedRow(
      FOLDERS_TABLE,
      folder.id,
      {
        id: folder.id,
        owner_id: await this.ownerId(),
        name: folder.name,
        created_at: folder.createdAt,
      },
      'Kunne ikke lagre mappen',
    )
  }

  /**
   * The folder goes; the presentations in it stay, at the root.
   *
   * The contract is on `SlaidsRepository.deleteFolder`, and here is what it
   * costs to keep in a store with no transaction: the presentations are moved
   * out *first*, one guarded write each, and only then is the folder row
   * removed. That order is the whole safety property. Removing the folder first
   * would leave the database's own `on delete set null` to clear the `folder_id`
   * column while the `folderId` *inside* each document still named a folder that
   * is gone — a deck shown neither at the root nor in any folder, and one whose
   * next save would be refused by the foreign key.
   *
   * Each move is guarded on the version it read, because it writes the whole
   * document back and an unguarded write would revert an edit somebody made in
   * between. Losing that guard is not a reason to abandon the deletion, though:
   * that is what read-modify-write means, and stopping half-way would leave some
   * decks at the root with the folder still standing — the exact half-done state
   * Dexie's single transaction never produces. So a lost race is re-read and
   * retried against what is there now, which is the same folder strip applied to
   * a newer document.
   *
   * The retry is bounded rather than unbounded: a row that loses this many times
   * in a row is being written continuously, and looping forever inside a delete
   * is worse than saying so.
   */
  async deleteFolder(id: string): Promise<void> {
    for (const row of await this.presentationsInFolder(id)) await this.moveOutOfFolder(row, id)

    const removed = await this.scoped(this.client.from(FOLDERS_TABLE).delete().eq('id', id))
    if (removed.error) fail('Kunne ikke slette mappen', removed.error)
  }

  /** The rows a folder holds, with everything a move out of it needs. */
  private async presentationsInFolder(id: string): Promise<FolderMemberRow[]> {
    const { data, error } = await this.scoped(
      this.client.from(PRESENTATIONS_TABLE).select('id, document, version').eq('folder_id', id),
    )
    if (error) fail('Kunne ikke hente presentasjonene i mappen', error)
    return (data ?? []) as FolderMemberRow[]
  }

  /**
   * Put one presentation back at the root, retrying against a newer reading.
   *
   * The folder is named in two places — the column the library filters on and
   * the document itself — so both are cleared by the same write.
   */
  private async moveOutOfFolder(first: FolderMemberRow, folderId: string): Promise<void> {
    // Two ways out, and only one of them is a failure. `row` goes empty when
    // somebody else moves the presentation out of the folder, or deletes it
    // outright, while we are working — and that is not a failure: the state this
    // asked for is the state it found. Running out of attempts is.
    //
    // The emptiness is therefore part of the loop *condition* rather than a
    // check at the top of the body. The re-read that can empty it is the last
    // statement in the body, so a body check would miss the final attempt's
    // re-read entirely and report a conflict for a folder that is already empty
    // — refusing a deletion whose work is done.
    let row: FolderMemberRow | null = first

    for (let attempt = 0; attempt < FOLDER_MOVE_ATTEMPTS && row; attempt += 1) {
      const document = { ...(row.document as Presentation), folderId: null }
      const known = numberOr(row.version, 0)
      const update = await this.scoped(
        this.client
          .from(PRESENTATIONS_TABLE)
          .update({ folder_id: null, document })
          .eq('id', row.id),
      )
        .eq('version', known)
        .select('version')
      if (update.error) fail('Kunne ikke flytte presentasjonen ut av mappen', update.error)

      const updated = (update.data ?? []) as VersionRow[]
      if (updated.length > 0) {
        this.knownVersions.set(row.id, numberOr(updated[0]?.version, known + 1))
        return
      }

      // Lost the race. Never keep the reading that lost — that is how a guard
      // becomes a licence to overwrite whoever won.
      row = await this.folderMember(row.id, folderId)
    }

    // Still in the folder after every attempt: it is being written continuously,
    // and looping forever inside a delete is worse than saying so.
    if (row) {
      throw new RepositoryConflictError(
        'En presentasjon i mappen blir endret et annet sted akkurat nå. Last biblioteket på nytt og prøv igjen – mappen er ikke slettet.',
      )
    }
  }

  /** One row, re-read, and only while it is still in the folder being deleted. */
  private async folderMember(id: string, folderId: string): Promise<FolderMemberRow | null> {
    const { data, error } = await this.scoped(
      this.client.from(PRESENTATIONS_TABLE).select('id, document, version').eq('id', id),
    )
      .eq('folder_id', folderId)
      .maybeSingle()
    if (error) fail('Kunne ikke hente presentasjonen i mappen', error)
    return (data as FolderMemberRow | null) ?? null
  }

  /* ---------------------------------------------------------------- *
   * Templates
   * ---------------------------------------------------------------- */

  async listTemplates(): Promise<LayoutTemplate[]> {
    const { data, error } = await this.scoped(
      this.client.from(TEMPLATES_TABLE).select('template, created_at'),
    ).order('created_at')
    if (error) fail('Kunne ikke hente malene', error)

    const templates: LayoutTemplate[] = []
    for (const row of (data ?? []) as { template: unknown }[]) {
      const validated = validateLayoutTemplate(row.template)
      if (validated.ok && validated.value) templates.push(validated.value as LayoutTemplate)
    }
    return templates
  }

  async saveTemplate(template: LayoutTemplate): Promise<void> {
    const validation = validateLayoutTemplate(template)
    if (!validation.ok || !validation.value) {
      throw new RepositoryError('Malen er ugyldig og kan ikke lagres.')
    }
    const ownerId = await this.ownerId()
    // The validated value, not the argument: validating a template also brings
    // its ratios up to the whole-number rule, and storing the argument would
    // put the old numbers back.
    const payload = JSON.parse(JSON.stringify(validation.value)) as LayoutTemplate
    const row = {
      id: payload.id,
      owner_id: ownerId,
      name: payload.name,
      template: payload,
    }

    // Update first, then insert — never a blind upsert. Template ids are unique
    // across every account while RLS shows a user only their own rows, so an
    // upsert on an id that belongs to somebody else would try to write over a
    // row this user cannot see. Updating first keeps that impossible: an id
    // that is ours matches and updates, and one that is not falls through to
    // an insert whose unique violation is a conflict the caller can answer.
    const updated = await this.scoped(
      this.client.from(TEMPLATES_TABLE).update(row).eq('id', payload.id),
    ).select('id')
    if (updated.error) fail('Kunne ikke lagre malen', updated.error)
    if (((updated.data ?? []) as unknown[]).length > 0) return

    const { error } = await this.client
      .from(TEMPLATES_TABLE)
      .insert({ ...row, created_at: payload.createdAt })
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new RepositoryConflictError(
          `Malen «${payload.name}» har en id som allerede er i bruk.`,
          error,
        )
      }
      fail('Kunne ikke lagre malen', error)
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    const { error } = await this.scoped(
      this.client.from(TEMPLATES_TABLE).delete().eq('id', id),
    )
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

    try {
      await this.saveOwnedRow(
        ASSETS_TABLE,
        ref.id,
        {
          id: ref.id,
          owner_id: ownerId,
          presentation_id: presentationId,
          ref: { ...ref },
          object_path: objectPath,
        },
        `Kunne ikke lagre metadata for «${ref.name}»`,
      )
    } catch (error) {
      // The file is up but nothing can reach it without its row, so take it
      // back out rather than leave it behind in the bucket. That includes the
      // case where the id belongs to somebody else: the object we just wrote
      // sits under *our* owner prefix and is now unreferenced, while their row
      // and their file are untouched.
      await this.reclaimObjects([objectPath])
      throw error
    }
    // This path is referenced again. A failed removal from an earlier attempt
    // must not have it swept out from under the row that now points at it.
    this.pendingObjectRemovals.delete(objectPath)
  }

  async getAsset(id: string): Promise<StoredAsset | null> {
    const { data, error } = await this.scoped(
      this.client.from(ASSETS_TABLE).select('ref, object_path').eq('id', id),
    ).maybeSingle()
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
    const { data, error } = await this.scoped(
      this.client.from(ASSETS_TABLE).select('ref').eq('presentation_id', presentationId),
    )
    if (error) fail('Kunne ikke hente filene til presentasjonen', error)

    const refs: AssetRef[] = []
    for (const row of (data ?? []) as { ref: unknown }[]) {
      const parsed = assetRefSchema.safeParse(row.ref)
      if (parsed.success) refs.push(parsed.data)
    }
    return refs
  }

  /**
   * Which of these ids this owner already has a file under.
   *
   * Scoped, like everything else. It is tempting to leave it open — "does this
   * id name *any* stored file" is the question that would let an importer step
   * around a collision it cannot see — but that reading was never true: in the
   * browser row level security has always narrowed this to the owner's own
   * rows, so an unscoped query only reaches further when a server key is
   * holding it, which is precisely when it must not.
   *
   * Nothing is lost by narrowing it, because the safety never rested here. A
   * foreign id that looks free is caught by the write instead: `saveOwnedRow`
   * refuses it with a conflict rather than taking the row over, which is the
   * same shape `savePresentation` already relies on and the importer already
   * knows how to answer.
   */
  async existingAssetIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const { data, error } = await this.scoped(
      this.client.from(ASSETS_TABLE).select('id'),
    ).in('id', [...ids])
    if (error) fail('Kunne ikke sjekke hvilke filer som finnes fra før', error)
    return ((data ?? []) as { id: string }[]).map((row) => row.id)
  }

  async deleteAsset(id: string): Promise<boolean> {
    const { data, error } = await this.scoped(
      this.client.from(ASSETS_TABLE).select('object_path').eq('id', id),
    ).maybeSingle()
    if (error) fail('Kunne ikke hente filen', error)
    // No row means nothing points at any bytes here, so there is nothing left
    // to remove — which is the state the caller asked for.
    if (!data) return true

    const removed = await this.scoped(this.client.from(ASSETS_TABLE).delete().eq('id', id))
    if (removed.error) fail('Kunne ikke slette filen', removed.error)
    // The reclaim's own answer, passed on rather than swallowed. This is the
    // one caller that reports the outcome to somebody — see the interface.
    return this.reclaimObjects([(data as { object_path: string }).object_path])
  }

  async deleteAssetsForPresentation(presentationId: string): Promise<void> {
    const paths = await this.assetPaths(presentationId)
    const { error } = await this.scoped(
      this.client.from(ASSETS_TABLE).delete().eq('presentation_id', presentationId),
    )
    if (error) fail('Kunne ikke slette filene til presentasjonen', error)
    await this.reclaimObjects(paths)
  }

  /**
   * Reclaim Storage objects nothing points at any more.
   *
   * Rows cannot be orphaned — an asset row goes with its presentation through
   * the foreign key — but objects can, precisely because every delete here
   * takes the row out first. That is the safe direction: what is left behind is
   * a file nothing references, not a reference to a file that is gone.
   *
   * Two passes, both cheap. The paths whose removal failed in this session are
   * retried at no cost when there are none, and once per sign-in the
   * presentation folders in the bucket are compared against the presentations
   * that still exist — two requests when there is nothing to reclaim.
   *
   * Reclaiming is best effort by definition: it never fails a user action, and
   * whatever it does not manage this time it can do next time.
   */
  async deleteOrphanAssets(): Promise<number> {
    try {
      let removed = await this.retryPendingRemovals()
      if (!this.sweptStorage) {
        this.sweptStorage = true
        removed += await this.sweepOrphanedFolders()
      }
      return removed
    } catch {
      return 0
    }
  }

  private async retryPendingRemovals(): Promise<number> {
    if (this.pendingObjectRemovals.size === 0) return 0
    const paths = [...this.pendingObjectRemovals]
    const { error } = await this.client.storage.from(ASSETS_BUCKET).remove(paths)
    if (error) return 0
    for (const path of paths) this.pendingObjectRemovals.delete(path)
    return paths.length
  }

  /**
   * Every folder directly under the owner's prefix is one presentation. A
   * folder whose presentation is gone is orphaned in full, which is exactly
   * what an interrupted delete leaves behind.
   */
  private async sweepOrphanedFolders(): Promise<number> {
    const ownerId = await this.ownerId()
    const listed = await this.client.storage
      .from(ASSETS_BUCKET)
      .list(ownerId, { limit: STORAGE_LIST_LIMIT })
    if (listed.error || !listed.data) return 0
    // An entry without an id is a prefix rather than a file.
    const folders = listed.data
      .filter((entry) => !entry.id && typeof entry.name === 'string' && entry.name.length > 0)
      .map((entry) => entry.name)
    if (folders.length === 0) return 0

    // A `?in=(...)` filter goes in the URL, so long lists are asked for in
    // batches rather than in one request no proxy will accept.
    const alive = new Set<string>()
    for (let index = 0; index < folders.length; index += ID_FILTER_BATCH) {
      const batch = folders.slice(index, index + ID_FILTER_BATCH)
      const { data, error } = await this.scoped(
        this.client.from(PRESENTATIONS_TABLE).select('id'),
      ).in('id', batch)
      if (error) return 0
      for (const row of (data ?? []) as { id: string }[]) alive.add(row.id)
    }

    let removed = 0
    for (const folder of folders) {
      if (alive.has(folder)) continue
      const contents = await this.client.storage
        .from(ASSETS_BUCKET)
        .list(`${ownerId}/${folder}`, { limit: STORAGE_LIST_LIMIT })
      if (contents.error || !contents.data) continue
      const paths = contents.data
        .filter((entry) => entry.id)
        .map((entry) => `${ownerId}/${folder}/${entry.name}`)
      if (paths.length === 0) continue
      const { error: removeError } = await this.client.storage
        .from(ASSETS_BUCKET)
        .remove(paths)
      if (!removeError) removed += paths.length
    }
    return removed
  }

  private async assetPaths(presentationId: string): Promise<string[]> {
    const { data, error } = await this.scoped(
      this.client.from(ASSETS_TABLE).select('object_path').eq('presentation_id', presentationId),
    )
    if (error) fail('Kunne ikke hente filene til presentasjonen', error)
    return ((data ?? []) as { object_path: unknown }[])
      .map((row) => row.object_path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
  }

  /**
   * Take objects out of Storage once nothing points at them.
   *
   * A failure here never fails the caller's action — what it asked for has
   * already happened, and the row is gone — so the paths are remembered for
   * `deleteOrphanAssets` instead of turning a delete that succeeded into an
   * error the user cannot act on.
   *
   * It is *reported*, though, which is a different thing from failing on it.
   * `deleteAsset` passes the answer up to a caller that publishes it, and
   * "remembered" is a weaker promise than it looks on the server: the
   * repository is built per request there (`agentContextFor`), so the pending
   * set does not outlive the call, and the sweep only reclaims folders whose
   * presentation is gone. Saying `true` here would therefore be claiming the
   * bytes were removed on the strength of nobody having checked.
   */
  private async reclaimObjects(paths: readonly string[]): Promise<boolean> {
    if (paths.length === 0) return true
    try {
      const { error } = await this.client.storage.from(ASSETS_BUCKET).remove([...paths])
      if (!error) return true
    } catch {
      // Same outcome as an error response: remember them and move on.
    }
    for (const path of paths) this.pendingObjectRemovals.add(path)
    return false
  }
}
