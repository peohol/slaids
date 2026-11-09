// @vitest-environment node
/**
 * OAuth as a *client* meets it: over the wire, across both transports, against
 * a deployment wired the way production is wired.
 *
 * `src/server/agent/oauth.test.ts` holds the cryptography — what a signature
 * proves, and which forgeries do not. This file holds everything after that,
 * and the sentence it exists to keep true is:
 *
 *   **Two credential families, one authorisation system.**
 *
 * An agent token and a Supabase OAuth access token are two ways to be a caller.
 * Past `authenticateRequest` there is nothing that can tell them apart except
 * the audit, and the tests below are mostly ways of saying that: the same
 * operations, the same scope enforcement, the same repository pinning, the same
 * refusals — reached by two different credentials, and by an unauthenticated
 * client that has to be able to find its way to one.
 *
 * The tokens here are real: signed by an ES256 key pair, verified against a
 * published key set. A deployment that accepted them because a double said so
 * would be testing its own test.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_TOOL_PREFIX, operations } from '../../agent/registry'
import {
  AGENT_API_BASE_PATH,
  AGENT_MCP_PATH,
  MCP_PROTECTED_RESOURCE_METADATA_PATH,
  PROTECTED_RESOURCE_METADATA_PATH,
  canonicalMcpUrl,
} from '../../routing'
import { runOperation } from '../../agent/registry'
import { handleAgentRequest } from '../agent/handler'
import type { OAuthResourceConfig } from '../agent/oauth'
import { oauthAuthenticator } from '../agent/supabase'
import {
  OTHER_OWNER,
  TEST_CLIENT,
  TEST_ISSUER,
  TEST_OWNER,
  testAccessList,
  testAuthorizationServer,
  type TestAuthorizationServer,
  type TokenClaims,
} from '../agent/testOAuth'
import {
  DEFAULT_OWNER,
  ORIGIN,
  TOKEN,
  closeHarnessDatabases,
  harness,
  mcp,
  mcpSend,
  resultOf,
  rest,
  restRaw,
  type Harness,
  type HarnessOptions,
} from './testHarness'

afterEach(closeHarnessDatabases)

/** The canonical origin this deployment answers on, for the metadata. */
const PUBLIC_ORIGIN = 'https://www.slaids.no'

const ANONYMOUS = { token: null } as const

/**
 * A deployment with an authorization server behind it.
 *
 * Wired exactly as `index.ts` wires production: the same `oauthAuthenticator`,
 * the same config object, the same key cache. Only the key set is served from
 * memory rather than from Supabase, and the access list from a map rather than
 * from `slaids_users`; `members` says who is on it (`TEST_OWNER` by default).
 */
async function oauthHarness(
  options: HarnessOptions & {
    config?: Partial<OAuthResourceConfig>
    members?: Record<string, boolean>
  } = {},
): Promise<{ harnessed: Harness; server: TestAuthorizationServer; config: OAuthResourceConfig }> {
  const server = await testAuthorizationServer()
  const config = server.config(options.config)
  const members = testAccessList(options.members)
  const harnessed = harness({
    ...options,
    oauth: config,
    publicOrigin: PUBLIC_ORIGIN,
    authenticateOAuth: oauthAuthenticator(config, members.lookup, () => new Date(), server.jwks()),
  })
  return { harnessed, server, config }
}

/** A GET, unauthenticated, the way a client fetching metadata makes one. */
function get(harnessed: Harness, path: string, origin = ORIGIN): Promise<Response> {
  return handleAgentRequest(harnessed.deps, new Request(`${origin}${path}`))
}

