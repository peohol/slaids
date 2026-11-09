/**
 * A stand-in for Slaids' Supabase project, served to the browser through
 * Playwright routes.
 *
 * The Supabase-mode build the sign-in suite runs against points at
 * `SUPABASE_E2E_URL`, a host that does not exist; every request to it lands
 * here. Nothing reaches a real project and no email is ever sent: a «sent» code
 * is put in `outbox`, where the test reads it the way a person reads their
 * inbox.
 *
 * It answers in Supabase's own wire format — GoTrue's error bodies and codes,
 * PostgREST's filters and single-object negotiation — so what is under test is
 * the real `@supabase/supabase-js` in the real bundle, not a mock of it. Row
 * level security is modelled as the migrations define it: a request only ever
 * sees its own rows, and only while its user is an active member of
 * `slaids_users`.
 */

import type { BrowserContext, Route } from '@playwright/test'
import type { AdminUser, MemberChange } from '../src/persistence/adminUsers'
import type { SlaidsRole } from '../src/persistence/slaidsUsers'
import { ADMIN_USERS_PATH } from '../src/routing'

export const SUPABASE_E2E_URL = 'https://e2e-stub.supabase.invalid'
export const SUPABASE_E2E_KEY = 'sb_publishable_e2e_stub'

const CODE_LENGTH = 6

type Row = Record<string, unknown>

export interface StubUser {
  id: string
  email: string
}

interface SentCode {
  email: string
  code: string
  sentAt: number
  expired: boolean
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** A JWT-shaped token. Nothing verifies its signature; the stub reads `sub`. */
function accessToken(user: StubUser): string {
  const now = Math.floor(Date.now() / 1000)
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }),
    'stub-signature',
  ].join('.')
}

function subjectOf(authorization: string | undefined): string | null {
  const token = authorization?.replace(/^Bearer /, '')
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: unknown }
    return typeof claims.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

/** GoTrue's error body, as API version 2024-01-01 sends it. */
function authError(route: Route, status: number, code: string, message: string) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'x-supabase-api-version': '2024-01-01',
      // As Supabase does: without it, auth-js cannot read the version and
      // falls back to the legacy error shape.
      'access-control-expose-headers': 'x-supabase-api-version',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify({ code, msg: message, message }),
  })
}

function json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', ...headers },
    body: body === undefined ? '' : JSON.stringify(body),
  })
}

/** One PostgREST filter from the query string: `col=eq.v`, `col=is.null`, … */
function matches(row: Row, column: string, expression: string): boolean {
  const negated = expression.startsWith('not.')
  const [operator, ...rest] = (negated ? expression.slice(4) : expression).split('.')
  const operand = rest.join('.')
  const value = row[column]
  let result: boolean
  switch (operator) {
    case 'eq':
      result = String(value) === operand
      break
    case 'is':
      result = operand === 'null' ? value === null || value === undefined : String(value) === operand
      break
    case 'in':
      result = operand
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((entry) => entry.replace(/^"|"$/g, ''))
        .includes(String(value))
      break
    case 'gte':
      result = String(value) >= operand
      break
    case 'lt':
      result = String(value) < operand
      break
    default:
      throw new Error(`supabaseStub: filteret «${expression}» er ikke støttet`)
  }
  return negated ? !result : result
}

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function project(row: Row, select: string | null): Row {
  if (!select || select === '*') return { ...row }
  return Object.fromEntries(
    select
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
      .map((column) => [column, row[column] ?? null]),
  )
}

/** Defaults the database fills in, per table. */
const DEFAULTS: Record<string, () => Row> = {
  slaids_presentations: () => ({
    version: 1,
    deleted_at: null,
    is_shared: false,
    is_published: false,
    share_token: null,
    shared_document: null,
    folder_id: null,
  }),
}

export class SupabaseStub {
  readonly users: StubUser[] = []
  /** Every code «emailed», oldest first. */
  readonly outbox: SentCode[] = []
  /** `public.slaids_users`, keyed by user id. */
  readonly access = new Map<string, { role: SlaidsRole; active: boolean }>()
  /** Supabase's minimum interval between two codes to one address. */
  cooldownSeconds = 60
  private readonly tables = new Map<string, Row[]>()

  /** An Auth user, and — unless `member` is false — a Slaids user too. */
  addUser(
    email: string,
    { role = 'user', active = true, member = true }: { role?: SlaidsRole; active?: boolean; member?: boolean } = {},
  ): StubUser {
    const user = { id: crypto.randomUUID(), email }
    this.users.push(user)
    if (member) this.access.set(user.id, { role, active })
    return user
  }

  setActive(user: StubUser, active: boolean): void {
    const entry = this.access.get(user.id)
    if (!entry) throw new Error(`${user.email} er ikke Slaids-bruker`)
    entry.active = active
  }

  /** The code in the newest email to `email`. */
  latestCode(email: string): string {
    const sent = this.outbox.filter((entry) => entry.email === email).at(-1)
    if (!sent) throw new Error(`Ingen kode er sendt til ${email}`)
    return sent.code
  }

