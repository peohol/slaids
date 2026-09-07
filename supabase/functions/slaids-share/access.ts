/**
 * The rules the public share endpoint enforces, as plain functions.
 *
 * Kept apart from `index.ts` on purpose: that file is the Deno entry point and
 * talks to Supabase, while everything that *decides* — what a request is asking
 * for, whether a row may answer it, what may be said when it may not — lives
 * here, where the unit tests can reach it. The rules are the security model, so
 * they should be the part that is covered.
 *
 * Two things are deliberately duplicated from `src/domain`: the shape of the
 * published snapshot's asset list, and the token format. This code runs in Deno
 * on Supabase's edge and cannot import the browser bundle, and the alternative —
 * trusting the caller — is not one. Both are read defensively, from `unknown`.
 */

/** How a share token looks: a v4 UUID, and nothing else gets a lookup. */
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Asset ids are minted by `createId('a')`; this is a sanity bound, not a rule. */
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

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

export type ShareRequest =
  /** The published deck itself. */
  | { kind: 'snapshot'; token: string }
  /** One file that the published deck shows. */
  | { kind: 'asset'; token: string; assetId: string }

/**
 * What this request is asking for, or `null` when it is not a question this
 * endpoint answers. There is no listing form and no other verb: a request
 * without a well-formed token is refused before anything is looked up.
 */
export function readShareRequest(method: string, url: URL): ShareRequest | null {
  if (method !== 'GET' && method !== 'HEAD') return null

  const token = url.searchParams.get('token') ?? ''
  if (!TOKEN_PATTERN.test(token)) return null

  const asset = url.searchParams.get('asset')
  if (asset === null) return { kind: 'snapshot', token }
  if (!ASSET_ID_PATTERN.test(asset)) return null
  return { kind: 'asset', token, assetId: asset }
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
