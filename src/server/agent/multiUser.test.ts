// @vitest-environment node
/**
 * Several Slaids users behind one agent API.
 *
 * Wired by `wireAgentApi` — the function production calls — so every step a
 * real request takes is the real one: the agent-token lookup by hash, the
 * OAuth verification, the access-list check, the repository pinned to the
 * principal's owner, and the audit. Only the database is a stand-in
 * (`createFakeDatabase`): one set of tables holding every user's rows, as the
 * server's secret-key client sees them, with no row level security narrowing
 * anything. What keeps one user out of another's work here is exactly what
 * keeps them out in production.
 *
 * The questions, in the order a reviewer would ask them:
 *
 *  - can user A read, change or delete user B's presentations, folders or
 *    files, over REST or MCP, by naming B's ids? (No — and B's rows are
 *    byte-for-byte unchanged afterwards.)
 *  - can A reach B's agent tokens, or anyone's administration? (There is no
 *    operation or tool for either.)
 *  - does deactivation stop a user's agent tokens and OAuth grants on the very
 *    next call, and does reactivation bring them back?
 *  - does Peder's existing integration — an old token, the old Vercel switch —
 *    keep working?
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { AGENT_TOOL_PREFIX } from '../../agent/registry'
import type { AgentScope } from '../../agent/types'
import { createPresentation } from '../../domain/presentation'
import { presentationRevision } from '../../domain/revision'
import {
  AGENT_AUDIT_TABLE,
  AGENT_TOKENS_TABLE,
  createAgentToken,
  hashAgentToken,
} from '../../persistence/agentTokens'
import { SLAIDS_USERS_TABLE } from '../../persistence/slaidsUsers'
import {
  ASSETS_TABLE,
  FOLDERS_TABLE,
  PRESENTATIONS_TABLE,
} from '../../persistence/supabaseRepository'
import {
  createFakeDatabase,
  createFakeSupabase,
  type FakeRow,
  type FakeSupabase,
} from '../../persistence/supabaseTestClient'
import { AGENT_API_BASE_PATH, AGENT_MCP_PATH } from '../../routing'
import { readAgentApiConfig, type AgentApiConfig } from './config'
import { handleAgentRequest, type AgentApiDeps } from './handler'
import { wireAgentApi } from './index'
import { OAUTH_OWNERS_VAR, OAUTH_SWITCH_VAR } from './oauth'
import {
  TEST_SUPABASE_URL,
  testAuthorizationServer,
  type TestAuthorizationServer,
} from './testOAuth'

const ORIGIN = 'https://www.slaids.example'

/** Peder: the existing account, an administrator from the start. */
const PEDER = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'
/** A second Slaids user, added by Peder. */
const ANNE = '0b6c3c1e-4d4e-4f7a-9b55-2f0a6f3b9c01'
/** A user of another app in the same Supabase project. Not a Slaids user. */
const STRANGER = '7e1d2c3b-aaaa-4bbb-8ccc-9ddddddddddd'

const ALL_SCOPES: AgentScope[] = ['presentations:read', 'presentations:write', 'assets:write', 'sharing:write']

const ANNES_FOLDER = 'fl_annes'
const ANNES_ASSET = 'a_annes'

interface World {
  deps: AgentApiDeps
  fake: FakeSupabase
  tables: Record<string, FakeRow[]>
  authorization: TestAuthorizationServer
  tokens: Record<string, string>
}

async function tokenRow(ownerId: string, name: string, token: string): Promise<FakeRow> {
  return {
    id: `tok_${name}`,
    owner_id: ownerId,
    name,
    scopes: ALL_SCOPES,
    token_hash: await hashAgentToken(token),
    created_at: '2026-09-03T10:00:00.000Z',
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
  }
}

