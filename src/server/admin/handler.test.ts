// @vitest-environment node
/**
 * Administration on the server: who may do what, and what the answers say.
 *
 * The store here keeps the same rule the database trigger keeps — there is
 * always an active administrator — so the handler is tested against the
 * refusal it will really meet. The rule itself is proven against Postgres in
 * `supabase/tests/access.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest'
import { AGENT_API_BASE_PATH, AGENT_API_PATH_PARAM } from '../../routing'
import { operations } from '../../agent/registry'
import type { SlaidsRole } from '../../persistence/slaidsUsers'
import { handleAgentRequest, type AgentApiDeps } from '../agent/handler'
import {
  ADMIN_USERS_SUBPATH,
  handleAdminRequest,
  type AdminApiDeps,
  type AdminUser,
  type AdminUserStore,
  type MemberChange,
} from './handler'

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OUTSIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NEWCOMER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** A JWT-shaped string per user; what it "is" is up to `sessionUser` below. */
const jwtFor = (userId: string): string => `h.${btoa(userId).replace(/=+$/, '')}.s`

class MemoryStore implements AdminUserStore {
  readonly members = new Map<string, { role: SlaidsRole; active: boolean; createdBy: string | null }>()
  readonly authUsers = new Map<string, string>([
    ['admin@example.no', ADMIN],
    ['user@example.no', USER],
    ['outsider@example.no', OUTSIDER],
  ])
  readonly created: string[] = []

  constructor() {
    this.members.set(ADMIN, { role: 'admin', active: true, createdBy: null })
    this.members.set(USER, { role: 'user', active: true, createdBy: ADMIN })
  }

  async accessOf(userId: string) {
    const member = this.members.get(userId)
    return member ? { role: member.role, active: member.active } : null
  }

  async list(): Promise<AdminUser[]> {
    const emails = new Map([...this.authUsers].map(([email, id]) => [id, email]))
    return [...this.members].map(([userId, member]) => ({
      userId,
      email: emails.get(userId) ?? '',
      role: member.role,
      active: member.active,
      createdAt: '2026-11-09T00:00:00.000Z',
      lastSignInAt: null,
    }))
  }

  async findAuthUser(email: string) {
    return this.authUsers.get(email.toLowerCase()) ?? null
  }

  async createAuthUser(email: string) {
    this.created.push(email)
    this.authUsers.set(email.toLowerCase(), NEWCOMER)
    return NEWCOMER
  }

  async addMember(input: { userId: string; role: SlaidsRole; createdBy: string }) {
    if (this.members.has(input.userId)) return false
    this.members.set(input.userId, { role: input.role, active: true, createdBy: input.createdBy })
    return true
  }

  async updateMember(userId: string, change: MemberChange) {
    const member = this.members.get(userId)
    if (!member) return 'not-found' as const
    const next = { ...member, ...change }
    const otherActiveAdmins = [...this.members].filter(
      ([id, other]) => id !== userId && other.role === 'admin' && other.active,
    )
    const stillAdmin = next.role === 'admin' && next.active
    if (!stillAdmin && otherActiveAdmins.length === 0) return 'last-admin' as const
    this.members.set(userId, next)
    return 'updated' as const
  }
}

function setup() {
  const store = new MemoryStore()
  const sessionUser = vi.fn(async (token: string) => {
    for (const id of [ADMIN, USER, OUTSIDER]) if (token === jwtFor(id)) return id
    return null
  })
  const deps: AdminApiDeps = { sessionUser, store }
  return { store, sessionUser, deps }
}

