/**
 * Slaids' access list: who may use Slaids, in which role, and whether the
 * account is active.
 *
 * Supabase Auth says who someone *is*. This table says whether that person is a
 * Slaids user at all. The Supabase project is shared with other apps and open
 * for sign-up, so an Auth account on its own is worth nothing here: every row
 * level security policy on Slaids' tables asks `slaids_is_active_user()`, the
 * agent API and the app's gate both ask `readUserAccess`.
 * Three readers, one table, one meaning — see `IMPLEMENTATION_PLAN.md` § 43.1.
 *
 * The browser can read its own row and nothing else, and can write nothing at
 * all. Role and status are changed by the server, with the service role, after
 * it has checked that the caller is an active administrator.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { RepositoryError } from './repository'

export const SLAIDS_USERS_TABLE = 'slaids_users'

export const SLAIDS_ROLES = ['user', 'admin'] as const
export type SlaidsRole = (typeof SLAIDS_ROLES)[number]

/**
 * What the database raises when a change would leave Slaids without an active
 * administrator. The trigger is the rule; this string is how callers recognise
 * it in an error message.
 */
export const LAST_ACTIVE_ADMIN_ERROR = 'SLAIDS_LAST_ACTIVE_ADMIN'

/** Lists every Slaids user with the Auth email. `service_role` only. */
export const ADMIN_LIST_USERS_FUNCTION = 'slaids_admin_list_users'

/** Finds an existing Auth user by email, any app's. `service_role` only. */
export const AUTH_USER_BY_EMAIL_FUNCTION = 'slaids_auth_user_id_by_email'

export function isSlaidsRole(value: unknown): value is SlaidsRole {
  return typeof value === 'string' && (SLAIDS_ROLES as readonly string[]).includes(value)
}

export interface SlaidsUserAccess {
  userId: string
  role: SlaidsRole
  active: boolean
}

/** A row read from `slaids_users`, or `null` when it is not one. */
export function slaidsUserAccessFromRow(row: unknown): SlaidsUserAccess | null {
  if (!row || typeof row !== 'object') return null
  const entry = row as Record<string, unknown>
  if (typeof entry.user_id !== 'string' || entry.user_id.length === 0) return null
  if (!isSlaidsRole(entry.role)) return null
  if (typeof entry.active !== 'boolean') return null
  return { userId: entry.user_id, role: entry.role, active: entry.active }
}

/** Whether an access record lets its user in. `null` is "not a Slaids user". */
export function isActiveAccess(access: SlaidsUserAccess | null): access is SlaidsUserAccess {
  return access !== null && access.active
}

/**
 * One user's row.
 *
 * The same read on both sides of the boundary. In the browser the client is the
 * signed-in user's, so row level security only ever returns their own row —
 * `null` then means "not a Slaids user", and a deactivated user still sees their
 * row with `active: false`, which is what lets the app say "deactivated" rather
 * than "no access". On the server the client holds the service role, so the
 * caller — always the authenticated principal, never a request field — decides
 * whose row is read.
 */
export async function readUserAccess(
  client: SupabaseClient,
  userId: string,
): Promise<SlaidsUserAccess | null> {
  const { data, error } = await client
    .from(SLAIDS_USERS_TABLE)
    .select('user_id, role, active')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new RepositoryError(`Kunne ikke lese brukertilgangen (${error.message}).`, error)
  return slaidsUserAccessFromRow(data)
}
