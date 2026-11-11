/**
 * `slaids-share` — the only public door into Slaids.
 *
 * GETs only, each keyed on a share token that is a v4 UUID — a presentation's
 * own, or a shared folder's:
 *
 *   GET .../slaids-share?token=<token>                               → the published snapshot
 *   GET .../slaids-share?token=<token>&asset=<id>                    → one file that deck shows
 *   GET .../slaids-share?folder=<token>                              → the folder's published decks
 *   GET .../slaids-share?folder=<token>&presentation=<id>            → one of them
 *   GET .../slaids-share?folder=<token>&presentation=<id>&asset=<id> → one file it shows
 *
 * There is no write, and no listing beyond a shared folder's own. Everything
 * that is not exactly one of those — including a token that does not exist, a
 * share that has been turned off, a deck that is not in the folder, an asset
 * the published snapshot does not mention, and anything published by an
 * account an administrator has deactivated — gets the same generic 404,
 * so the endpoint cannot be used to learn whether a token or an id is real.
 *
 * It runs with the service role because the tables it reads are closed to
 * `anon` entirely: sharing adds no row-level policy, so there is no widened
 * surface to get wrong. The key lives in the function's own environment on
 * Supabase — never in the Vite build, never in Vercel, never in the browser.
 *
 * `verify_jwt = false` in `supabase/config.toml` is what makes the endpoint
 * reachable without a session; that is the point of it.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  NOT_FOUND_BODY,
  NOT_FOUND_STATUS,
  USERS_TABLE,
  assetHeaders,
  ownerMayPublish,
  publishedAssetIds,
  publishedAssetMimeType,
  publishedDocument,
  publishedFolderDocument,
  publishedFolderListing,
  readShareRequest,
  shareHeaders,
  sharedFolder,
  type DeckAddress,
  type FolderDeckRow,
  type FolderListingRow,
  type OwnerAccessRow,
  type SharedFolderRow,
  type SharedRow,
} from './access.ts'

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

const PRESENTATIONS_TABLE = 'slaids_presentations'
const FOLDERS_TABLE = 'slaids_folders'
const ASSETS_TABLE = 'slaids_assets'
const USER_SETTINGS_TABLE = 'slaids_user_settings'
const ASSETS_BUCKET = 'slaids-assets'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: shareHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  })
}

function notFound(): Response {
  return json(NOT_FOUND_BODY, NOT_FOUND_STATUS)
}

// Both are injected by Supabase. Missing means the function was deployed into
// an environment that cannot answer anything, which is worth saying plainly
// rather than failing later inside the client.
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('slaids-share mangler SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY.')
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** A published deck, as far as the rest of the request needs to know it. */
interface PublishedDeck {
  /** Scopes the asset lookup to this presentation; it never leaves the function. */
  id: string
  ownerId: string
  document: unknown
}

/**
 * Whether the owner of a publication is an active Slaids user right now.
 *
 * Read on every request, so deactivation takes the owner's links down at once
 * and reactivation brings them back. Any failure to read is "no". See
 * `ownerMayPublish`.
 */
async function ownerIsActive(ownerId: unknown): Promise<boolean> {
  if (typeof ownerId !== 'string' || ownerId.length === 0) return false
  const { data, error } = await client
    .from(USERS_TABLE)
    .select('active')
    .eq('user_id', ownerId)
    .maybeSingle()
  if (error) return false
  return ownerMayPublish(data as OwnerAccessRow | null)
}

/**
 * The shared folder a token names, or `null`. `owner_id` is read so the decks
 * can be looked up as the folder owner's and nobody else's, and so a
 * deactivated owner's folder answers nothing; it is never returned.
 */
async function folderByToken(folderToken: string): Promise<SharedFolderRow | null> {
  const { data, error } = await client
    .from(FOLDERS_TABLE)
    .select('id, owner_id, name, is_shared')
    .eq('share_token', folderToken)
    .eq('is_shared', true)
    .maybeSingle()
  if (error) return null
  const folder = sharedFolder(data as SharedFolderRow | null)
  if (!folder || !(await ownerIsActive(folder.owner_id))) return null
  return folder
}