async function world(
  config: Partial<AgentApiConfig> = {},
  seed: Record<string, FakeRow[]> = {},
): Promise<World> {
  const authorization = await testAuthorizationServer()
  const tokens = { peder: createAgentToken(), anne: createAgentToken(), stranger: createAgentToken() }
  const database = createFakeDatabase({
    [SLAIDS_USERS_TABLE]: [
      { user_id: PEDER, role: 'admin', active: true },
      { user_id: ANNE, role: 'user', active: true },
    ],
    [AGENT_TOKENS_TABLE]: [
      await tokenRow(PEDER, 'peder', tokens.peder),
      await tokenRow(ANNE, 'anne', tokens.anne),
      // A token row for someone not on the access list: what a user of
      // another app would have if one ever existed. It must be worth nothing.
      await tokenRow(STRANGER, 'stranger', tokens.stranger),
    ],
    ...seed,
  })
  const fake = createFakeSupabase({ session: null, resolve: database.resolve })
  const deps = wireAgentApi({
    client: fake.client,
    config: {
      supabaseUrl: TEST_SUPABASE_URL,
      secretKey: 'sb_secret_test',
      maxRequestBytes: 4 * 1024 * 1024,
      publicOrigin: ORIGIN,
      // Every scope, so a refusal below is about whose work it is and never
      // about what the grant may do.
      oauth: authorization.config({ defaultScopes: ALL_SCOPES }),
      ...config,
    },
    jwks: authorization.jwks(),
  })
  return { deps, fake, tables: database.tables, authorization, tokens }
}

interface RestAnswer {
  status: number
  body: { ok: boolean; revision?: string; data?: Record<string, unknown>; error?: { code: string } }
}

async function rest(
  deps: AgentApiDeps,
  token: string,
  operation: string,
  input: Record<string, unknown> = {},
): Promise<RestAnswer> {
  const response = await handleAgentRequest(
    deps,
    new Request(`${ORIGIN}${AGENT_API_BASE_PATH}/operations/${operation}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
    }),
  )
  return { status: response.status, body: (await response.json()) as RestAnswer['body'] }
}

let rpcId = 0

/** One MCP message. `status` is the HTTP answer; `body` the JSON-RPC one, when there is one. */
async function mcp(
  deps: AgentApiDeps,
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  rpcId += 1
  const response = await handleAgentRequest(
    deps,
    new Request(`${ORIGIN}${AGENT_MCP_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, ...(params ? { params } : {}) }),
    }),
  )
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null }
}

/** A tool call over MCP: the Slaids error code it was refused with, or `null` when it ran. */
async function toolRefusal(
  deps: AgentApiDeps,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  const answer = await mcp(deps, token, 'tools/call', { name: `${AGENT_TOOL_PREFIX}${name}`, arguments: args })
  expect(answer.status).toBe(200)
  const body = answer.body as {
    result?: { isError?: boolean; structuredContent?: { error?: { code: string } } }
    error?: { data?: { code: string } }
  }
  if (body.error) return body.error.data?.code ?? 'PROTOCOL_ERROR'
  if (body.result?.isError) return body.result.structuredContent?.error?.code ?? 'TOOL_ERROR'
  return null
}

function ownedBy(tables: Record<string, FakeRow[]>, owner: string): Record<string, FakeRow[]> {
  return Object.fromEntries(
    [PRESENTATIONS_TABLE, FOLDERS_TABLE, ASSETS_TABLE, AGENT_TOKENS_TABLE].map((table) => [
      table,
      structuredClone((tables[table] ?? []).filter((row) => row.owner_id === owner)),
    ]),
  )
}

function setActive(tables: Record<string, FakeRow[]>, userId: string, active: boolean): void {
  const row = tables[SLAIDS_USERS_TABLE].find((entry) => entry.user_id === userId)
  if (!row) throw new Error(`Ingen rad for ${userId}`)
  row.active = active
}

function auditFor(tables: Record<string, FakeRow[]>, owner: string): FakeRow[] {
  return (tables[AGENT_AUDIT_TABLE] ?? []).filter((row) => row.owner_id === owner)
}

