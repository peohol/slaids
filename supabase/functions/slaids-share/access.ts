/**
 * The rules the public share endpoint enforces, as plain functions.
 *
 * Kept apart from `index.ts` on purpose: that file is the Deno entry point and
 * talks to Supabase, while everything that *decides* — what a request is asking
 * for, whether a row may answer it, what may be said when it may not — lives
 * here, where the unit tests can reach it. The rules are the security model, so
 * they should be the part that is covered.
 *
 * Three things are deliberately duplicated from `src/domain`: the shape of the
 * published snapshot's asset list, the token format, and the envelope of a
 * shared folder's listing. This code runs in Deno
 * on Supabase's edge and cannot import the browser bundle, and the alternative —
 * trusting the caller — is not one. Both are read defensively, from `unknown`.
 */

/** How a share token looks: a v4 UUID, and nothing else gets a lookup. */
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Asset and presentation ids are minted by `createId`; this is a sanity bound,
 * not a rule.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** A MIME type we are willing to echo back on an asset response. */
const MIME_PATTERN = /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/

export const FALLBACK_CONTENT_TYPE = 'application/octet-stream'

/**
 * One answer for every refusal.
 *
 * A malformed token, an unknown token, a revoked share, a deleted presentation
 * and an asset that is not part of the published deck all produce exactly this.
 * Distinguishing between them would turn the endpoint into an oracle: "this
 * token exists but is off" is information a guesser should never be given.
 */
export const NOT_FOUND_STATUS = 404
export const NOT_FOUND_BODY = { error: 'not_found' }

/**
 * Which published deck a request is about.
 *
 * Either a presentation shared on its own, named by its own token, or one deck
 * inside a shared folder, named by the *folder's* token and the deck's id. The
 * id alone opens nothing: it is only ever looked up inside the folder the token
 * names, and only among the decks that folder publishes.
 */
export type DeckAddress =
  | { kind: 'presentation'; token: string }
  | { kind: 'folder'; folderToken: string; presentationId: string }

export type ShareRequest =
  /** The published deck itself. */
  | { kind: 'snapshot'; deck: DeckAddress }
  /** One file that the published deck shows. */
  | { kind: 'asset'; deck: DeckAddress; assetId: string }
  /** What a shared folder publishes: its name, and its published decks. */
  | { kind: 'folder'; folderToken: string }

/** A query parameter that is either absent or matches `pattern`; `undefined` is neither. */
function optional(url: URL, name: string, pattern: RegExp): string | null | undefined {
  const value = url.searchParams.get(name)
  if (value === null) return null
  return pattern.test(value) ? value : undefined
}

/**
 * What this request is asking for, or `null` when it is not a question this
 * endpoint answers. There is no other verb, and the only listing there is is a
 * shared folder's own, by its exact token: a request without a well-formed
 * token is refused before anything is looked up, and so is one that names both
 * kinds of token at once, because no deck is addressed that way.
 */
export function readShareRequest(method: string, url: URL): ShareRequest | null {
  if (method !== 'GET' && method !== 'HEAD') return null

  const token = optional(url, 'token', TOKEN_PATTERN)
  const folderToken = optional(url, 'folder', TOKEN_PATTERN)
  const presentationId = optional(url, 'presentation', ID_PATTERN)
  const assetId = optional(url, 'asset', ID_PATTERN)
  if (token === undefined || folderToken === undefined) return null
  if (presentationId === undefined || assetId === undefined) return null

  let deck: DeckAddress
  if (token !== null) {
    if (folderToken !== null || presentationId !== null) return null
    deck = { kind: 'presentation', token }
  } else if (folderToken !== null) {
    if (presentationId === null) {
      return assetId === null ? { kind: 'folder', folderToken } : null
    }
    deck = { kind: 'folder', folderToken, presentationId }
  } else {
    return null
  }

  return assetId === null ? { kind: 'snapshot', deck } : { kind: 'asset', deck, assetId }
}

/** A row as the endpoint reads it: never `owner_id`, never the private document. */
export interface SharedRow {
  id: string
  is_shared: boolean | null
  shared_document: unknown
  /**
   * When the owner moved the presentation to the trash, or `null`/absent while
   * it is in the library. Absent is allowed so a row read by an older query
   * still parses; it is read as "not trashed", which is what absent meant
   * before the column existed.
   */
  deleted_at?: unknown
}

/**
 * The published deck, or `null` when there is nothing to publish.
 *
 * The database constraint already ties `is_shared` and `shared_document`
 * together, and this checks both anyway: it is the last gate before data leaves
 * for an anonymous reader, and a gate that trusts an invariant it could verify
 * is not a gate.
 *
 * A trashed row is refused for the same reason, even though the query already
 * filters it out. The owner deleted the deck; that the deletion can be undone
 * for thirty days is the owner's business, not the public's, and the link must
 * be dead for exactly as long as the deck is in the trash.
 */
export function publishedDocument(row: SharedRow | null | undefined): unknown | null {
  if (!row || row.is_shared !== true) return null
  if (row.deleted_at !== null && row.deleted_at !== undefined) return null
  const document = row.shared_document
  if (!document || typeof document !== 'object') return null
  return document
}

/** A folder as the endpoint reads it: looked up by token, never returned as is. */
export interface SharedFolderRow {
  id: string
  owner_id: string
  name: unknown
  is_shared: boolean | null
}

/** A deck as a shared folder's lookup reads it: `owner_id` and `document` never. */
export interface FolderDeckRow {
  id: string
  folder_id: unknown
  is_published: boolean | null
  deleted_at?: unknown
  shared_document: unknown
}

