/**
 * Reading a shared deck, from the outside.
 *
 * This is the only client in Slaids that talks to the public share endpoint,
 * and it is the only one an anonymous visitor ever runs. It carries no key, no
 * session and no `owner_id`; the share token in the URL — a presentation's or a
 * folder's — is the whole of what it knows and the whole of what it needs.
 *
 * The Supabase URL comes from the same build variable everything else uses. It
 * is public by nature — the publishable key is not needed here at all, because
 * the function is deployed with `verify_jwt = false`.
 */

import type { Result } from '../domain/result'
import {
  parseSharedFolder,
  parseSharedSnapshot,
  type SharedFolderListing,
  type SharedPresentationSnapshot,
} from '../domain/sharing'
import { readSupabaseConfig } from '../supabase/config'

export const SHARE_FUNCTION_NAME = 'slaids-share'

/** `null` in local mode: there is no deployed function to ask. */
export function shareFunctionUrl(): string | null {
  const config = readSupabaseConfig()
  if (!config) return null
  return `${config.url.replace(/\/+$/, '')}/functions/v1/${SHARE_FUNCTION_NAME}`
}

/**
 * Which published deck a request is about: a presentation shared on its own,
 * by its token, or one deck inside a shared folder, by the folder's token and
 * the deck's id. The same two shapes the share endpoint reads.
 */
export type SharedDeckAddress =
  | { kind: 'presentation'; token: string }
  | { kind: 'folder'; folderToken: string; presentationId: string }

/** The query that names a deck to the share endpoint. */
function deckQuery(address: SharedDeckAddress): string {
  return address.kind === 'presentation'
    ? `token=${encodeURIComponent(address.token)}`
    : `folder=${encodeURIComponent(address.folderToken)}&presentation=${encodeURIComponent(address.presentationId)}`
}

/** A stable key for an address, for caches and memoised sources. */
export function deckAddressKey(address: SharedDeckAddress): string {
  return deckQuery(address)
}

/**
 * Where the public view loads a picture from.
 *
 * A shared deck never goes through the authenticated repository: that path
 * needs a session the viewer does not have, and asking for one would be a
 * request that can only fail. It comes through the share endpoint instead,
 * which serves a file only when the published snapshot actually lists it.
 */
export function sharedAssetUrl(address: SharedDeckAddress, assetId: string): string | null {
  const base = shareFunctionUrl()
  if (!base) return null
  return `${base}?${deckQuery(address)}&asset=${encodeURIComponent(assetId)}`
}

/**
 * The answer to one question put to the share endpoint.
 *
 * `not-found` is every refusal the endpoint makes — wrong token, revoked
 * share, a deleted presentation, a deck no longer in the folder — because the
 * endpoint answers them all the same way, and so does this: a link that does
 * not work says so, and never why.
 */
export type ShareOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; message: string }

export type SharedDeckOutcome = ShareOutcome<SharedPresentationSnapshot>
export type SharedFolderOutcome = ShareOutcome<SharedFolderListing>

/** Ask the share endpoint one question, and validate the answer with `parse`. */
async function askShareEndpoint<T>(
  query: string,
  parse: (body: unknown) => Result<T>,
  failedMessage: string,
  signal?: AbortSignal,
): Promise<ShareOutcome<T>> {
  const base = shareFunctionUrl()
  if (!base) {
    return {
      kind: 'unavailable',
      message: 'Denne installasjonen av Slaids er ikke satt opp for deling.',
    }
  }

  let response: Response
  try {
    response = await fetch(`${base}?${query}`, {
      signal,
      headers: { accept: 'application/json' },
    })
  } catch {
    return { kind: 'unavailable', message: 'Fikk ikke kontakt med serveren. Prøv igjen.' }
  }

  if (response.status === 404) return { kind: 'not-found' }
  if (!response.ok) return { kind: 'unavailable', message: failedMessage }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'unavailable', message: 'Svaret fra serveren kunne ikke leses.' }
  }

  const parsed = parse(body)
  if (!parsed.ok) return { kind: 'unavailable', message: parsed.error.message }
  return { kind: 'ok', value: parsed.value }
}

/**
 * One published deck. Validated and migrated with the same chain a stored
 * presentation goes through, so a snapshot published before a schema change
 * still opens.
 */
export function fetchSharedSnapshot(
  address: SharedDeckAddress,
  signal?: AbortSignal,
): Promise<SharedDeckOutcome> {
  return askShareEndpoint(
    deckQuery(address),
    parseSharedSnapshot,
    'Presentasjonen kunne ikke hentes akkurat nå.',
    signal,
  )
}

/** What a shared folder publishes: its name, and the decks in it. */
export function fetchSharedFolder(
  folderToken: string,
  signal?: AbortSignal,
): Promise<SharedFolderOutcome> {
  return askShareEndpoint(
    `folder=${encodeURIComponent(folderToken)}`,
    parseSharedFolder,
    'Mappen kunne ikke hentes akkurat nå.',
    signal,
  )
}
