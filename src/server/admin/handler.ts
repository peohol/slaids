/**
 * Administration → Brukere, on the server.
 *
 * The browser shows the admin screen only to administrators, but hiding a
 * button is not a permission. Every action lands here, and here is where it is
 * decided — `IMPLEMENTATION_PLAN.md` § 43.1:
 *
 *  1. the caller presents the Supabase access token of their ordinary browser
 *     session, and Supabase Auth itself says whose it is;
 *  2. an agent token or an OAuth delegation (a token with `client_id`) is
 *     refused outright — administration is never an agent operation;
 *  3. the caller must be an *active administrator* in `slaids_users`, read with
 *     the service role, never from a claim the caller could influence.
 *
 * Only then does anything change, and the one rule that must hold however the
 * requests interleave — there is always an active administrator — is enforced
 * by the database trigger, not re-implemented here. This file translates its
 * refusal into a sentence a person can act on.
 *
 * Like the agent handler, this file reaches nothing on its own: the session
 * check and the store are injected, so the decisions are what the tests hold.
 */

import type { AdminUser, MemberChange } from '../../persistence/adminUsers'
import { isSlaidsRole, type SlaidsRole } from '../../persistence/slaidsUsers'
import { ADMIN_USERS_PATH, AGENT_API_BASE_PATH } from '../../routing'
import { readBody } from '../agent/body'
import { looksLikeJwt } from '../agent/oauth'
import { bearerToken } from '../agent/tokens'
import { errorResponse, jsonResponse, type ApiError } from '../agent/protocol'

export type { AdminUser, MemberChange }

/** The administration address as the agent router sees it: after the base path. */
export const ADMIN_USERS_SUBPATH = ADMIN_USERS_PATH.slice(AGENT_API_BASE_PATH.length)

/** An administration request is a sentence or two of JSON. */
const MAX_ADMIN_BODY_BYTES = 16 * 1024

/** RFC 5321 caps an address at 254 characters; the shape check is deliberately loose. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The database half. Every method may throw; a throw is "the store did not answer". */
export interface AdminUserStore {
  /** The caller's own access, read with the service role. */
  accessOf(userId: string): Promise<{ role: SlaidsRole; active: boolean } | null>
  list(): Promise<AdminUser[]>
  /** An existing Auth account with this email, from any app in the project. */
  findAuthUser(email: string): Promise<string | null>
  /** A new Auth account: no password, no email sent, address confirmed. */
  createAuthUser(email: string): Promise<string>
  /** `false` when the user is already on the list. */
  addMember(input: { userId: string; role: SlaidsRole; createdBy: string }): Promise<boolean>
  /** `not-found` when no such member; `last-admin` when the database refused. */
  updateMember(userId: string, change: MemberChange): Promise<'updated' | 'not-found' | 'last-admin'>
}

export interface AdminApiDeps {
  /**
   * Whose browser session this token is, according to Supabase Auth — or
   * `null` for anything that is not a live, ordinary session token.
   */
  sessionUser(token: string): Promise<string | null>
  store: AdminUserStore
}

const FORBIDDEN: ApiError = {
  code: 'FORBIDDEN',
  message: 'Bare aktive administratorer kan administrere brukere.',
}

const UNAUTHENTICATED: ApiError = {
  code: 'UNAUTHENTICATED',
  message: 'Logg inn i Slaids på nytt for å administrere brukere.',
}

const STORE_FAILED: ApiError = {
  code: 'STORAGE_FAILED',
  message: 'Fikk ikke kontakt med brukerregisteret. Prøv igjen om litt.',
}

const LAST_ADMIN: ApiError = {
  code: 'LAST_ACTIVE_ADMIN',
  message:
    'Slaids må ha minst én aktiv administrator. Gjør en annen bruker til administrator først.',
}

/**
 * Answer one administration request. `path` is what follows the agent API's
 * base path, and starts with `ADMIN_USERS_SUBPATH`.
 */
export async function handleAdminRequest(
  deps: AdminApiDeps,
  request: Request,
  path: string,
): Promise<Response> {
  const target = adminTarget(path)
  if (target === null) return errorResponse({ code: 'NOT_FOUND', message: 'Ukjent adresse.' })

  const callerId = await authenticate(deps, request)
  if (callerId === null) return errorResponse(UNAUTHENTICATED)

  try {
    const caller = await deps.store.accessOf(callerId)
    if (!caller || !caller.active || caller.role !== 'admin') return errorResponse(FORBIDDEN)

    if (target.kind === 'collection') {
      if (request.method === 'GET') return ok({ users: await deps.store.list() })
      if (request.method === 'POST') return await addUser(deps, request, callerId)
      return methodNotAllowed('GET, POST')
    }
    if (request.method === 'PATCH') return await changeUser(deps, request, target.userId)
    return methodNotAllowed('PATCH')
  } catch (error) {
    console.error('slaids-admin: brukerregisteret svarte ikke', error)
    return errorResponse(STORE_FAILED)
  }
}

