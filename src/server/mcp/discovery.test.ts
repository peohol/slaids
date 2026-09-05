// @vitest-environment node
/**
 * The one sentence this whole file exists to hold in place:
 *
 *   **MCP discovery is public; Slaids' operations are authenticated and
 *   scope-gated.**
 *
 * The half that is new is easy to check and easy to get wrong in the dangerous
 * direction, so it is checked from both ends. Positively: a client with no
 * `Authorization` header at all can handshake, ping, and read the whole tool
 * catalogue — which is the order a client is *built* in, and what a `401` on
 * `initialize` broke, leaving an app that connected and offered nothing.
 * Negatively: nothing anonymous reaches a presentation, a folder, a token, an
 * owner or an audit row, and the way that is established is by taking the
 * repository away rather than by asserting about the answers we happen to see.
 *
 * The catalogue being public is only safe because it is *product metadata*, and
 * that is a claim about content rather than about access: `tools.test.ts` holds
 * the content half — nothing user- or environment-specific in a name, a
 * description, a schema, a default or an example — and this file holds the
 * access half, plus the one bridge between them: an anonymous caller and a token
 * are handed the same bytes.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_TOOL_PREFIX, operations } from '../../agent/registry'
import { AGENT_MCP_PATH } from '../../routing'
import { handleAgentRequest } from '../agent/handler'
import { MCP_PROTOCOL_VERSION } from './tools'
import {
  ORIGIN,
  TOKEN,
  closeHarnessDatabases,
  harness,
  jsonRpcFailureOf,
  mcp,
  mcpRaw,
  mcpSend,
  resultOf,
  seedDeck,
} from './testHarness'

afterEach(closeHarnessDatabases)

/** No `Authorization` header at all — a client that has not been given a token. */
const ANONYMOUS = { token: null } as const

const handshake = {
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: 'oppdager', version: '1.0.0' },
}

/** One tool, named the way the registry names it. Never spelled out here. */
function anyToolName(): string {
  return `${AGENT_TOOL_PREFIX}${operations[0].name}`
}

/** The catalogue's names, from the registry, so this file keeps no second list. */
function everyToolName(): string[] {
  return operations.map((operation) => `${AGENT_TOOL_PREFIX}${operation.name}`)
}

/* ------------------------------------------------------------------ *
 * The public half
 * ------------------------------------------------------------------ */