function request(
  method: string,
  path: string,
  options: { as?: string; token?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = {}
  const token = options.token ?? (options.as ? jwtFor(options.as) : undefined)
  if (token) headers.authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return new Request(`https://slaids.example${AGENT_API_BASE_PATH}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

async function call(deps: AdminApiDeps, method: string, path: string, options: Parameters<typeof request>[2] = {}) {
  const response = await handleAdminRequest(deps, request(method, path, options), path)
  return { status: response.status, body: (await response.json()) as Envelope }
}

interface Envelope {
  ok: boolean
  data?: { users?: AdminUser[]; user?: AdminUser }
  error?: { code: string; message: string }
}

const USERS = ADMIN_USERS_SUBPATH
const member = (id: string) => `${ADMIN_USERS_SUBPATH}/${id}`

describe('hvem som slipper inn', () => {
  it('uten innlogging: 401', async () => {
    const { deps } = setup()
    expect((await call(deps, 'GET', USERS)).status).toBe(401)
  })

  it('et agenttoken spørres aldri om – det er ikke en innlogging', async () => {
    const { deps, sessionUser } = setup()
    const result = await call(deps, 'GET', USERS, { token: 'slaids_at_0123456789012345678901234567890123456789012' })
    expect(result.status).toBe(401)
    expect(sessionUser).not.toHaveBeenCalled()
  })

  it('et token Supabase ikke godtar (eller en OAuth-delegasjon): 401', async () => {
    const { deps } = setup()
    expect((await call(deps, 'GET', USERS, { token: 'x.y.z' })).status).toBe(401)
  })

  it('en verifisering som feiler, er ikke en innlogging', async () => {
    const { deps } = setup()
    deps.sessionUser = async () => {
      throw new Error('auth nede')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(deps, 'GET', USERS, { as: ADMIN })).status).toBe(401)
  })

  it.each([
    ['en vanlig bruker', USER],
    ['en Auth-konto uten Slaids-tilgang', OUTSIDER],
  ])('%s får 403 på alt, og ingenting endres', async (_label, caller) => {
    const { deps, store } = setup()
    const before = JSON.stringify([...store.members])
    expect((await call(deps, 'GET', USERS, { as: caller })).status).toBe(403)
    expect((await call(deps, 'POST', USERS, { as: caller, body: { email: 'x@example.no', role: 'admin' } })).status).toBe(403)
    expect((await call(deps, 'PATCH', member(caller), { as: caller, body: { role: 'admin' } })).status).toBe(403)
    expect(JSON.stringify([...store.members])).toBe(before)
    expect(store.created).toEqual([])
  })

  it('en deaktivert administrator får 403', async () => {
    const { deps, store } = setup()
    store.members.set(USER, { role: 'admin', active: false, createdBy: ADMIN })
    expect((await call(deps, 'GET', USERS, { as: USER })).status).toBe(403)
  })
})

describe('en administrator', () => {
  it('ser brukerne med e-post, rolle og status', async () => {
    const { deps } = setup()
    const result = await call(deps, 'GET', USERS, { as: ADMIN })
    expect(result.status).toBe(200)
    expect(result.body.data?.users).toEqual([
      expect.objectContaining({ userId: ADMIN, email: 'admin@example.no', role: 'admin', active: true }),
      expect.objectContaining({ userId: USER, email: 'user@example.no', role: 'user', active: true }),
    ])
  })

  it('legger til en ny bruker: en Auth-konto uten passord, og vanlig bruker som standard', async () => {
    const { deps, store } = setup()
    const result = await call(deps, 'POST', USERS, { as: ADMIN, body: { email: '  ny@example.no ' } })
    expect(result.status).toBe(201)
    expect(store.created).toEqual(['ny@example.no'])
    expect(result.body.data?.user).toEqual(expect.objectContaining({ userId: NEWCOMER, role: 'user', active: true }))
    expect(store.members.get(NEWCOMER)?.createdBy).toBe(ADMIN)
  })

  it('kan legge til en administrator direkte', async () => {
    const { deps, store } = setup()
    expect((await call(deps, 'POST', USERS, { as: ADMIN, body: { email: 'ny@example.no', role: 'admin' } })).status).toBe(201)
    expect(store.members.get(NEWCOMER)?.role).toBe('admin')
  })

  it('gjenbruker en Auth-konto som finnes fra før, i stedet for å lage en ny', async () => {
    const { deps, store } = setup()
    const result = await call(deps, 'POST', USERS, { as: ADMIN, body: { email: 'OUTSIDER@example.no' } })
    expect(result.status).toBe(201)
    expect(store.created).toEqual([])
    expect(store.members.has(OUTSIDER)).toBe(true)
  })

  it('får 409 for en som allerede er Slaids-bruker', async () => {
    const { deps } = setup()
    const result = await call(deps, 'POST', USERS, { as: ADMIN, body: { email: 'user@example.no' } })
    expect(result.status).toBe(409)
    expect(result.body.error?.code).toBe('ALREADY_MEMBER')
  })

  it.each([
    [{ email: 'ikke-en-adresse' }],
    [{ email: '' }],
    [{ email: 'a@b.no', role: 'owner' }],
    [{ email: `${'a'.repeat(250)}@b.no` }],
  ])('avviser ugyldig innhold: %j', async (body) => {
    const { deps, store } = setup()
    expect((await call(deps, 'POST', USERS, { as: ADMIN, body })).status).toBe(400)
    expect(store.created).toEqual([])
  })

  it('avviser en kropp som ikke er JSON', async () => {
    const { deps } = setup()
    const response = await handleAdminRequest(
      deps,
      new Request(`https://slaids.example${AGENT_API_BASE_PATH}${USERS}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jwtFor(ADMIN)}` },
        body: 'ikke json',
      }),
      USERS,
    )
    expect(response.status).toBe(400)
  })

  it('gir og fjerner administratorrollen', async () => {
    const { deps, store } = setup()
    const promoted = await call(deps, 'PATCH', member(USER), { as: ADMIN, body: { role: 'admin' } })
    expect(promoted.status).toBe(200)
    expect(promoted.body.data?.user?.role).toBe('admin')
    expect((await call(deps, 'PATCH', member(USER), { as: ADMIN, body: { role: 'user' } })).status).toBe(200)
    expect(store.members.get(USER)?.role).toBe('user')
  })

  it('deaktiverer og reaktiverer en konto', async () => {
    const { deps, store } = setup()
    expect((await call(deps, 'PATCH', member(USER), { as: ADMIN, body: { active: false } })).status).toBe(200)
    expect(store.members.get(USER)?.active).toBe(false)
    expect((await call(deps, 'PATCH', member(USER), { as: ADMIN, body: { active: true } })).status).toBe(200)
    expect(store.members.get(USER)?.active).toBe(true)
  })

  it.each([[{ role: 'user' }], [{ active: false }]])(
    'kan ikke fjerne den siste aktive administratoren: %j',
    async (body) => {
      const { deps, store } = setup()
      const result = await call(deps, 'PATCH', member(ADMIN), { as: ADMIN, body })
      expect(result.status).toBe(409)
      expect(result.body.error?.code).toBe('LAST_ACTIVE_ADMIN')
      expect(store.members.get(ADMIN)).toEqual({ role: 'admin', active: true, createdBy: null })
    },
  )

  it('kan trekke seg selv tilbake når en annen administrator finnes', async () => {
    const { deps, store } = setup()
    await call(deps, 'PATCH', member(USER), { as: ADMIN, body: { role: 'admin' } })
    expect((await call(deps, 'PATCH', member(ADMIN), { as: ADMIN, body: { role: 'user' } })).status).toBe(200)
    expect(store.members.get(ADMIN)?.role).toBe('user')
  })

  it.each([[{}], [{ role: 'owner' }], [{ active: 'nei' }]])('avviser en endring som ikke sier noe gyldig: %j', async (body) => {
    const { deps } = setup()
    expect((await call(deps, 'PATCH', member(USER), { as: ADMIN, body })).status).toBe(400)
  })

  it('404 for en bruker som ikke finnes, og for en adresse som ikke er en bruker', async () => {
    const { deps } = setup()
    expect((await call(deps, 'PATCH', member(NEWCOMER), { as: ADMIN, body: { active: false } })).status).toBe(404)
    expect((await call(deps, 'GET', `${USERS}/ikke-en-uuid`, { as: ADMIN })).status).toBe(404)
  })

  it('405 for metoder adressen ikke har', async () => {
    const { deps } = setup()
    expect((await call(deps, 'DELETE', USERS, { as: ADMIN })).status).toBe(405)
    expect((await call(deps, 'GET', member(USER), { as: ADMIN })).status).toBe(405)
  })

  it('et brukerregister som ikke svarer, gir 502 uten detaljer', async () => {
    const { deps, store } = setup()
    store.list = async () => {
      throw new Error('relation "slaids_users" does not exist')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await call(deps, 'GET', USERS, { as: ADMIN })
    expect(result.status).toBe(502)
    expect(JSON.stringify(result.body)).not.toContain('relation')
  })
})