  /** Let every code sent so far run out, as an hour passing would. */
  expireCodes(): void {
    for (const sent of this.outbox) sent.expired = true
  }

  rows(table: string): Row[] {
    let rows = this.tables.get(table)
    if (!rows) this.tables.set(table, (rows = []))
    return rows
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route(`${SUPABASE_E2E_URL}/**`, (route) => this.handle(route))
    await context.route((url) => url.pathname.startsWith(ADMIN_USERS_PATH), (route) => this.admin(route))
  }

  /**
   * Slaids' own administration server, over the same users: what
   * `src/server/admin/handler.ts` answers, in its envelope. Like the server it
   * lets only an active administrator in; the finer rules (the last
   * administrator, input checks) are the server's and the database's tests.
   */
  private async admin(route: Route): Promise<void> {
    const request = route.request()
    const ok = (data: unknown) => json(route, 200, { ok: true, data })
    const refuse = (status: number, code: string, message: string) =>
      json(route, status, { ok: false, error: { code, message } })

    const caller = this.access.get(subjectOf(request.headers().authorization) ?? '')
    if (!caller?.active || caller.role !== 'admin') {
      return refuse(403, 'FORBIDDEN', 'Bare aktive administratorer kan administrere brukere.')
    }

    const rest = new URL(request.url()).pathname.slice(ADMIN_USERS_PATH.length)
    if (rest === '' && request.method() === 'GET') {
      return ok({ users: this.users.filter((user) => this.access.has(user.id)).map((user) => this.adminUser(user)) })
    }
    if (rest === '' && request.method() === 'POST') {
      const { email, role } = request.postDataJSON() as { email: string; role: SlaidsRole }
      const user = this.users.find((entry) => entry.email === email) ?? this.addUser(email, { member: false })
      if (this.access.has(user.id)) return refuse(409, 'ALREADY_MEMBER', `${email} har allerede tilgang.`)
      this.access.set(user.id, { role, active: true })
      return ok({ user: this.adminUser(user) })
    }
    const target = this.users.find((user) => `/${user.id}` === rest && this.access.has(user.id))
    if (target && request.method() === 'PATCH') {
      Object.assign(this.access.get(target.id)!, request.postDataJSON() as MemberChange)
      return ok({ user: this.adminUser(target) })
    }
    return refuse(404, 'NOT_FOUND', 'Fant ikke brukeren.')
  }

  private adminUser(user: StubUser): AdminUser {
    const { role, active } = this.access.get(user.id)!
    return { userId: user.id, email: user.email, role, active, createdAt: new Date(0).toISOString(), lastSignInAt: null }
  }