/**
 * The published deck an address names, or `null` for every reason it might not.
 *
 * `document` and `object_path` are not selected at all — what is not fetched
 * cannot be leaked. `owner_id` identifies the account whose access and public
 * display choices apply. It never leaves this function. A presentation in the trash is deleted as far
 * as the public is concerned: its share columns are still on the row, so that
 * a restore brings the link back, but while it is trashed the link is dead.
 * Filtered here *and* checked again by the rules in `access.ts`.
 */
async function publishedDeck(address: DeckAddress): Promise<PublishedDeck | null> {
  if (address.kind === 'presentation') {
    const { data, error } = await client
      .from(PRESENTATIONS_TABLE)
      .select('id, owner_id, is_shared, shared_document, deleted_at')
      .eq('share_token', address.token)
      .eq('is_shared', true)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) return null
    const row = data as SharedRow | null
    const document = publishedDocument(row)
    if (!row || !document || typeof row.owner_id !== 'string' || !(await ownerIsActive(row.owner_id))) {
      return null
    }
    return { id: row.id, ownerId: row.owner_id, document }
  }

  const folder = await folderByToken(address.folderToken)
  if (!folder) return null
  const { data, error } = await client
    .from(PRESENTATIONS_TABLE)
    .select('id, folder_id, is_published, shared_document, deleted_at')
    .eq('id', address.presentationId)
    .eq('folder_id', folder.id)
    .eq('owner_id', folder.owner_id)
    .eq('is_published', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return null
  const row = data as FolderDeckRow | null
  const document = publishedFolderDocument(folder, row)
  return row && document ? { id: row.id, ownerId: folder.owner_id, document } : null
}

async function snapshotForAudience(deck: PublishedDeck): Promise<unknown> {
  const { data, error } = await client.from(USER_SETTINGS_TABLE)
    .select('include_references_in_progress')
    .eq('owner_id', deck.ownerId)
    .maybeSingle()
  if (error) return deck.document
  // Send bare kopien og de eksplisitte visningsvalgene som gjelder publikum.
  return {
    ...(deck.document as Record<string, unknown>),
    includeReferencesInProgress: data?.include_references_in_progress === true,
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: shareHeaders() })
  }

  const intent = readShareRequest(request.method, new URL(request.url))
  if (!intent) return notFound()

  if (intent.kind === 'folder') {
    const folder = await folderByToken(intent.folderToken)
    if (!folder) return notFound()
    // The published title, never the private one, and nothing for a deck that
    // has no published copy: `publishedFolderListing` leaves those out.
    const { data, error } = await client
      .from(PRESENTATIONS_TABLE)
      .select('id, is_published, deleted_at, slide_count, title:shared_document->>title')
      .eq('folder_id', folder.id)
      .eq('owner_id', folder.owner_id)
      .eq('is_published', true)
      .is('deleted_at', null)
    if (error) return notFound()
    return json(publishedFolderListing(folder, (data ?? []) as FolderListingRow[]))
  }

  const deck = await publishedDeck(intent.deck)
  if (!deck) return notFound()

  if (intent.kind === 'snapshot') return json(await snapshotForAudience(deck))

  // The snapshot decides, not the presentation: a file that belongs to this
  // deck but is not part of what was published stays private.
  if (!publishedAssetIds(deck.document).has(intent.assetId)) return notFound()

  const asset = await client
    .from(ASSETS_TABLE)
    .select('object_path')
    .eq('id', intent.assetId)
    .eq('presentation_id', deck.id)
    .maybeSingle()
  if (asset.error || !asset.data) return notFound()

  const objectPath = (asset.data as { object_path?: unknown }).object_path
  if (typeof objectPath !== 'string' || objectPath.length === 0) return notFound()

  const file = await client.storage.from(ASSETS_BUCKET).download(objectPath)
  if (file.error || !file.data) return notFound()

  return new Response(file.data, {
    status: 200,
    headers: assetHeaders(publishedAssetMimeType(deck.document, intent.assetId)),
  })
})