/* ------------------------------------------------------------------ *
 * Isolation
 * ------------------------------------------------------------------ */

describe('to brukere, ett agent-API', () => {
  let w: World
  /** Anne's work, created through the API with Anne's own token. */
  let theirs: { presentationId: string; revision: string; folderId: string; assetId: string }

  beforeEach(async () => {
    // Seeded as rows rather than created over the API: the stand-in database
    // has no version trigger, and what is under test is the other user's
    // reach, not Anne's own writes.
    const document = createPresentation({ title: 'Annes dekk', folderId: ANNES_FOLDER })
    theirs = {
      presentationId: document.id,
      revision: presentationRevision(document),
      folderId: ANNES_FOLDER,
      assetId: ANNES_ASSET,
    }
    w = await world({}, {
      [PRESENTATIONS_TABLE]: [
        {
          id: document.id,
          owner_id: ANNE,
          title: document.title,
          folder_id: ANNES_FOLDER,
          document,
          slide_count: document.slides.length,
          version: 1,
          deleted_at: null,
          is_shared: false,
          is_published: false,
        },
      ],
      [FOLDERS_TABLE]: [
        { id: ANNES_FOLDER, owner_id: ANNE, name: 'Annes mappe', created_at: '2026-09-03T10:00:00.000Z' },
      ],
      [ASSETS_TABLE]: [
        {
          id: ANNES_ASSET,
          owner_id: ANNE,
          presentation_id: document.id,
          ref: { id: ANNES_ASSET, name: 'figur.svg', mimeType: 'image/svg+xml', byteSize: 10, width: 10, height: 10, isVector: true },
          object_path: `${ANNE}/${document.id}/${ANNES_ASSET}`,
        },
      ],
    })
  })

  /** Every way Peder's token could try to touch Anne's work by naming her ids. */
  function attempts(): [string, Record<string, unknown>][] {
    const { presentationId, revision, folderId, assetId } = theirs
    return [
      ['get_presentation', { presentationId }],
      ['list_assets', { presentationId }],
      ['set_presentation_title', { presentationId, expectedRevision: revision, title: 'Overtatt' }],
      ['move_presentation', { presentationId, expectedRevision: revision, folderId: null }],
      ['duplicate_presentation', { presentationId }],
      ['delete_presentation', { presentationId, expectedRevision: revision }],
      ['delete_asset', { presentationId, expectedRevision: revision, assetId }],
      ['rename_folder', { folderId, name: 'Overtatt' }],
      ['delete_folder', { folderId }],
      ['get_sharing', { presentationId }],
      ['set_sharing', { presentationId, expectedRevision: revision, shared: true }],
    ]
  }

  it('ser bare sine egne presentasjoner og mapper i listene', async () => {
    const mine = await rest(w.deps, w.tokens.peder, 'create_presentation', { title: 'Peders dekk' })
    expect(mine.body.ok).toBe(true)

    const listed = await rest(w.deps, w.tokens.peder, 'list_presentations')
    const titles = (listed.body.data as { presentations: { title: string }[] }).presentations.map(
      (entry) => entry.title,
    )
    expect(titles).toEqual(['Peders dekk'])

    const folders = await rest(w.deps, w.tokens.peder, 'list_folders')
    expect((folders.body.data as { folders: unknown[] }).folders).toEqual([])

    // And over MCP, the same answer from the same store.
    const tool = await mcp(w.deps, w.tokens.peder, 'tools/call', {
      name: `${AGENT_TOOL_PREFIX}list_presentations`,
      arguments: {},
    })
    const structured = (tool.body as { result: { structuredContent: { presentations: { title: string }[] } } })
      .result.structuredContent
    expect(structured.presentations.map((entry) => entry.title)).toEqual(['Peders dekk'])
  })

  it('kan ikke lese, endre eller slette en annen brukers arbeid over REST', async () => {
    const before = ownedBy(w.tables, ANNE)
    for (const [operation, input] of attempts()) {
      const answer = await rest(w.deps, w.tokens.peder, operation, input)
      expect(answer.body.ok, `${operation} skulle vært avvist`).toBe(false)
      expect(answer.body.error?.code, operation).toMatch(/NOT_FOUND$/)
    }
    expect(ownedBy(w.tables, ANNE)).toEqual(before)
  })

  it('kan ikke lese, endre eller slette en annen brukers arbeid over MCP', async () => {
    const before = ownedBy(w.tables, ANNE)
    for (const [operation, input] of attempts()) {
      expect(await toolRefusal(w.deps, w.tokens.peder, operation, input), operation).toMatch(/NOT_FOUND$/)
    }
    expect(ownedBy(w.tables, ANNE)).toEqual(before)
  })

  it('kan ikke flytte sin egen presentasjon inn i en annen brukers mappe', async () => {
    const mine = await rest(w.deps, w.tokens.peder, 'create_presentation', { title: 'Peders dekk' })
    const presentationId = (mine.body.data as { presentationId: string }).presentationId
    const before = ownedBy(w.tables, ANNE)

    const moved = await rest(w.deps, w.tokens.peder, 'move_presentation', {
      presentationId,
      expectedRevision: mine.body.revision,
      folderId: theirs.folderId,
    })
    expect(moved.body.error?.code).toBe('FOLDER_NOT_FOUND')
    expect(ownedBy(w.tables, ANNE)).toEqual(before)
  })

  it('henter aldri en annen brukers fil fra lagringen', async () => {
    for (const [operation, input] of attempts()) await rest(w.deps, w.tokens.peder, operation, input)
    // Nothing Peder's calls sent to storage named a path under Anne's prefix:
    // no download, no removal, no listing.
    expect(w.fake.storageCalls.filter((call) => call.paths.some((path) => path.startsWith(`${ANNE}/`)))).toEqual([])
  })

  it('kan ikke handle som en annen bruker med et OAuth-token', async () => {
    // A verified token for Peder is Peder, whatever the request says.
    const token = await w.authorization.sign({ sub: PEDER })
    const before = ownedBy(w.tables, ANNE)
    for (const [operation, input] of attempts()) {
      const answer = await rest(w.deps, token, operation, input)
      expect(answer.body.error?.code, operation).toMatch(/NOT_FOUND$/)
    }
    expect(ownedBy(w.tables, ANNE)).toEqual(before)
  })

  it('skriver hver brukers kall i hver brukers egen logg', async () => {
    await rest(w.deps, w.tokens.peder, 'list_presentations')
    const pedersRows = auditFor(w.tables, PEDER)
    expect(pedersRows.map((row) => row.operation)).toEqual(['list_presentations'])
    expect(auditFor(w.tables, ANNE).every((row) => row.token_id === 'tok_anne')).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * Tokens and administration are not agent operations
 * ------------------------------------------------------------------ */

describe('tokens og administrasjon', () => {
  const FORBIDDEN_NAME = /token|admin|user|bruker|role|rolle|member|medlem/i

  it('finnes verken som REST-operasjon eller MCP-verktøy', async () => {
    const w = await world()
    const catalogue = await handleAgentRequest(
      w.deps,
      new Request(`${ORIGIN}${AGENT_API_BASE_PATH}/operations`, {
        headers: { Authorization: `Bearer ${w.tokens.peder}`, Accept: 'application/json' },
      }),
    )
    const operations = ((await catalogue.json()) as { data: { operations: { name: string }[] } }).data
      .operations
    expect(operations.length).toBeGreaterThan(0)
    expect(operations.filter((operation) => FORBIDDEN_NAME.test(operation.name))).toEqual([])

    const listed = await mcp(w.deps, w.tokens.peder, 'tools/list')
    const tools = (listed.body as { result: { tools: { name: string }[] } }).result.tools
    expect(tools.length).toBe(operations.length)
    expect(tools.filter((tool) => FORBIDDEN_NAME.test(tool.name))).toEqual([])
  })

  it('svarer ikke på administrasjonsadresser med et agenttoken, selv for en administrator', async () => {
    const w = await world()
    for (const [method, path] of [
      ['GET', '/admin/users'],
      ['POST', '/operations/admin_list_users'],
      ['POST', '/operations/create_user'],
    ] as const) {
      const response = await handleAgentRequest(
        w.deps,
        new Request(`${ORIGIN}${AGENT_API_BASE_PATH}${path}`, {
          method,
          headers: { Authorization: `Bearer ${w.tokens.peder}`, 'Content-Type': 'application/json' },
          ...(method === 'POST' ? { body: '{}' } : {}),
        }),
      )
      expect(response.status, `${method} ${path}`).not.toBe(200)
    }
    // Nothing about anybody's access was read beyond the caller's own row,
    // and nothing at all was written to it.
    const userQueries = w.fake.queries.filter((record) => record.table === SLAIDS_USERS_TABLE)
    expect(userQueries.every((record) => record.op === 'select')).toBe(true)
    expect(
      userQueries.every((record) =>
        record.filters.some((filter) => filter.column === 'user_id' && filter.value === PEDER),
      ),
    ).toBe(true)
  })

  it('lar ikke én brukers token endre en annen brukers tokens', async () => {
    const w = await world()
    const before = ownedBy(w.tables, ANNE)[AGENT_TOKENS_TABLE]
    // There is no token operation to call; the catalogue test above is the
    // proof. What is left is the side effect every call has — `last_used_at` —
    // and it lands on the caller's own token only.
    await rest(w.deps, w.tokens.peder, 'list_presentations')
    expect(ownedBy(w.tables, ANNE)[AGENT_TOKENS_TABLE]).toEqual(before)
    const peders = w.tables[AGENT_TOKENS_TABLE].find((row) => row.id === 'tok_peder')
    expect(peders?.last_used_at).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Deactivation
 * ------------------------------------------------------------------ */

describe('en deaktivert bruker', () => {
  it('stoppes med agenttoken på neste kall, over REST og MCP, og slipper inn igjen ved reaktivering', async () => {
    const w = await world()
    expect((await rest(w.deps, w.tokens.anne, 'list_presentations')).status).toBe(200)

    setActive(w.tables, ANNE, false)
    const refused = await rest(w.deps, w.tokens.anne, 'list_presentations')
    expect(refused.status).toBe(401)
    expect(refused.body.error?.code).toBe('UNAUTHENTICATED')
    expect((await mcp(w.deps, w.tokens.anne, 'tools/list')).status).toBe(401)
    expect(
      (
        await mcp(w.deps, w.tokens.anne, 'tools/call', {
          name: `${AGENT_TOOL_PREFIX}list_presentations`,
          arguments: {},
        })
      ).status,
    ).toBe(401)

    // Her own log says why — the caller was only told 401.
    expect(auditFor(w.tables, ANNE).map((row) => row.error_code)).toContain('OWNER_INACTIVE')

    // Everybody else carries on.
    expect((await rest(w.deps, w.tokens.peder, 'list_presentations')).status).toBe(200)

    // Reactivated: the same token, unchanged, works again.
    setActive(w.tables, ANNE, true)
    expect((await rest(w.deps, w.tokens.anne, 'list_presentations')).status).toBe(200)
  })

  it('stoppes med OAuth på neste kall, selv med et token som ikke er utløpt', async () => {
    const w = await world()
    const token = await w.authorization.sign({ sub: ANNE })
    expect((await rest(w.deps, token, 'list_presentations')).status).toBe(200)

    setActive(w.tables, ANNE, false)
    expect((await rest(w.deps, token, 'list_presentations')).status).toBe(401)
    expect((await mcp(w.deps, token, 'tools/list')).status).toBe(401)
    expect(auditFor(w.tables, ANNE).map((row) => row.error_code)).toContain('OWNER_INACTIVE')

    setActive(w.tables, ANNE, true)
    expect((await rest(w.deps, token, 'list_presentations')).status).toBe(200)
  })

  it('får ikke oppdatert last_used_at på tokenet sitt mens kontoen er deaktivert', async () => {
    const w = await world()
    setActive(w.tables, ANNE, false)
    await rest(w.deps, w.tokens.anne, 'list_presentations')
    const annes = w.tables[AGENT_TOKENS_TABLE].find((row) => row.id === 'tok_anne')
    expect(annes?.last_used_at).toBeNull()
  })
})

describe('en som ikke er Slaids-bruker', () => {
  it('kommer ikke inn med OAuth fra et annet program i prosjektet, og fyller ingen logg', async () => {
    const w = await world()
    const token = await w.authorization.sign({ sub: STRANGER })
    expect((await rest(w.deps, token, 'list_presentations')).status).toBe(401)
    expect((await mcp(w.deps, token, 'tools/list')).status).toBe(401)
    expect(w.tables[AGENT_AUDIT_TABLE] ?? []).toEqual([])
  })

  it('kommer ikke inn med et agenttoken, og fyller ingen logg', async () => {
    const w = await world()
    expect((await rest(w.deps, w.tokens.stranger, 'list_presentations')).status).toBe(401)
    expect(w.tables[AGENT_AUDIT_TABLE] ?? []).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Peder's existing integration
 * ------------------------------------------------------------------ */

describe('Peders eksisterende integrasjon', () => {
  it('virker med et agenttoken laget før flerbrukerstøtten', async () => {
    const w = await world()
    const created = await rest(w.deps, w.tokens.peder, 'create_presentation', { title: 'Som før' })
    expect(created.body.ok).toBe(true)
    const tools = await mcp(w.deps, w.tokens.peder, 'tools/list')
    expect(tools.status).toBe(200)
  })

  it('virker med OAuth slått på med den gamle eierlisten i Vercel', async () => {
    // Peder's production environment, as it is today: the old variable, with
    // his own id in it. It still switches OAuth on; the access list decides.
    const env = {
      SLAIDS_SUPABASE_URL: TEST_SUPABASE_URL,
      SLAIDS_SUPABASE_SECRET_KEY: 'sb_secret_test',
      [OAUTH_OWNERS_VAR]: PEDER,
    }
    const state = readAgentApiConfig(env)
    if (state.kind !== 'configured') throw new Error(`Forventet et oppsett, fikk ${state.kind}`)
    expect(state.config.oauth).not.toBeNull()

    const w = await world({ oauth: state.config.oauth })
    const token = await w.authorization.sign({ sub: PEDER })
    expect((await rest(w.deps, token, 'list_presentations')).status).toBe(200)

    // And the old list no longer limits who gets in: Anne is a Slaids user.
    const annes = await w.authorization.sign({ sub: ANNE })
    expect((await rest(w.deps, annes, 'list_presentations')).status).toBe(200)
  })

  it('virker med den nye bryteren', async () => {
    const state = readAgentApiConfig({
      SLAIDS_SUPABASE_URL: TEST_SUPABASE_URL,
      SLAIDS_SUPABASE_SECRET_KEY: 'sb_secret_test',
      [OAUTH_SWITCH_VAR]: 'on',
    })
    if (state.kind !== 'configured') throw new Error(`Forventet et oppsett, fikk ${state.kind}`)
    const w = await world({ oauth: state.config.oauth })
    const token = await w.authorization.sign({ sub: PEDER })
    expect((await rest(w.deps, token, 'list_presentations')).status).toBe(200)
  })
})
