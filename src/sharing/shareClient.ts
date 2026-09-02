/**
 * Reading a shared deck, from the outside.
 *
 * This is the only client in Slaids that talks to the public share endpoint,
 * and it is the only one an anonymous visitor ever runs. It carries no key, no
 * session and no `owner_id`; the share token in the URL is the whole of what it
 * knows and the whole of what it needs.
 *
 * The Supabase URL comes from the same build variable everything else uses. It
 * is public by nature — the publishable key is not needed here at all, because
 * the function is deployed with `verify_jwt = false`.
 */

import { parseSharedSnapshot, type SharedPresentationSnapshot } from '../domain/sharing'
import { readSupabaseConfig } from '../supabase/config'

export const SHARE_FUNCTION_NAME = 'slaids-share'

/** `null` in local mode: there is no deployed function to ask. */
export function shareFunctionUrl(): string | null {
  const config = readSupabaseConfig()
  if (!config) return null
  return `${config.url.replace(/\/+$/, '')}/functions/v1/${SHARE_FUNCTION_NAME}`
}

/**
 * Where the public view loads a picture from.
 *
 * A shared deck never goes through the authenticated repository: that path
 * needs a session the viewer does not have, and asking for one would be a
 * request that can only fail. It comes through the share endpoint instead,
 * which serves a file only when the published snapshot actually lists it.
 */
export function sharedAssetUrl(token: string, assetId: string): string | null {
  const base = shareFunctionUrl()
  if (!base) return null
  return `${base}?token=${encodeURIComponent(token)}&asset=${encodeURIComponent(assetId)}`
}

export type SharedDeckOutcome =
  | { kind: 'ok'; snapshot: SharedPresentationSnapshot }
  /** Wrong token, revoked share, or a deleted presentation — indistinguishable. */
  | { kind: 'not-found' }
  | { kind: 'unavailable'; message: string }

export async function fetchSharedSnapshot(
  token: string,
  signal?: AbortSignal,
): Promise<SharedDeckOutcome> {
  const base = shareFunctionUrl()
  if (!base) {
    return {
      kind: 'unavailable',
      message: 'Denne installasjonen av Slaids er ikke satt opp for deling.',
    }
  }

  let response: Response
  try {
    response = await fetch(`${base}?token=${encodeURIComponent(token)}`, {
      signal,
      headers: { accept: 'application/json' },
    })
  } catch {
    return { kind: 'unavailable', message: 'Fikk ikke kontakt med serveren. Prøv igjen.' }
  }

  // The endpoint answers every refusal the same way, and so does this: a link
  // that does not work says so, and never why.
  if (response.status === 404) return { kind: 'not-found' }
  if (!response.ok) {
    return { kind: 'unavailable', message: 'Presentasjonen kunne ikke hentes akkurat nå.' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'unavailable', message: 'Svaret fra serveren kunne ikke leses.' }
  }

  // Validated and migrated with the same chain a stored presentation goes
  // through, so a snapshot published before a schema change still opens.
  const parsed = parseSharedSnapshot(body)
  if (!parsed.ok) return { kind: 'unavailable', message: parsed.error.message }
  return { kind: 'ok', snapshot: parsed.value }
}