/** One tool call over MCP, with whatever credential the caller names. */
async function callWith(
  harnessed: Harness,
  token: string | null,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Response> {
  return mcpSend(harnessed, 'tools/call', { name, arguments: args }, { token })
}

function anyReadTool(): string {
  const operation = operations.find((entry) => !entry.mutates)
  if (!operation) throw new Error('Registeret har ingen lesende operasjon.')
  return `${AGENT_TOOL_PREFIX}${operation.name}`
}

/* ------------------------------------------------------------------ *
 * Discovery — the part that must work before anybody has a credential
 * ------------------------------------------------------------------ */

describe('protected resource metadata', () => {
  it('svarer på adressen RFC 9728 bygger av ressursens egen sti', async () => {
    const { harnessed, config } = await oauthHarness()
    const response = await get(harnessed, MCP_PROTECTED_RESOURCE_METADATA_PATH)

    expect(response.status).toBe(200)
    const document = (await response.json()) as Record<string, unknown>
    // The resource identifier is the canonical MCP URL, and it is the same
    // string a client must send as `resource` and post its messages to.
    expect(document.resource).toBe(canonicalMcpUrl(PUBLIC_ORIGIN))
    expect(document.resource).toBe(`${PUBLIC_ORIGIN}${AGENT_MCP_PATH}`)
    expect(document.authorization_servers).toEqual([config.issuer])
    expect(document.bearer_methods_supported).toEqual(['header'])
  })

  it('svarer det samme på rot-adressen, som spesifikasjonen ber en klient prøve', async () => {
    const { harnessed } = await oauthHarness()
    const deep = await get(harnessed, MCP_PROTECTED_RESOURCE_METADATA_PATH)
    const root = await get(harnessed, PROTECTED_RESOURCE_METADATA_PATH)

    expect(root.status).toBe(200)
    expect(await root.json()).toEqual(await deep.json())
  })

  it('krever ingen legitimasjon, fordi den er det man leser når man ikke har en', async () => {
    // A metadata document behind authentication is a discovery loop with no
    // exit, and it says nothing an owner owns.
    const { harnessed } = await oauthHarness()
    const anonymous = await get(harnessed, MCP_PROTECTED_RESOURCE_METADATA_PATH)
    expect(anonymous.status).toBe(200)
    expect(harnessed.contextRequests).toBe(0)
    expect(harnessed.audit.entries).toEqual([])
  })

  it('navngir aldri en autorisasjonsserver installasjonen ikke har', async () => {
    // No owner allowlist means no OAuth, and the honest answer to "where is your
    // authorization server" is that there is no such document.
    const withoutOAuth = harness()
    const response = await get(withoutOAuth, MCP_PROTECTED_RESOURCE_METADATA_PATH)
    expect(response.status).toBe(404)
  })

  it('bruker den kanoniske adressen installasjonen er festet til, ikke verten i forespørselen', async () => {
    // A resource identifier is a fixed string in OAuth. Reading it off the
    // request would let a host header decide what Slaids calls itself — and
    // `www.slaids.no` is the address a client must use anyway, since the apex
    // answers 308 and a redirect drops `Authorization` on the way.
    const { harnessed } = await oauthHarness()
    const response = await get(harnessed, MCP_PROTECTED_RESOURCE_METADATA_PATH, 'https://slaids.no')
    const document = (await response.json()) as { resource: string }
    expect(document.resource).toBe(`${PUBLIC_ORIGIN}${AGENT_MCP_PATH}`)
  })

  it('leser adressen av forespørselen når installasjonen ikke har festet en', async () => {
    const server = await testAuthorizationServer()
    const harnessed = harness({ oauth: server.config(), publicOrigin: null })
    const response = await get(harnessed, MCP_PROTECTED_RESOURCE_METADATA_PATH, 'https://preview.example')
    const document = (await response.json()) as { resource: string }
    expect(document.resource).toBe(`https://preview.example${AGENT_MCP_PATH}`)
  })
})

describe('utfordringen på 401', () => {
  it('peker på metadatadokumentet når installasjonen har en autorisasjonsserver', async () => {
    const { harnessed } = await oauthHarness()
    const response = await callWith(harnessed, null, anyReadTool())

    expect(response.status).toBe(401)
    const challenge = response.headers.get('WWW-Authenticate') ?? ''
    expect(challenge).toContain('Bearer')
    expect(challenge).toContain(
      `resource_metadata="${PUBLIC_ORIGIN}${MCP_PROTECTED_RESOURCE_METADATA_PATH}"`,
    )
  })

  it('peker ingen steder når det ikke finnes noe å peke på', async () => {
    // Otherwise every client would be sent on a discovery round trip that ends
    // in a 404.
    const response = await callWith(harness(), null, anyReadTool())
    const challenge = response.headers.get('WWW-Authenticate') ?? ''
    expect(challenge).toContain('Bearer')
    expect(challenge).not.toContain('resource_metadata')
  })

  it('sier «invalid_token» bare når et token faktisk ble avvist', async () => {
    const { harnessed, server } = await oauthHarness()
    const seconds = Math.floor(Date.now() / 1000)
    const expired = await server.sign({ exp: seconds - 1 })

    const nothing = await callWith(harnessed, null, anyReadTool())
    expect(nothing.headers.get('WWW-Authenticate')).not.toContain('error=')

    const refused = await callWith(harnessed, expired, anyReadTool())
    expect(refused.status).toBe(401)
    expect(refused.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
    // And it still points at the metadata, which is what a client needs in order
    // to go and get a new one.
    expect(refused.headers.get('WWW-Authenticate')).toContain('resource_metadata=')
  })
})

describe('verktøykatalogen', () => {
  it('sier om hvert verktøy at det krever OAuth, og hvilke scopes', async () => {
    const { harnessed } = await oauthHarness()
    const tools = resultOf(await mcp(harnessed, 'tools/list', undefined, ANONYMOUS)).tools as {
      name: string
      securitySchemes: { type: string; scopes: string[] }[]
      _meta: Record<string, unknown>
    }[]

    expect(tools.length).toBe(operations.length)
    for (const tool of tools) {
      const operation = operations.find(
        (entry) => `${AGENT_TOOL_PREFIX}${entry.name}` === tool.name,
      )
      expect(operation).toBeDefined()
      // Straight off `operation.scopes` — the same field `authorizeOperation`
      // compares a principal against, so a tool cannot advertise less than it
      // enforces or more.
      expect(tool.securitySchemes).toEqual([{ type: 'oauth2', scopes: [...operation!.scopes] }])
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes)
      expect(tool._meta['slaids/requiredScopes']).toEqual([...operation!.scopes])
    }
  })

  it('er den samme katalogen enten installasjonen har OAuth eller ikke', async () => {
    // The catalogue describes Slaids, never the caller and never the
    // deployment's credentials.
    const { harnessed } = await oauthHarness()
    const withOAuth = resultOf(await mcp(harnessed, 'tools/list', undefined, ANONYMOUS))
    const without = resultOf(await mcp(harness(), 'tools/list', undefined, ANONYMOUS))
    expect(withOAuth).toEqual(without)
  })

  it('er den samme katalogen for et OAuth-token som for ingen', async () => {
    const { harnessed, server } = await oauthHarness()
    const token = await server.sign()
    const anonymous = resultOf(await mcp(harnessed, 'tools/list', undefined, ANONYMOUS))
    const authorised = resultOf(await mcp(harnessed, 'tools/list', undefined, { token }))
    expect(anonymous).toEqual(authorised)
  })
})

/* ------------------------------------------------------------------ *
 * A token that works
 * ------------------------------------------------------------------ */

describe('et OAuth-token på MCP', () => {
  it('kjører en operasjon, som et agenttoken ville gjort', async () => {
    const { harnessed, server } = await oauthHarness()
    const token = await server.sign()

    const response = await callWith(harnessed, token, `${AGENT_TOOL_PREFIX}create_presentation`, {
      title: 'Laget over OAuth',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      result: { isError?: boolean; structuredContent: { presentationId: string } }
    }
    expect(body.result.isError).toBeFalsy()
    expect(body.result.structuredContent.presentationId).toBeTypeOf('string')
  })

  it('blir den Supabase-brukeren tokenet navngir, og ikke noen andre', async () => {
    const { harnessed, server } = await oauthHarness()
    await callWith(harnessed, await server.sign(), `${AGENT_TOOL_PREFIX}create_presentation`, {
      title: 'Min',
    })

    // The deck landed in that user's own store, and nowhere else.
    const mine = await harnessed.contextOf(TEST_OWNER).repository.listPresentations()
    expect(mine.map((entry) => entry.title)).toEqual(['Min'])
    expect(await harnessed.contextOf(DEFAULT_OWNER).repository.listPresentations()).toEqual([])
  })

  it('ser ikke en annen brukers presentasjoner', async () => {
    // The isolation claim, and it is about the *repository*: the deployment
    // builds one from the principal, pinned to its owner. Two owners, two
    // stores, and a read that names nothing still only names one of them.
    const { harnessed, server } = await oauthHarness({
      members: { [TEST_OWNER]: true, [OTHER_OWNER]: true },
    })
    const seeded = await runOperation(harnessed.contextOf(OTHER_OWNER), 'create_presentation', {
      title: 'Den andres dekk',
    })
    expect(seeded.ok).toBe(true)

    const listed = await callWith(harnessed, await server.sign(), `${AGENT_TOOL_PREFIX}list_presentations`)
    const body = (await listed.json()) as {
      result: { structuredContent: { presentations: { title: string }[] } }
    }
    expect(body.result.structuredContent.presentations).toEqual([])

    // And the other user, with their own token, sees exactly their own.
    const theirs = await callWith(
      harnessed,
      await server.sign({ sub: OTHER_OWNER }),
      `${AGENT_TOOL_PREFIX}list_presentations`,
    )
    const mine = (await theirs.json()) as {
      result: { structuredContent: { presentations: { title: string }[] } }
    }
    expect(mine.result.structuredContent.presentations.map((entry) => entry.title)).toEqual([
      'Den andres dekk',
    ])
  })

  it('møter den samme scope-grensen et agenttoken møter', async () => {
    // One authorisation system after authentication: the refusal comes from
    // `authorizeOperation`, which has never heard of OAuth.
    const { harnessed, server } = await oauthHarness({
      config: { defaultScopes: ['presentations:read'] },
    })
    const response = await callWith(
      harnessed,
      await server.sign(),
      `${AGENT_TOOL_PREFIX}create_presentation`,
      { title: 'Nei' },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      result: { isError: boolean; structuredContent: { error: { code: string; details: unknown } } }
    }
    expect(body.result.isError).toBe(true)
    expect(body.result.structuredContent.error.code).toBe('FORBIDDEN_SCOPE')
    expect(body.result.structuredContent.error.details).toMatchObject({
      missing: ['presentations:write'],
    })
  })

  it('kan ikke publisere med mindre installasjonen sier det uttrykkelig', async () => {
    // `CLAUDE.md`: ordinary editing never carries the right to publish. The
    // default grant is the three editing scopes, so this is the one operation
    // family an OAuth connector cannot reach out of the box.
    const { harnessed, server } = await oauthHarness()
    const token = await server.sign()
    const created = await callWith(harnessed, token, `${AGENT_TOOL_PREFIX}create_presentation`, {
      title: 'Ikke delt',
    })
    const { result } = (await created.json()) as {
      result: { structuredContent: { presentationId: string } }
    }

    const shared = await callWith(harnessed, token, `${AGENT_TOOL_PREFIX}set_sharing`, {
      presentationId: result.structuredContent.presentationId,
      shared: true,
    })
    const refusal = (await shared.json()) as {
      result: { isError: boolean; structuredContent: { error: { code: string } } }
    }
    expect(refusal.result.isError).toBe(true)
    expect(refusal.result.structuredContent.error.code).toBe('FORBIDDEN_SCOPE')
  })
})

describe('et OAuth-token på REST', () => {
  it('kjører den samme operasjonen på den samme adressen', async () => {
    const { harnessed, server } = await oauthHarness()
    const response = await restRaw(
      harnessed,
      'create_presentation',
      { title: 'REST over OAuth' },
      { token: await server.sign(), headers: { Accept: 'application/json' } },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: { presentationId: string } }
    expect(body.ok).toBe(true)
    expect(body.data.presentationId).toBeTypeOf('string')
  })

  it('avvises med den samme 401-en som et hvilket som helst annet ubrukelig token', async () => {
    const { harnessed, server } = await oauthHarness()
    const seconds = Math.floor(Date.now() / 1000)
    const response = await restRaw(
      harnessed,
      'list_presentations',
      {},
      { token: await server.sign({ exp: seconds - 1 }) },
    )
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })
})

/* ------------------------------------------------------------------ *
 * The family that was already there
 * ------------------------------------------------------------------ */

describe('agenttokens', () => {
  it('virker uendret på REST, med og uten OAuth i installasjonen', async () => {
    for (const harnessed of [harness(), (await oauthHarness()).harnessed]) {
      const answer = await rest(harnessed, 'create_presentation', { title: 'Med agenttoken' })
      expect(answer.status).toBe(200)
      expect((answer.body.data as { presentationId: string }).presentationId).toBeTypeOf('string')
    }
  })

  it('virker uendret på MCP i en installasjon som også tar OAuth', async () => {
    const { harnessed } = await oauthHarness()
    const response = await callWith(harnessed, TOKEN, `${AGENT_TOOL_PREFIX}list_presentations`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { isError?: boolean } }
    expect(body.result.isError).toBeFalsy()
  })

  it('blandes aldri sammen med et OAuth-token', async () => {
    // The two shapes cannot be confused for one another, so the split is total
    // rather than a guess: `slaids_at_` plus 43 base64url characters is not
    // three dot-separated segments.
    const { harnessed } = await oauthHarness()
    // A JWT-shaped string reaches the OAuth verifier and fails there…
    const asJwt = await restRaw(harnessed, 'list_presentations', {}, { token: 'a.b.c' })
    expect(asJwt.status).toBe(401)
    // …and a string shaped like neither never becomes a lookup at all.
    const neither = await restRaw(harnessed, 'list_presentations', {}, { token: 'hva-som-helst' })
    expect(neither.status).toBe(401)
  })

  it('møter «ingen OAuth her» når installasjonen ikke har noen', async () => {
    const response = await restRaw(harness(), 'list_presentations', {}, { token: 'a.b.c' })
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).not.toContain('resource_metadata')
  })
})

/* ------------------------------------------------------------------ *
 * The audit
 * ------------------------------------------------------------------ */

describe('auditen', () => {
  it('sier at kallet kom via OAuth, og hvem det var', async () => {
    const { harnessed, server } = await oauthHarness()
    await callWith(harnessed, await server.sign(), `${AGENT_TOOL_PREFIX}list_presentations`)

    expect(harnessed.audit.entries).toHaveLength(1)
    expect(harnessed.audit.entries[0]).toMatchObject({
      principalKind: 'oauth',
      ownerId: TEST_OWNER,
      clientId: TEST_CLIENT,
      // No token row was involved, and none is invented.
      tokenId: null,
      tokenName: '',
      operation: 'list_presentations',
      success: true,
      status: 200,
    })
  })

  it('lagrer ikke tokenet, og ingen annen hemmelighet fra flyten', async () => {
    const { harnessed, server } = await oauthHarness()
    const token = await server.sign()
    await callWith(harnessed, token, `${AGENT_TOOL_PREFIX}list_presentations`)

    const written = JSON.stringify(harnessed.audit.entries)
    expect(written).not.toContain(token)
    // Not even a fragment of it: a signature prefix in a log is still key
    // material sitting where a log is read far more often than it is written.
    for (const segment of token.split('.')) expect(written).not.toContain(segment)
    expect(written).not.toContain(TEST_ISSUER)
    // The client id is public by construction — it travels in the browser's
    // address bar — and it is the one OAuth value that belongs here.
    expect(written).toContain(TEST_CLIENT)
  })

  it('skriver en rad for et utløpt token, siden eieren er kjent', async () => {
    // The OAuth mirror of "the token you revoked was presented again": the
    // signature checked out and the owner is one of ours, so there is somebody
    // to attribute it to.
    const { harnessed, server } = await oauthHarness()
    const seconds = Math.floor(Date.now() / 1000)
    await callWith(harnessed, await server.sign({ exp: seconds - 1 }), anyReadTool())

    expect(harnessed.audit.entries).toHaveLength(1)
    expect(harnessed.audit.entries[0]).toMatchObject({
      principalKind: 'oauth',
      ownerId: TEST_OWNER,
      clientId: TEST_CLIENT,
      errorCode: 'OAUTH_TOKEN_EXPIRED',
      status: 401,
      success: false,
    })
  })

  it('skriver ingen rad for en fremmed som ikke er en Slaids-eier', async () => {
    // There is nobody to attribute it to, and a row invented for one would let
    // any user of the shared Supabase project fill the table.
    const { harnessed, server } = await oauthHarness()
    const stranger = await server.sign({ sub: OTHER_OWNER } as TokenClaims)
    await callWith(harnessed, stranger, anyReadTool())
    expect(harnessed.audit.entries).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * What did not change
 * ------------------------------------------------------------------ */

describe('grensene som sto fra før', () => {
  it('holder REST-katalogen lukket, også med OAuth påslått', async () => {
    const { harnessed } = await oauthHarness()
    const response = await handleAgentRequest(
      harnessed.deps,
      new Request(`${ORIGIN}${AGENT_API_BASE_PATH}/operations`),
    )
    expect(response.status).toBe(401)
  })

  it('slipper fortsatt ikke inn en nettleserside', async () => {
    // The DNS-rebinding guard, which OAuth must not have opened: it runs before
    // anything is read, including before the credential is looked at.
    const { harnessed, server } = await oauthHarness()
    const response = await mcpSend(
      harnessed,
      'tools/list',
      undefined,
      { token: await server.sign(), headers: { Origin: 'https://evil.example' } },
    )
    expect(response.status).toBe(403)
  })

  it('lar ikke metadatadokumentet skrives til', async () => {
    const { harnessed } = await oauthHarness()
    const response = await handleAgentRequest(
      harnessed.deps,
      new Request(`${ORIGIN}${MCP_PROTECTED_RESOURCE_METADATA_PATH}`, { method: 'POST' }),
    )
    expect(response.status).toBe(405)
  })
})