type AdminTarget = { kind: 'collection' } | { kind: 'member'; userId: string }

function adminTarget(path: string): AdminTarget | null {
  if (path === ADMIN_USERS_SUBPATH) return { kind: 'collection' }
  if (!path.startsWith(`${ADMIN_USERS_SUBPATH}/`)) return null
  const userId = path.slice(ADMIN_USERS_SUBPATH.length + 1)
  return UUID_PATTERN.test(userId) ? { kind: 'member', userId: userId.toLowerCase() } : null
}

/**
 * The caller's Auth user id, or `null`.
 *
 * Only a bearer JWT is even considered — an agent token (`slaids_at_…`) is not
 * one, so it never reaches Supabase from here. Whether the JWT is an ordinary
 * session and not a delegation is `sessionUser`'s to say.
 */
async function authenticate(deps: AdminApiDeps, request: Request): Promise<string | null> {
  const token = bearerToken(request.headers.get('authorization'))
  if (!token || !looksLikeJwt(token)) return null
  try {
    return await deps.sessionUser(token)
  } catch (error) {
    console.error('slaids-admin: kunne ikke verifisere innloggingen', error)
    return null
  }
}

async function addUser(deps: AdminApiDeps, request: Request, callerId: string): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return errorResponse(body.error)

  const email = typeof body.value.email === 'string' ? body.value.email.trim() : ''
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return errorResponse({ code: 'INVALID_INPUT', message: 'Skriv inn en gyldig e-postadresse.' })
  }
  const role = body.value.role ?? 'user'
  if (!isSlaidsRole(role)) {
    return errorResponse({ code: 'INVALID_INPUT', message: 'Rollen må være «user» eller «admin».' })
  }

  // One person, one identity: an Auth account that already exists — made by
  // another app in the project, or by an earlier attempt — is reused.
  const userId = (await deps.store.findAuthUser(email)) ?? (await deps.store.createAuthUser(email))
  const added = await deps.store.addMember({ userId, role, createdBy: callerId })
  if (!added) {
    return errorResponse({ code: 'ALREADY_MEMBER', message: `${email} er allerede Slaids-bruker.` })
  }
  return ok({ user: await memberById(deps, userId) }, 201)
}

async function changeUser(deps: AdminApiDeps, request: Request, userId: string): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return errorResponse(body.error)

  const change: MemberChange = {}
  if ('role' in body.value) {
    if (!isSlaidsRole(body.value.role)) {
      return errorResponse({ code: 'INVALID_INPUT', message: 'Rollen må være «user» eller «admin».' })
    }
    change.role = body.value.role
  }
  if ('active' in body.value) {
    if (typeof body.value.active !== 'boolean') {
      return errorResponse({ code: 'INVALID_INPUT', message: '«active» må være true eller false.' })
    }
    change.active = body.value.active
  }
  if (change.role === undefined && change.active === undefined) {
    return errorResponse({ code: 'INVALID_INPUT', message: 'Oppgi rolle eller status som skal endres.' })
  }

  const outcome = await deps.store.updateMember(userId, change)
  if (outcome === 'not-found') {
    return errorResponse({ code: 'NOT_FOUND', message: 'Fant ikke brukeren.' })
  }
  if (outcome === 'last-admin') return errorResponse(LAST_ADMIN)
  return ok({ user: await memberById(deps, userId) })
}

async function memberById(deps: AdminApiDeps, userId: string): Promise<AdminUser | null> {
  return (await deps.store.list()).find((user) => user.userId === userId) ?? null
}

async function readJson(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: ApiError }> {
  const read = await readBody(request, { maxRequestBytes: MAX_ADMIN_BODY_BYTES })
  if (!read.ok) return read
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(read.bytes))
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ok: true, value: value as Record<string, unknown> }
    }
  } catch {
    // Falls through to the same answer as a body that is JSON but not an object.
  }
  return { ok: false, error: { code: 'MALFORMED_BODY', message: 'Forventet et JSON-objekt.' } }
}

function ok(data: unknown, status = 200): Response {
  return jsonResponse({ ok: true, data }, status)
}

function methodNotAllowed(allow: string): Response {
  return errorResponse(
    { code: 'METHOD_NOT_ALLOWED', message: `Bruk ${allow} på denne adressen.` },
    { extraHeaders: { Allow: allow } },
  )
}