describe('oppdagelse uten token', () => {
  it('håndhilser', async () => {
    const answer = await mcp(harness(), 'initialize', handshake, ANONYMOUS)

    expect(answer.status).toBe(200)
    const result = resultOf(answer)
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(result.capabilities).toEqual({ tools: { listChanged: false } })
    expect(result.serverInfo).toMatchObject({ name: 'slaids-agent' })
    expect(result.instructions).toBeTypeOf('string')
  })

  it('tar imot notifications/initialized, som håndtrykket krever', async () => {
    // The lifecycle's second step, sent as a real notification: no `id`, and
    // therefore no answer, ever. A `401` here would leave a client waiting for
    // acknowledgement of a handshake it had already completed.
    const response = await mcpRaw(
      harness(),
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      ANONYMOUS,
    )
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('tar imot enhver notifikasjon uten token, siden ingen av dem kjører noe', async () => {
    // Not a list of notification names: the dispatcher acknowledges *every*
    // notification without dispatching anything, so "a notification cannot
    // reach a deck" is a property of the code rather than of a list.
    for (const method of ['notifications/cancelled', 'notifications/progress', 'notifications/tull']) {
      const response = await mcpRaw(
        harness(),
        JSON.stringify({ jsonrpc: '2.0', method, params: {} }),
        ANONYMOUS,
      )
      expect(response.status).toBe(202)
    }
  })

  it('svarer på ping', async () => {
    const answer = await mcp(harness(), 'ping', undefined, ANONYMOUS)
    expect(answer.status).toBe(200)
    expect(resultOf(answer)).toEqual({})
  })

  it('lister hele katalogen, ikke en delmengde av den', async () => {
    const answer = await mcp(harness(), 'tools/list', undefined, ANONYMOUS)

    expect(answer.status).toBe(200)
    const tools = resultOf(answer).tools as { name: string; inputSchema: unknown }[]
    // Every operation, in the registry's own order — the whole point being that
    // an app published from this scan can call anything the API has.
    expect(tools.map((tool) => tool.name)).toEqual(everyToolName())
    expect(tools.length).toBe(operations.length)
    for (const tool of tools) expect(tool.inputSchema).toBeTypeOf('object')
  })

  it('gir nøyaktig den samme katalogen som et token får', async () => {
    // The bridge between "public" and "product metadata": if the two ever
    // differed, the catalogue would be describing the caller instead of Slaids.
    const harnessed = harness()
    await seedDeck(harnessed, 'Et dekk som ikke skal påvirke katalogen')

    const anonymous = resultOf(await mcp(harnessed, 'tools/list', undefined, ANONYMOUS))
    const authenticated = resultOf(await mcp(harnessed, 'tools/list'))

    expect(anonymous).toEqual(authenticated)
  })

  it('svarer at en metode ikke finnes, i stedet for at den er stengt', async () => {
    // Clients probe for `resources/list` and `prompts/list` whether or not the
    // server announced the capability. A `401` there reads as "this whole server
    // is locked" to a client that is only asking; the honest answer is that the
    // method does not exist, and it gives nothing away — the list in it is the
    // four names the specification already publishes.
    const answer = await mcp(harness(), 'resources/list', undefined, ANONYMOUS)

    expect(answer.status).toBe(200)
    const failure = jsonRpcFailureOf(answer)
    expect(failure.code).toBe(-32601)
    expect((failure.data as { available: string[] }).available).toEqual([
      'initialize',
      'ping',
      'tools/list',
      'tools/call',
    ])
  })

  it('leser aldri noe som helst for å svare', async () => {
    // The claim, established by taking the repository away rather than by
    // asserting about the answers: `contextFor` is the only route to one, and in
    // this deployment it throws. All three public methods answer anyway, so
    // their answers cannot have come from a deck — and the counter says nothing
    // even *asked*.
    const harnessed = harness({ refuseContext: true })

    expect(resultOf(await mcp(harnessed, 'initialize', handshake, ANONYMOUS)).serverInfo).toBeTruthy()
    expect(resultOf(await mcp(harnessed, 'ping', undefined, ANONYMOUS))).toEqual({})
    expect(
      (resultOf(await mcp(harnessed, 'tools/list', undefined, ANONYMOUS)).tools as unknown[]).length,
    ).toBe(operations.length)
    expect(harnessed.contextRequests).toBe(0)

    // And the trap is real: the same deployment, the same message, with a token,
    // asks for a context and falls over on it.
    const withToken = await mcp(harnessed, 'tools/call', {
      name: anyToolName(),
      arguments: {},
    })
    expect(withToken.status).toBe(500)
    expect(harnessed.contextRequests).toBe(1)
  })

  it('ber ikke om et repository selv når kalleren har et gyldig token', async () => {
    // Discovery reads nothing for *anyone*. If a handshake ever started needing
    // one, this is where it would show up before it became a per-caller answer.
    const harnessed = harness()
    await mcp(harnessed, 'initialize', handshake)
    await mcp(harnessed, 'tools/list')
    await mcp(harnessed, 'ping')

    expect(harnessed.contextRequests).toBe(0)
  })

  it('holder for hver metode serveren har, ikke bare de tre vi tenkte på', async () => {
    // The list comes from the server itself — a method-not-found publishes it —
    // so a method added tomorrow is in this loop tomorrow. For each of them an
    // anonymous call must do one of exactly two things: be refused at the
    // transport, or answer without asking for a repository. A new method
    // classified `public` by accident fails here, whatever it is called.
    const known = (
      jsonRpcFailureOf(await mcp(harness(), 'ingen/slik/metode', undefined, ANONYMOUS)).data as {
        available: string[]
      }
    ).available
    expect(known.length).toBeGreaterThan(0)

    for (const method of known) {
      const harnessed = harness({ refuseContext: true })
      const response = await mcpSend(
        harnessed,
        method,
        method === 'initialize' ? handshake : { name: anyToolName(), arguments: {} },
        ANONYMOUS,
      )
      if (response.status === 401) continue
      expect(response.status).toBe(200)
      expect(harnessed.contextRequests).toBe(0)
    }
  })

  it('skriver ingen auditrad, fordi det ikke finnes noen å tilskrive den', async () => {
    const harnessed = harness()
    await mcp(harnessed, 'initialize', handshake, ANONYMOUS)
    await mcp(harnessed, 'tools/list', undefined, ANONYMOUS)
    await mcp(harnessed, 'ping', undefined, ANONYMOUS)
    await mcpSend(harnessed, 'notifications/initialized', undefined, ANONYMOUS)

    // The audit is the owner's, keyed on the token that acted. An anonymous
    // message has neither — and a row invented for one would let an
    // unauthenticated caller fill the table.
    expect(harnessed.audit.entries).toEqual([])
  })

  it('lar protokolltrafikk med token bli revidert som før', async () => {
    const harnessed = harness()
    await mcp(harnessed, 'initialize', handshake)
    await mcp(harnessed, 'tools/list')

    expect(harnessed.audit.entries.map((entry) => entry.operation)).toEqual([
      'mcp:initialize',
      'mcp:tools/list',
    ])
  })
})

/* ------------------------------------------------------------------ *
 * The authenticated half
 * ------------------------------------------------------------------ */

describe('operasjoner uten token', () => {
  it('avvises med 401 og utfordringen', async () => {
    const response = await mcpSend(
      harness(),
      'tools/call',
      { name: anyToolName(), arguments: {} },
      ANONYMOUS,
    )

    // MCP puts authorization at the transport level and its error table names
    // 401 for "authorization required or token invalid". A JSON-RPC error inside
    // a 200 would hide the challenge from a client whose token expired.
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
    // RFC 6750 §3.1: nothing was presented, so nothing was rejected. A client
    // that meets `error="invalid_token"` here would think its (absent)
    // credential had been refused.
    expect(response.headers.get('WWW-Authenticate')).not.toContain('error=')
  })

  it('bærer den samme utfordringen inne i svaret, der en mixed-auth-klient leser den', async () => {
    // The body is the other half of the same refusal. Discovery here is public,
    // so a client reaches `tools/call` having already read from the tool's own
    // `securitySchemes` that it needs a credential — and the clients converging
    // on mixed authentication look for the challenge in the *result*, not in the
    // status line. Carrying both leaves neither kind of client with an error it
    // cannot act on.
    const response = await mcpSend(
      harness(),
      'tools/call',
      { name: anyToolName(), arguments: {} },
      ANONYMOUS,
    )

    const body = (await response.json()) as {
      id: unknown
      result: {
        isError: boolean
        structuredContent: { error: { code: string } }
        _meta: Record<string, unknown>
      }
    }
    // Addressed to the call that was made: a client correlates by id, and a
    // refusal it cannot match to a request is one it has to time out on.
    expect(body.id).toBeTypeOf('number')
    expect(body.result.isError).toBe(true)
    expect(body.result.structuredContent.error.code).toBe('UNAUTHENTICATED')
    expect(body.result._meta['mcp/www_authenticate']).toEqual([
      response.headers.get('WWW-Authenticate'),
    ])
  })

  it('avvises likt enten verktøyet leser eller skriver', async () => {
    // A read is not a smaller thing to be allowed to do without a token: the
    // decks are the owner's either way.
    const harnessed = harness()
    for (const operation of operations) {
      if (operation.mutates) continue
      const response = await mcpSend(
        harnessed,
        'tools/call',
        { name: `${AGENT_TOOL_PREFIX}${operation.name}`, arguments: {} },
        ANONYMOUS,
      )
      expect(response.status).toBe(401)
    }
  })

  it('avvises før argumentene i det hele tatt leses', async () => {
    // Fail closed: nonsense arguments from an anonymous caller answer «no
    // token», never «that is not the right shape». Otherwise the schema errors
    // would be a way to probe the surface without one.
    const response = await mcpSend(
      harness(),
      'tools/call',
      { name: 42, arguments: 'ikke et objekt' },
      ANONYMOUS,
    )
    expect(response.status).toBe(401)
  })

  it('røper ikke om verktøyet finnes', async () => {
    const real = await mcpSend(harness(), 'tools/call', { name: anyToolName() }, ANONYMOUS)
    const fake = await mcpSend(harness(), 'tools/call', { name: 'slaids_finnes_ikke' }, ANONYMOUS)

    expect(real.status).toBe(fake.status)
    // Everything but the id, which is the caller's own and differs by
    // construction: a refusal that told the two apart would be a way to
    // enumerate the surface without a credential.
    const withoutId = async (response: Response): Promise<unknown> => {
      const { id: _id, ...rest } = (await response.json()) as Record<string, unknown>
      return rest
    }
    expect(await withoutId(real)).toEqual(await withoutId(fake))
  })

  it('skriver ingenting, og etterlater ingen presentasjon', async () => {
    const harnessed = harness()
    const before = await harnessed.context.repository.listPresentations()

    await mcpSend(
      harnessed,
      'tools/call',
      { name: `${AGENT_TOOL_PREFIX}create_presentation`, arguments: { title: 'Ulovlig' } },
      ANONYMOUS,
    )

    expect(await harnessed.context.repository.listPresentations()).toEqual(before)
    expect(harnessed.audit.entries).toEqual([])
  })

  it('virker med token, som før', async () => {
    const harnessed = harness()
    const answer = await mcp(harnessed, 'tools/call', {
      name: `${AGENT_TOOL_PREFIX}create_presentation`,
      arguments: { title: 'Med token' },
    })

    expect(answer.status).toBe(200)
    const result = resultOf(answer) as { isError?: boolean; structuredContent?: Record<string, unknown> }
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent?.presentationId).toBeTypeOf('string')
  })
})

/* ------------------------------------------------------------------ *
 * A token that was presented
 * ------------------------------------------------------------------ */

describe('et token som er sendt, men ikke gyldig', () => {
  const revoked = harness({
    authenticate: () =>
      Promise.resolve({
        ok: false as const,
        reason: 'revoked' as const,
        identified: { kind: 'agent_token' as const, ownerId: 'owner-1', tokenId: 'token-1', tokenName: 'Gammel agent' },
      }),
  })

  it('avvises på oppdagelse også, ikke bare på verktøykall', async () => {
    // Discovery being open is about a client that has *no* token yet. A client
    // whose token was taken away is the opposite case, and it is refused on
    // every method — otherwise revocation would quietly become a downgrade to
    // anonymous access.
    for (const method of ['initialize', 'ping', 'tools/list', 'tools/call'] as const) {
      const response = await mcpSend(revoked, method, method === 'initialize' ? handshake : {})
      expect(response.status).toBe(401)
    }
  })

  it('skrives i auditen, som over REST', async () => {
    const audited = harness({
      authenticate: () =>
        Promise.resolve({
          ok: false as const,
          reason: 'expired' as const,
          identified: { kind: 'agent_token' as const, ownerId: 'owner-1', tokenId: 'token-9', tokenName: 'Utløpt agent' },
        }),
    })
    await mcp(audited, 'tools/list')

    // «The key I took away is still being used» is the one thing an owner most
    // needs to see, and it is recorded even though the caller is never told it.
    expect(audited.audit.entries).toEqual([
      expect.objectContaining({
        tokenName: 'Utløpt agent',
        operation: 'mcp',
        errorCode: 'TOKEN_EXPIRED',
        status: 401,
        success: false,
      }),
    ])
  })

  it('skriver ingen rad for et token ingen har sett før', async () => {
    const harnessed = harness()
    await mcp(harnessed, 'tools/list', undefined, { token: `${TOKEN.slice(0, -1)}X` })
    expect(harnessed.audit.entries).toEqual([])
  })

  it('svarer likt på et feilformet og et ukjent token', async () => {
    const harnessed = harness()
    const answers = await Promise.all(
      ['tull', `${TOKEN.slice(0, -1)}X`].map(async (token) => {
        const response = await mcpSend(harnessed, 'tools/list', undefined, { token })
        return { status: response.status, body: await response.text() }
      }),
    )

    expect(answers[0].status).toBe(401)
    expect(answers[0].body).toBe(answers[1].body)
  })
})

/* ------------------------------------------------------------------ *
 * What the split did not change
 * ------------------------------------------------------------------ */

describe('grensen flyttet seg bare på MCP-adressen', () => {
  const url = (suffix: string): string => `${ORIGIN}${AGENT_MCP_PATH.replace('/mcp', '')}${suffix}`

  it.each([
    ['', 'GET'],
    ['/operations', 'GET'],
    ['/operations/list_presentations', 'POST'],
    ['/finnes-ikke', 'GET'],
  ])('lar ikke %s bli offentlig', async (suffix, method) => {
    const response = await handleAgentRequest(harness().deps, new Request(url(suffix), { method }))
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('holder scope-avvisningen der den var: et resultat, ikke en 401', async () => {
    // A missing scope is a decision about a tool that exists, made by a token
    // that is valid — so it stays a tool result an agent can read and act on.
    const readOnly = harness({ scopes: ['presentations:read'] })
    const answer = await mcp(readOnly, 'tools/call', {
      name: `${AGENT_TOOL_PREFIX}create_presentation`,
      arguments: { title: 'Uten skriverett' },
    })

    expect(answer.status).toBe(200)
    const result = resultOf(answer) as {
      isError?: boolean
      structuredContent?: { error?: { code?: string } }
    }
    expect(result.isError).toBe(true)
    expect(result.structuredContent?.error?.code).toBe('FORBIDDEN_SCOPE')
  })

  it('holder transportsjekkene foran alt, også for en anonym kaller', async () => {
    const harnessed = harness()

    // A browser page still gets nowhere, token or not: the `Origin` refusal runs
    // before the body is read, and public discovery did not open a door for one.
    const fromPage = await mcpRaw(harnessed, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', {
      token: null,
      headers: { Origin: 'https://evil.example' },
    })
    expect(fromPage.status).toBe(403)

    const wrongVersion = await mcpRaw(harnessed, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', {
      token: null,
      headers: { 'MCP-Protocol-Version': '2025-03-26' },
    })
    expect(wrongVersion.status).toBe(400)

    const wrongType = await mcpRaw(harnessed, 'tools/list', {
      token: null,
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(wrongType.status).toBe(415)

    const wrongVerb = await handleAgentRequest(
      harnessed.deps,
      new Request(`${ORIGIN}${AGENT_MCP_PATH}`, { method: 'GET' }),
    )
    expect(wrongVerb.status).toBe(405)
  })

  it('måler en anonym kropp mot den samme grensen', async () => {
    const harnessed = harness()
    const response = await mcpRaw(harnessed, JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }), {
      token: null,
    })
    expect(response.status).toBe(413)
  })
})
