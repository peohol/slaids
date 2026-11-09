/**
 * The administration server's side of Supabase: the only impure part of it.
 *
 * Built on the same service-role client as the agent API. That client bypasses
 * row level security, which is why `handler.ts` decides who the caller is and
 * whether they are an active administrator before any method here runs, and
 * why nothing here takes a user id from anywhere but the handler.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ADMIN_LIST_USERS_FUNCTION,
  AUTH_USER_BY_EMAIL_FUNCTION,
  LAST_ACTIVE_ADMIN_ERROR,
  SLAIDS_USERS_TABLE,
  isSlaidsRole,
  readUserAccess,
} from '../../persistence/slaidsUsers'
import type { AdminApiDeps, AdminUser, AdminUserStore } from './handler'

/** Postgres' unique-violation code: the user is already on the list. */
const UNIQUE_VIOLATION = '23505'

/**
 * Whose ordinary browser session a token is.
 *
 * Supabase Auth verifies the token (signature, expiry, that the user still
 * exists). What it does not refuse is an OAuth access token, which has the same
 * issuer and audience as a session — so a token carrying `client_id` is turned
 * away here: a delegation to ChatGPT or another client is never an
 * administrator. The payload is read only after Supabase has accepted the
 * token, so nothing unverified decides anything.
 */
export function sessionUserResolver(client: SupabaseClient): AdminApiDeps['sessionUser'] {
  return async (token) => {
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user?.id) return null
    if (isDelegation(token)) return null
    return data.user.id
  }
}

function isDelegation(token: string): boolean {
  try {
    const payload = token.split('.')[1] ?? ''
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))
    const claims: unknown = JSON.parse(json)
    return typeof claims !== 'object' || claims === null || 'client_id' in claims
  } catch {
    // A token Supabase accepted but whose payload cannot be read is not one to
    // grant administration to.
    return true
  }
}

function adminUserFromRow(row: unknown): AdminUser | null {
  if (!row || typeof row !== 'object') return null
  const entry = row as Record<string, unknown>
  if (typeof entry.user_id !== 'string' || !isSlaidsRole(entry.role) || typeof entry.active !== 'boolean') {
    return null
  }
  return {
    userId: entry.user_id,
    email: typeof entry.email === 'string' ? entry.email : '',
    role: entry.role,
    active: entry.active,
    createdAt: typeof entry.created_at === 'string' ? entry.created_at : '',
    lastSignInAt: typeof entry.last_sign_in_at === 'string' ? entry.last_sign_in_at : null,
  }
}

export function supabaseAdminUserStore(client: SupabaseClient): AdminUserStore {
  const findAuthUser = async (email: string): Promise<string | null> => {
    const { data, error } = await client.rpc(AUTH_USER_BY_EMAIL_FUNCTION, { p_email: email })
    if (error) throw new Error(error.message)
    return typeof data === 'string' ? data : null
  }

  return {
    accessOf: (userId) => readUserAccess(client, userId),

    async list() {
      const { data, error } = await client.rpc(ADMIN_LIST_USERS_FUNCTION)
      if (error) throw new Error(error.message)
      return ((data ?? []) as unknown[])
        .map(adminUserFromRow)
        .filter((user): user is AdminUser => user !== null)
    },

    findAuthUser,

    async createAuthUser(email) {
      const { data, error } = await client.auth.admin.createUser({ email, email_confirm: true })
      if (!error && data?.user?.id) return data.user.id
      // Somebody created the same address a moment ago — another request, or
      // another app. The account exists now, and it is the one to use.
      const existing = await findAuthUser(email)
      if (existing) return existing
      throw new Error(error?.message ?? 'Kunne ikke opprette Auth-brukeren.')
    },

    async addMember({ userId, role, createdBy }) {
      const { error } = await client
        .from(SLAIDS_USERS_TABLE)
        .insert({ user_id: userId, role, active: true, created_by: createdBy })
      if (!error) return true
      if (error.code === UNIQUE_VIOLATION) return false
      throw new Error(error.message)
    },

    async updateMember(userId, change) {
      const { data, error } = await client
        .from(SLAIDS_USERS_TABLE)
        .update(change)
        .eq('user_id', userId)
        .select('user_id')
      if (error) {
        if (error.message.includes(LAST_ACTIVE_ADMIN_ERROR)) return 'last-admin'
        throw new Error(error.message)
      }
      return (data ?? []).length > 0 ? 'updated' : 'not-found'
    },
  }
}