/** One line of a shared folder's listing, as the folder lookup reads it. */
export interface FolderListingRow {
  id: string
  is_published: boolean | null
  deleted_at?: unknown
  slide_count: unknown
  /** `shared_document->>title`: the published title, or `null` with no copy. */
  title: unknown
}

/** Marks the listing as ours, like `SHARED_SNAPSHOT_FORMAT` does a deck. */
export const SHARED_FOLDER_FORMAT = 'slaids-shared-folder'
export const SHARED_FOLDER_VERSION = 1

/**
 * What a shared folder publishes.
 *
 * Its name, and for each published deck in it the id to ask for it by, the
 * published title and how many slides it has — no owner, no dates, no folder
 * id, and nothing about a deck that has no published copy. Built by listing
 * what goes in, the same direction `buildSharedSnapshot` takes.
 */
export interface SharedFolderListing {
  format: typeof SHARED_FOLDER_FORMAT
  folderVersion: typeof SHARED_FOLDER_VERSION
  name: string
  presentations: { id: string; title: string; slideCount: number }[]
}

/** The folder a token resolves to, or `null` when it may not answer anything. */
export function sharedFolder(row: SharedFolderRow | null | undefined): SharedFolderRow | null {
  if (!row || row.is_shared !== true) return null
  if (typeof row.id !== 'string' || typeof row.owner_id !== 'string') return null
  return row
}

/** A deck may answer through a folder only while it is not in the trash and is published. */
function liveAndPublished(row: { is_published: boolean | null; deleted_at?: unknown }): boolean {
  if (row.is_published !== true) return false
  return row.deleted_at === null || row.deleted_at === undefined
}

/**
 * The published deck behind a folder link, or `null`.
 *
 * Every condition the query already filters on is checked again here, for the
 * reason `publishedDocument` gives: this is the last gate before data leaves
 * for an anonymous reader. The deck must be filed in *this* folder, still be
 * published through it, not be in the trash, and carry a copy.
 */
export function publishedFolderDocument(
  folder: SharedFolderRow | null,
  row: FolderDeckRow | null | undefined,
): unknown | null {
  if (!folder || !row || row.folder_id !== folder.id) return null
  if (!liveAndPublished(row)) return null
  const document = row.shared_document
  if (!document || typeof document !== 'object') return null
  return document
}

/**
 * The listing a folder link answers with.
 *
 * A row without a published title is a deck that is published but has no copy
 * yet — filed in the folder by a write that carried none — and is left out
 * rather than listed as something that cannot be opened. The order is the
 * title's, so the same folder reads the same way every time.
 */
export function publishedFolderListing(
  folder: SharedFolderRow,
  rows: readonly FolderListingRow[],
): SharedFolderListing {
  const presentations: SharedFolderListing['presentations'] = []
  for (const row of rows) {
    if (!liveAndPublished(row) || typeof row.title !== 'string') continue
    if (!ID_PATTERN.test(row.id)) continue
    const slideCount =
      typeof row.slide_count === 'number' && Number.isFinite(row.slide_count) ? row.slide_count : 0
    presentations.push({ id: row.id, title: row.title, slideCount })
  }
  presentations.sort((a, b) => a.title.localeCompare(b.title, 'nb') || a.id.localeCompare(b.id))
  return {
    format: SHARED_FOLDER_FORMAT,
    folderVersion: SHARED_FOLDER_VERSION,
    name: typeof folder.name === 'string' ? folder.name : '',
    presentations,
  }
}

/**
 * Asset ids the published snapshot actually lists.
 *
 * This is what makes the token scope a *snapshot* rather than a presentation:
 * an asset row can exist, belong to the same presentation and still not be part
 * of what was published — a picture only the sandbox uses, or one that was
 * removed from a slide after the deck was last saved. Those stay private.
 */
export function publishedAssetIds(document: unknown): Set<string> {
  const ids = new Set<string>()
  if (!document || typeof document !== 'object') return ids
  const assets = (document as { assets?: unknown }).assets
  if (!Array.isArray(assets)) return ids
  for (const asset of assets) {
    const id = (asset as { id?: unknown } | null)?.id
    if (typeof id === 'string' && id.length > 0) ids.add(id)
  }
  return ids
}

/** The declared type of a published asset, or `null` when it lists none. */
export function publishedAssetMimeType(document: unknown, assetId: string): string | null {
  if (!document || typeof document !== 'object') return null
  const assets = (document as { assets?: unknown }).assets
  if (!Array.isArray(assets)) return null
  for (const asset of assets) {
    const entry = asset as { id?: unknown; mimeType?: unknown } | null
    if (entry?.id !== assetId) continue
    return typeof entry.mimeType === 'string' ? entry.mimeType : null
  }
  return null
}

/** Only a well-formed type is echoed back; anything else is opaque bytes. */
export function assetContentType(mimeType: string | null | undefined): string {
  return mimeType && MIME_PATTERN.test(mimeType) ? mimeType : FALLBACK_CONTENT_TYPE
}

/**
 * Headers every response carries.
 *
 *  - `no-store`, because a cached copy of a deck would outlive the revocation
 *    that was supposed to take it away;
 *  - `noindex, nofollow`, because a secret link that a crawler has found is not
 *    a secret link any more;
 *  - a permissive CORS origin, which is right for a read endpoint whose whole
 *    access control is the token in the URL: there is no cookie and no session
 *    for another site to ride on.
 */
export function shareHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  }
}

/**
 * Headers for the bytes of a published asset.
 *
 * `default-src 'none'` matters for SVG: it is served as a picture, and this is
 * what keeps it from being anything else if someone opens the URL directly.
 */
export function assetHeaders(mimeType: string | null | undefined): Record<string, string> {
  return shareHeaders({
    'Content-Type': assetContentType(mimeType),
    'Content-Disposition': 'inline',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
}