describe('administrasjon er ikke en del av agent-API-et', () => {
  function agentDeps(admin?: AdminApiDeps): AgentApiDeps {
    return {
      authenticate: async () => ({ ok: false, reason: 'unknown' }),
      contextFor: () => {
        throw new Error('ikke i bruk')
      },
      audit: { record: async () => {} },
      maxRequestBytes: 1024,
      now: () => new Date('2026-11-09T00:00:00Z'),
      ...(admin ? { admin } : {}),
    }
  }

  it('nås gjennom den samme funksjonen, også via Vercel-rewriten', async () => {
    const { deps } = setup()
    const direct = await handleAgentRequest(agentDeps(deps), request('GET', USERS, { as: ADMIN }))
    expect(direct.status).toBe(200)
    const rewritten = new Request(
      `https://slaids.example${AGENT_API_BASE_PATH}?${AGENT_API_PATH_PARAM}=${encodeURIComponent(USERS)}`,
      { headers: { authorization: `Bearer ${jwtFor(ADMIN)}` } },
    )
    expect((await handleAgentRequest(agentDeps(deps), rewritten)).status).toBe(200)
  })

  it('et agenttoken med alle scopes kommer ikke inn', async () => {
    const { deps } = setup()
    const withToken = agentDeps(deps)
    withToken.authenticate = async () => ({
      ok: true,
      principal: { kind: 'agent_token', ownerId: ADMIN, scopes: ['presentations:read'], tokenId: 't', tokenName: 'n' },
    })
    const response = await handleAgentRequest(
      withToken,
      request('GET', USERS, { token: 'slaids_at_0123456789012345678901234567890123456789012' }),
    )
    expect(response.status).toBe(401)
  })

  it('finnes ikke i en installasjon uten administrasjon', async () => {
    expect((await handleAgentRequest(agentDeps(), request('GET', USERS, { as: ADMIN }))).status).toBe(404)
  })

  it('ingen agentoperasjon eller MCP-verktøy handler om brukere eller roller', () => {
    for (const operation of operations) {
      expect(operation.name).not.toMatch(/admin|user|role|member/i)
    }
  })
})