  private isActiveMember(userId: string | null): boolean {
    return userId !== null && this.access.get(userId)?.active === true
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,HEAD,OPTIONS',
          'access-control-allow-headers': '*',
        },
      })
    }
    const url = new URL(request.url())
    if (url.pathname.startsWith('/auth/v1/')) return this.auth(route, url)
    if (url.pathname.startsWith('/rest/v1/')) return this.rest(route, url)
    if (url.pathname.startsWith('/storage/v1/object/list/')) return json(route, 200, [])
    return json(route, 404, { message: `supabaseStub: ${request.method()} ${url.pathname}` })
  }

  private async auth(route: Route, url: URL): Promise<void> {
    const request = route.request()
    const path = url.pathname.slice('/auth/v1'.length)
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    const caller = this.users.find((user) => user.id === subjectOf(request.headers().authorization))

    if (path === '/otp' && request.method() === 'POST') {
      const email = String(body.email ?? '')
      const user = this.users.find((entry) => entry.email === email)
      if (!user) {
        // `shouldCreateUser: false` and no such account.
        if (body.create_user !== false) throw new Error('Slaids må aldri be Supabase opprette en bruker')
        return authError(route, 422, 'otp_disabled', 'Signups not allowed for otp')
      }
      const previous = this.outbox.filter((entry) => entry.email === email).at(-1)
      const elapsed = previous ? (Date.now() - previous.sentAt) / 1000 : Infinity
      if (elapsed < this.cooldownSeconds) {
        const wait = Math.ceil(this.cooldownSeconds - elapsed)
        return authError(
          route,
          429,
          'over_email_send_rate_limit',
          `For security purposes, you can only request this after ${wait} seconds.`,
        )
      }
      // A new code replaces the last one, as in Supabase.
      for (const sent of this.outbox) if (sent.email === email) sent.expired = true
      const code = String(Math.floor(Math.random() * 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
      this.outbox.push({ email, code, sentAt: Date.now(), expired: false })
      return json(route, 200, {})
    }

    if (path === '/verify' && request.method() === 'POST') {
      const email = String(body.email ?? '')
      const sent = this.outbox.filter((entry) => entry.email === email).at(-1)
      const user = this.users.find((entry) => entry.email === email)
      if (body.type !== 'email' || !user || !sent || sent.expired || sent.code !== body.token) {
        return authError(route, 403, 'otp_expired', 'Token has expired or is invalid')
      }
      sent.expired = true
      return json(route, 200, this.session(user))
    }

    if (path === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const user = this.users.find((entry) => `refresh-${entry.id}` === body.refresh_token)
      if (!user) return authError(route, 400, 'refresh_token_not_found', 'Invalid Refresh Token')
      return json(route, 200, this.session(user))
    }

    if (path === '/user') {
      if (!caller) return authError(route, 401, 'bad_jwt', 'invalid JWT')
      return json(route, 200, this.userRecord(caller))
    }

    if (path === '/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })

    const authorization = /^\/oauth\/authorizations\/([^/]+)$/.exec(path)
    if (authorization && caller) {
      return json(route, 200, {
        authorization_id: authorization[1],
        client: { id: 'client-1', name: 'Testklient', uri: '', logo_uri: '' },
        redirect_uri: 'https://client.example/callback',
        scope: 'openid',
        user: { id: caller.id, email: caller.email },
      })
    }

    return json(route, 404, { message: `supabaseStub: auth ${path}` })
  }

  private userRecord(user: StubUser) {
    return {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    }
  }

  private session(user: StubUser) {
    return {
      access_token: accessToken(user),
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `refresh-${user.id}`,
      user: this.userRecord(user),
    }
  }

  private async rest(route: Route, url: URL): Promise<void> {
    const request = route.request()
    const table = url.pathname.slice('/rest/v1/'.length)
    const userId = subjectOf(request.headers().authorization)
    const single = (request.headers().accept ?? '').includes('vnd.pgrst.object')
    const representation = (request.headers().prefer ?? '').includes('return=representation')
    const select = url.searchParams.get('select')

    if (table.startsWith('rpc/')) return json(route, 200, null)

    // Row level security, as the migrations write it.
    const visible = (row: Row): boolean =>
      table === 'slaids_users'
        ? row.user_id === userId
        : this.isActiveMember(userId) && row.owner_id === userId
    const filtered = (): Row[] =>
      this.rows(table).filter(
        (row) =>
          visible(row) &&
          [...url.searchParams].every(
            ([column, expression]) => RESERVED_PARAMS.has(column) || matches(row, column, expression),
          ),
      )
    const answer = (rows: Row[], status = 200) => {
      const projected = rows.map((row) => project(row, select))
      if (!single) return json(route, status, projected)
      if (projected.length !== 1) {
        return json(route, 406, {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${projected.length} rows`,
          hint: null,
        })
      }
      return json(route, status, projected[0])
    }
    const forbidden = () =>
      json(route, 403, {
        code: '42501',
        message: `new row violates row-level security policy for table "${table}"`,
        details: null,
        hint: null,
      })

    if (table === 'slaids_users') {
      // Seeded from `access`, so a test changes a user's status in one place.
      this.tables.set(
        table,
        [...this.access].map(([id, entry]) => ({ user_id: id, role: entry.role, active: entry.active })),
      )
      if (request.method() !== 'GET' && request.method() !== 'HEAD') return forbidden()
    }

    switch (request.method()) {
      case 'GET':
      case 'HEAD':
        return answer(filtered())
      case 'POST': {
        const payload = request.postDataJSON() as Row | Row[]
        const inserted: Row[] = []
        for (const values of Array.isArray(payload) ? payload : [payload]) {
          if (!this.isActiveMember(userId) || values.owner_id !== userId) return forbidden()
          if (this.rows(table).some((row) => row.id === values.id)) {
            return json(route, 409, {
              code: '23505',
              message: 'duplicate key value violates unique constraint',
              details: null,
              hint: null,
            })
          }
          const row = { ...(DEFAULTS[table]?.() ?? {}), ...values }
          this.rows(table).push(row)
          inserted.push(row)
        }
        return representation ? answer(inserted, 201) : json(route, 201, undefined)
      }
      case 'PATCH': {
        const changes = request.postDataJSON() as Row
        if ('owner_id' in changes && changes.owner_id !== userId) return forbidden()
        const updated = filtered()
        for (const row of updated) {
          Object.assign(row, changes)
          // The version trigger on `slaids_presentations`.
          if (typeof row.version === 'number' && table === 'slaids_presentations') row.version += 1
        }
        return representation ? answer(updated) : json(route, 204, undefined)
      }
      case 'DELETE': {
        const removed = filtered()
        this.tables.set(
          table,
          this.rows(table).filter((row) => !removed.includes(row)),
        )
        return representation ? answer(removed) : json(route, 204, undefined)
      }
      default:
        return json(route, 405, { message: `supabaseStub: ${request.method()}` })
    }
  }
}

/** The key auth-js stores the session under for `SUPABASE_E2E_URL`. */
export const SESSION_STORAGE_KEY = `sb-${new URL(SUPABASE_E2E_URL).hostname.split('.')[0]}-auth-token`
