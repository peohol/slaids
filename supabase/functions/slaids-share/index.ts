/**
 * `slaids-share` — the only public door into Slaids.
 *
 * Two GETs, both keyed on a share token that is a v4 UUID:
 *
 *   GET .../slaids-share?token=<token>              → the published snapshot
 *   GET .../slaids-share?token=<token>&asset=<id>   → one file that deck shows
 *
 * There is no listing form, no write, and no third shape. Everything that is
 * not exactly one of those two — including a token that does not exist, a share
 * that has been turned off, and an asset the published snapshot does not
 * mention — gets the same generic 404, so the endpoint cannot be used to learn
 * whether a token is real.
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
  assetHeaders,
  publishedAssetIds,
  publishedAssetMimeType,
  publishedDocument,
  readShareRequest,
  shareHeaders,
  type SharedRow,
} from './access.ts'

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

const PRESENTATIONS_TABLE = 'slaids_presentations'
const ASSETS_TABLE = 'slaids_assets'
const ASSETS_BUCKET = 'slaids-assets'

function notFound(): Response {
  return new Response(JSON.stringify(NOT_FOUND_BODY), {
    status: NOT_FOUND_STATUS,
    headers: shareHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  })
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

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: shareHeaders() })
  }

  const intent = readShareRequest(request.method, new URL(request.url))
  if (!intent) return notFound()

  // `id` is needed to scope the asset lookup to this presentation; it never
  // leaves the function. `owner_id`, `document` and `object_path` are not
  // selected at all — what is not fetched cannot be leaked.
  const { data, error } = await client
    .from(PRESENTATIONS_TABLE)
    .select('id, is_shared, shared_document')
    .eq('share_token', intent.token)
    .eq('is_shared', true)
    .maybeSingle()
  if (error) return notFound()

  const row = data as SharedRow | null
  const document = publishedDocument(row)
  if (!row || !document) return notFound()

  if (intent.kind === 'snapshot') {
    return new Response(JSON.stringify(document), {
      status: 200,
      headers: shareHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
    })
  }

  // The snapshot decides, not the presentation: a file that belongs to this
  // deck but is not part of what was published stays private.
  if (!publishedAssetIds(document).has(intent.assetId)) return notFound()

  const asset = await client
    .from(ASSETS_TABLE)
    .select('object_path')
    .eq('id', intent.assetId)
    .eq('presentation_id', row.id)
    .maybeSingle()
  if (asset.error || !asset.data) return notFound()

  const objectPath = (asset.data as { object_path?: unknown }).object_path
  if (typeof objectPath !== 'string' || objectPath.length === 0) return notFound()

  const file = await client.storage.from(ASSETS_BUCKET).download(objectPath)
  if (file.error || !file.data) return notFound()

  return new Response(file.data, {
    status: 200,
    headers: assetHeaders(publishedAssetMimeType(document, intent.assetId)),
  })
})
