/**
 * Administration → Brukere, from the browser.
 *
 * A thin client for the administration server (`src/server/admin/handler.ts`).
 * It decides nothing: the server checks, on every call, that the caller is an
 * active administrator, and the database keeps the last one. The types are
 * shared with the server from here, because `src/server/` is never imported by
 * the browser.
 */

import { ADMIN_USERS_PATH } from '../routing'
import { getSupabaseClient } from '../supabase/client'
import type { SlaidsRole } from './slaidsUsers'

export interface AdminUser {
  userId: string
  email: string
  role: SlaidsRole
  active: boolean
  createdAt: string
  lastSignInAt: string | null
}

/** What an administrator can change about a user. */
export type MemberChange = { role?: SlaidsRole; active?: boolean }

/** A refusal from the server, with its code and its sentence for a person. */
export class AdminRequestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AdminRequestError'
    this.code = code
  }
}

export interface AdminUsersClientOptions {
  /** The signed-in user's access token. Defaults to the app's Supabase session. */
  accessToken?: () => Promise<string | null>
  fetch?: typeof globalThis.fetch
}

async function sessionToken(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession()
  return data?.session?.access_token ?? null
}

export class AdminUsersClient {
  private readonly accessToken: () => Promise<string | null>
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: AdminUsersClientOptions = {}) {
    this.accessToken = options.accessToken ?? sessionToken
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async list(): Promise<AdminUser[]> {
    return (await this.call<{ users: AdminUser[] }>('GET', ADMIN_USERS_PATH)).users
  }

  async add(email: string, role: SlaidsRole): Promise<AdminUser> {
    return (await this.call<{ user: AdminUser }>('POST', ADMIN_USERS_PATH, { email, role })).user
  }

  async update(userId: string, change: MemberChange): Promise<AdminUser> {
    return (await this.call<{ user: AdminUser }>('PATCH', `${ADMIN_USERS_PATH}/${userId}`, change)).user
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.accessToken()
    if (!token) throw new AdminRequestError('UNAUTHENTICATED', 'Du er ikke logget inn. Logg inn på nytt.')

    let response: Response
    try {
      response = await this.fetchImpl(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new AdminRequestError('NETWORK', 'Fikk ikke kontakt med Slaids. Sjekk nettverket og prøv igjen.')
    }

    const parsed: unknown = await response.json().catch(() => null)
    const envelope = parsed as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | null
    if (response.ok && envelope?.ok) return envelope.data as T
    throw new AdminRequestError(
      envelope?.error?.code ?? 'UNKNOWN',
      envelope?.error?.message ?? 'Noe gikk galt. Prøv igjen.',
    )
  }
}
