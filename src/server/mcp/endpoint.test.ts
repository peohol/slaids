// @vitest-environment node
/**
 * The MCP surface, driven with real `Request` objects.
 *
 * Node rather than jsdom, for the same two reasons the REST tests give: the
 * thing that runs in production is the platform's own `Request`/`Response`, and
 * this file importing Agent Core, the domain commands and the fit estimator with
 * no DOM anywhere is a standing check that all of it really is headless.
 *
 * The centrepiece is the workflow §44 asks for, done entirely through MCP tool
 * calls: create a deck, look at the slide it came with, give it a title and a
 * layout, write text into a zone, read it back, validate the whole thing, and
 * find it valid. Everything else in the file is a way that workflow can go
 * wrong — bad input, an unknown tool, a token without the scope, a write against
 * a reading somebody else has already overtaken — because those are the answers
 * an agent has to be able to act on.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_TOOL_PREFIX } from '../../agent/registry'
import { AGENT_MCP_PATH } from '../../routing'
import { handleAgentRequest } from '../agent/handler'
import { resultText } from './result'
import { MCP_PROTOCOL_VERSION, SUPPORTED_MCP_PROTOCOL_VERSIONS } from './tools'
import {
  ORIGIN,
  TOKEN,
  callError,
  callOk,
  callProtocolError,
  callTool,
  closeHarnessDatabases,
  harness,
  jsonRpcFailureOf,
  mcp,
  mcpRaw,
  newPresentation,
  resultOf,
} from './testHarness'

afterEach(closeHarnessDatabases)

const tool = (name: string): string => `${AGENT_TOOL_PREFIX}${name}`

/* ------------------------------------------------------------------ *
 * The workflow
 * ------------------------------------------------------------------ */

describe('en hel arbeidsflyt over MCP', () => {
  it('oppretter, inspiserer, endrer, leser tilbake og validerer', async () => {
    const harnessed = harness()

    // 1. A client says hello and gets the catalogue.
    const initialized = resultOf(
      await mcp(harnessed, 'initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'testklient', version: '1.0' },
      }),
    )
    expect(initialized.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(initialized.capabilities).toEqual({ tools: { listChanged: false } })
    expect(initialized.instructions).toBeTypeOf('string')

    const listed = resultOf(await mcp(harnessed, 'tools/list'))
    const toolNames = (listed.tools as { name: string }[]).map((entry) => entry.name)
    expect(toolNames).toContain(tool('create_presentation'))

    // 2. Create a presentation. The answer already carries the front section
    // and the one slide it opens onto.
    const created = await callOk(harnessed, tool('create_presentation'), {
      title: 'Kvartalsrapport',
    })
    const presentationId = created.presentationId as string
    expect(created.slideCount).toBe(2)
    const slideId = (created.slides as { slideId: string }[])[1].slideId

    // 3. Inspect it, and learn the ids and the geometry the next calls need.
    const inspected = await callOk(harnessed, tool('inspect_slide'), { presentationId, slideId })
    expect(inspected.rootNodeId).toBeTypeOf('string')
    const rootNodeId = inspected.rootNodeId as string
    expect(inspected.revision).toBeTypeOf('string')
    const zones = inspected.zones as { nodeId: string; kind: string; rect: unknown }[]
    expect(zones[0].nodeId).toBe(rootNodeId)
    expect(zones[0].rect).toMatchObject({ x: expect.any(Number), width: expect.any(Number) })

    // 4. A title, and a layout: two columns out of the one zone it started with.
    await callOk(harnessed, tool('set_slide_title'), {
      presentationId,
      slideId,
      expectedRevision: inspected.revision,
      spans: [{ text: 'Resultatet for Q3' }],
    })

    const split = await callOk(harnessed, tool('split_zone'), {
      presentationId,
      slideId,
      nodeId: rootNodeId,
      axis: 'x',
      weights: [2, 1],
    })
    const [leftZone, rightZone] = split.childNodeIds as string[]
    expect(leftZone).toBeTypeOf('string')
    expect(rightZone).toBeTypeOf('string')

    // 5. Text into one of the new zones.
    await callOk(harnessed, tool('set_zone_text'), {
      presentationId,
      slideId,
      nodeId: leftZone,
      blocks: [
        { type: 'heading', spans: [{ text: 'Hovedpunkter' }] },
        { type: 'bullets', items: [[{ text: 'Omsetningen økte.' }], [{ text: 'Kostnadene falt.' }]] },
      ],
    })

    // 6. Read it back. Everything written is visible, and it fits.
    const reread = await callOk(harnessed, tool('inspect_slide'), { presentationId, slideId })
    expect(reread.title).toBe('Resultatet for Q3')
    expect(reread.hasTitle).toBe(true)
    const filled = (reread.zones as { nodeId: string; fits?: boolean; subfields?: unknown[] }[]).find(
      (zone) => zone.nodeId === leftZone,
    )
    expect(filled?.fits).toBe(true)
    expect(JSON.stringify(filled?.subfields)).toContain('Omsetningen økte.')

    // 7 and 8. Validate the whole deck, and find nothing wrong with it.
    const report = await callOk(harnessed, tool('validate_presentation'), { presentationId })
    expect(report.valid).toBe(true)
    expect(report.issues).toEqual([])

    // The structured half alone was enough for every step above; the text block
    // is the same JSON, for a client that only shows text.
    const asText = await callTool(harnessed, tool('get_presentation'), { presentationId })
    expect(JSON.parse(resultText(asText))).toEqual(asText.structuredContent)
  })
})

/* ------------------------------------------------------------------ *
 * Errors an agent is meant to act on
 * ------------------------------------------------------------------ */

describe('feil som er resultater', () => {
  it('håndhever scopes serverside, uansett hvordan kallet ser ut', async () => {
    const readOnly = harness({ scopes: ['presentations:read'] })
    const error = await callError(readOnly, tool('create_presentation'), { title: 'Dekk' })
    expect(error.code).toBe('FORBIDDEN_SCOPE')
    expect(error.details).toMatchObject({ missing: ['presentations:write'] })

    // And nothing was written on the way to being refused.
    const listed = await callOk(readOnly, tool('list_presentations'))
    expect(listed.presentations).toEqual([])
  })

  it('gir aldri vanlig redigering rett til å publisere', async () => {
    const editor = harness({ scopes: ['presentations:read', 'presentations:write'] })
    const deck = await newPresentation(editor)
    const error = await callError(editor, tool('set_sharing'), {
      presentationId: deck.presentationId,
      shared: true,
    })
    expect(error.code).toBe('FORBIDDEN_SCOPE')
    expect(error.details).toMatchObject({ missing: ['sharing:write'] })
  })

  it('avviser en skriving mot en revisjon noen andre har gått forbi', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)

    // Somebody writes. The revision the agent is holding is now the old one.
    await callOk(harnessed, tool('set_slide_title'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: deck.revision,
      spans: [{ text: 'Først' }],
    })

    const error = await callError(harnessed, tool('set_slide_title'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: deck.revision,
      spans: [{ text: 'Etterpå' }],
    })
    expect(error.code).toBe('CONFLICT')

    // The stale write changed nothing; reading again is what unblocks the agent.
    const inspected = await callOk(harnessed, tool('inspect_slide'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(inspected.title).toBe('Først')
    expect(inspected.revision).not.toBe(deck.revision)
  })

  it('avviser tekst som ikke får plass, og sier hvor mye', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)

    const error = await callError(harnessed, tool('set_zone_text'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Altfor mye tekst. '.repeat(400) }] }],
    })
    expect(error.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(error.details).toMatchObject({ nodeId: deck.rootNodeId })

    // Refused means nothing was written: the zone is still empty.
    const inspected = await callOk(harnessed, tool('inspect_slide'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    const zone = (inspected.zones as { nodeId: string; empty?: boolean }[]).find(
      (entry) => entry.nodeId === deck.rootNodeId,
    )
    expect(zone?.empty).toBe(true)
  })

  it('svarer på en ukjent presentasjon med en kode, ikke med et unntak', async () => {
    const harnessed = harness()
    const error = await callError(harnessed, tool('get_presentation'), { presentationId: 'p_finnes_ikke' })
    expect(error.code).toBe('PRESENTATION_NOT_FOUND')
  })

  it('legger feilkoden i teksten også, for en klient som bare viser tekst', async () => {
    const harnessed = harness()
    const result = await callTool(harnessed, tool('get_presentation'), { presentationId: 'p_x' })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('PRESENTATION_NOT_FOUND')
  })
})

/* ------------------------------------------------------------------ *
 * The line between a refused call and a call that never was one
 * ------------------------------------------------------------------ */

describe('skillet mellom protokollfeil og verktøyfeil', () => {
  it('svarer på et ukjent verktøy med en JSON-RPC-feil, ikke med et resultat', async () => {
    // Nothing ran, and nothing could have: there is no such tool. That is a
    // protocol error in the specification and in the reference implementation,
    // and the payload is still Agent Core's own, list of real names and all.
    const harnessed = harness()
    const { code, error } = await callProtocolError(harnessed, tool('generate_image'))

    expect(code).toBe(-32602)
    expect(error.code).toBe('UNKNOWN_OPERATION')
    const available = (error.details as { available: string[] }).available
    expect(available).toContain('create_svg_asset')
    expect(available).not.toContain('generate_image')
  })

  it('svarer på argumenter som ikke passer verktøyets skjema med en JSON-RPC-feil', async () => {
    const harnessed = harness()
    const { code, error } = await callProtocolError(harnessed, tool('create_presentation'), {
      title: '',
    })

    expect(code).toBe(-32602)
    expect(error.code).toBe('INVALID_INPUT')
    expect(JSON.stringify(error.details)).toContain('title')
  })

  it('avviser et felt operasjonen ikke har, i stedet for å la det forsvinne', async () => {
    // A misspelled `expectedRevision` would otherwise be a concurrency check
    // that quietly did not happen.
    const harnessed = harness()
    const { error } = await callProtocolError(harnessed, tool('create_presentation'), {
      title: 'Dekk',
      expectedRevison: 'r_1',
    })
    expect(error.code).toBe('INVALID_INPUT')
  })

  it.each([
    ['manglende presentasjon', 'get_presentation', { presentationId: 'p_nei' }, 'PRESENTATION_NOT_FOUND'],
    ['manglende scope', 'set_sharing', { presentationId: 'p_nei', shared: true }, 'FORBIDDEN_SCOPE'],
  ])(
    'lar %s være et resultat, siden et ekte verktøy fikk bestemme',
    async (_name, operation, args, expected) => {
      // The line is "did a real operation get to decide", not "how bad was it".
      const harnessed = harness({ scopes: ['presentations:read', 'presentations:write'] })
      const error = await callError(harnessed, tool(operation), args)
      expect(error.code).toBe(expected)
    },
  )
})

describe('protokollfeil', () => {
  it('svarer på en ukjent metode med JSON-RPC-feilen, ikke med et verktøyresultat', async () => {
    const harnessed = harness()
    const answer = await mcp(harnessed, 'resources/list')
    expect(answer.status).toBe(200)
    const failure = jsonRpcFailureOf(answer)
    expect(failure.code).toBe(-32601)
    // The real method names, so a client that misspelled one can see them.
    expect((failure.data as { available: string[] }).available).toContain('tools/call')
  })

  it('svarer på ping', async () => {
    const harnessed = harness()
    expect(resultOf(await mcp(harnessed, 'ping'))).toEqual({})
  })

  it('svarer på ping selv om klienten sender et _meta med', async () => {
    // `ping` takes no parameters of its own, but the specification allows a
    // `_meta` on any of them; refusing that would be strictness against the
    // protocol rather than for it.
    const harnessed = harness()
    expect(resultOf(await mcp(harnessed, 'ping', { _meta: { sporing: 'abc' } }))).toEqual({})
  })
})

/* ------------------------------------------------------------------ *
 * What each method requires of its parameters
 * ------------------------------------------------------------------ */

describe('parametervalidering per metode', () => {
  const VALID_INITIALIZE = {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'testklient', version: '1.0.0' },
  }

  it.each([
    ['uten protocolVersion', { capabilities: {}, clientInfo: VALID_INITIALIZE.clientInfo }],
    ['uten capabilities', { protocolVersion: MCP_PROTOCOL_VERSION, clientInfo: VALID_INITIALIZE.clientInfo }],
    ['uten clientInfo', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }],
    ['med clientInfo uten version', { ...VALID_INITIALIZE, clientInfo: { name: 'x' } }],
  ])('avviser en initialize %s', async (_name, params) => {
    const harnessed = harness()
    const failure = jsonRpcFailureOf(await mcp(harnessed, 'initialize', params))
    expect(failure.code).toBe(-32602)
    expect(failure.data).toMatchObject({ method: 'initialize' })
  })

  it('godtar en fullstendig initialize', async () => {
    const harnessed = harness()
    expect(resultOf(await mcp(harnessed, 'initialize', VALID_INITIALIZE))).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
    })
  })

  it.each([
    ['et tall', 5],
    ['en liste', ['a']],
  ])('avviser en tools/list-cursor som er %s, i stedet for å ignorere den', async (_name, cursor) => {
    const harnessed = harness()
    expect(jsonRpcFailureOf(await mcp(harnessed, 'tools/list', { cursor })).code).toBe(-32602)
  })

  it('avviser en cursor den aldri delte ut', async () => {
    const harnessed = harness()
    expect(jsonRpcFailureOf(await mcp(harnessed, 'tools/list', { cursor: 'noe' })).code).toBe(-32602)
  })

  it.each([
    ['uten navn', {}],
    ['med numerisk navn', { name: 7 }],
    ['med argumenter som liste', { name: 'slaids_list_presentations', arguments: [] }],
    ['med argumenter som streng', { name: 'slaids_list_presentations', arguments: 'ingen' }],
  ])('avviser en tools/call %s', async (_name, params) => {
    const harnessed = harness()
    expect(jsonRpcFailureOf(await mcp(harnessed, 'tools/call', params)).code).toBe(-32602)
  })

  it('avviser posisjonelle parametre, som konvolutten selv ikke tillater', async () => {
    // An envelope MCP never allows, so this is `400` rather than a well-formed
    // message the server declined — the same line the reference schema draws.
    const harnessed = harness()
    const response = await mcpRaw(
      harnessed,
      '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":[1,2]}',
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32602)
  })

  it('avviser id: null i stedet for å kvittere for den som en notifikasjon', async () => {
    // A client that sent `id: null` is waiting for an answer; `202` and silence
    // is the one thing it cannot handle.
    const harnessed = harness()
    const response = await mcpRaw(
      harnessed,
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        method: 'tools/call',
        params: { name: tool('create_presentation'), arguments: { title: 'Skal ikke lagres' } },
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { id: null; error: { code: number } }
    expect(body.error.code).toBe(-32600)
    expect(body.id).toBeNull()

    const listed = await callOk(harnessed, tool('list_presentations'))
    expect(listed.presentations).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * The transport itself
 * ------------------------------------------------------------------ */

describe('transporten', () => {
  const address = `${ORIGIN}${AGENT_MCP_PATH}`
  const authorized = { Authorization: `Bearer ${TOKEN}` }

  it('krever et token, som alt annet i API-et', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(address, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      }),
    )
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('tilbyr ingen SSE-strøm, og sier det med 405 i stedet for å henge', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(address, { method: 'GET', headers: authorized }),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toContain('POST')
  })

  it('har ingen sesjon å avslutte', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(address, { method: 'DELETE', headers: authorized }),
    )
    expect(response.status).toBe(405)
  })

  it('deler aldri ut en Mcp-Session-Id, siden den er tilstandsløs', async () => {
    const harnessed = harness()
    const response = await handleAgentRequest(harnessed.deps, new Request(address, {
      method: 'POST',
      headers: { ...authorized, 'Content-Type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Mcp-Session-Id')).toBeNull()
  })

  it('slipper en vanlig MCP-klient gjennom: den sender ingen Origin', async () => {
    // Every MCP client is a program — the official SDK over Node, an editor, a
    // script — and none of them sends the header at all.
    const harnessed = harness()
    const response = await handleAgentRequest(harnessed.deps, new Request(address, {
      method: 'POST',
      headers: { ...authorized, 'Content-Type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    }))
    expect(response.status).toBe(200)
  })

  /** One mutating call, from a page, at whatever address the page reached. */
  async function mutatingCallFrom(
    harnessed: ReturnType<typeof harness>,
    origin: string,
    at = address,
  ): Promise<Response> {
    return handleAgentRequest(harnessed.deps, new Request(at, {
      method: 'POST',
      headers: { ...authorized, 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool('create_presentation'), arguments: { title: 'Skal ikke lagres' } },
      }),
    }))
  }

  it.each([
    ['en fremmed side', 'https://angriper.example'],
    ['samme navn på en annen vert', 'https://slaids.example.angriper.example'],
    ['et ugyldig Origin, som en sandkasset ramme sender', 'null'],
    // Refused too, and that is the point: there is no browser origin to trust,
    // so even the deployment's own is not one. A page is never an MCP client.
    ['deployens eget origin', ORIGIN],
  ])('avviser %s før kroppen leses', async (_name, origin) => {
    const harnessed = harness()
    const response = await mutatingCallFrom(harnessed, origin)

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORBIDDEN_ORIGIN')

    // And nothing was written on the way to being refused.
    const listed = await callOk(harnessed, tool('list_presentations'))
    expect(listed.presentations).toEqual([])
  })

  it('avviser et DNS rebinding-angrep, der Origin og Host er den samme angriperen', async () => {
    // The attack the check exists for, and the one a same-host comparison lets
    // through: the page is served from `evil.example`, DNS for `evil.example` is
    // repointed at this server, so the browser sends `Host: evil.example` *and*
    // `Origin: https://evil.example`. Comparing the request against itself would
    // find them equal and proceed. Nothing here is trusted, so it does not.
    const harnessed = harness()
    const response = await mutatingCallFrom(
      harnessed,
      'https://evil.example',
      `https://evil.example${AGENT_MCP_PATH}`,
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORBIDDEN_ORIGIN')

    const listed = await callOk(harnessed, tool('list_presentations'))
    expect(listed.presentations).toEqual([])
  })

  it('avviser en MCP-versjon den ikke snakker, i stedet for å svare som om den gjorde det', async () => {
    const harnessed = harness()
    const response = await handleAgentRequest(harnessed.deps, new Request(address, {
      method: 'POST',
      headers: {
        ...authorized,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2099-01-01',
      },
      // A mutation, deliberately: an unnegotiated protocol version must not be
      // able to write anything.
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool('create_presentation'), arguments: { title: 'Skal ikke lagres' } },
      }),
    }))

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string; details?: unknown } }
    expect(body.error.code).toBe('UNSUPPORTED_PROTOCOL_VERSION')
    expect(body.error.details).toMatchObject({ supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS] })

    // And nothing was written on the way to being refused.
    const listed = await callOk(harnessed, tool('list_presentations'))
    expect(listed.presentations).toEqual([])
  })

  it.each([...SUPPORTED_MCP_PROTOCOL_VERSIONS])('godtar headeren når den er %s', async (version) => {
    const harnessed = harness()
    const response = await handleAgentRequest(harnessed.deps, new Request(address, {
      method: 'POST',
      headers: { ...authorized, 'Content-Type': 'application/json', 'MCP-Protocol-Version': version },
      body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    }))
    expect(response.status).toBe(200)
  })

  it('godtar at headeren mangler, og leser den som den ene versjonen den har', async () => {
    // The specification's own fallback is `2025-03-26`, which this server does
    // not implement — so an absent header is read as the revision it does.
    const harnessed = harness()
    expect((await mcp(harnessed, 'ping')).status).toBe(200)
  })

  it.each(['2025-03-26', '2024-11-05', '2024-10-07'])(
    'avviser %s, som den verken annonserer eller implementerer',
    async (version) => {
      const harnessed = harness()
      const response = await handleAgentRequest(harnessed.deps, new Request(address, {
        method: 'POST',
        headers: {
          ...authorized,
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': version,
        },
        body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
      }))
      expect(response.status).toBe(400)
    },
  )

  it('kjører et kall med den tomme strengen som id, i stedet for å kvittere for det', async () => {
    // `''` is a valid JSON-RPC id. Reading it as "ingen id" ville gjort kallet
    // til en notifikasjon: 202, og operasjonen aldri kjørt.
    const harnessed = harness()
    const response = await mcpRaw(
      harnessed,
      JSON.stringify({
        jsonrpc: '2.0',
        id: '',
        method: 'tools/call',
        params: { name: tool('create_presentation'), arguments: { title: 'Tom id' } },
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      id: string
      result: { structuredContent: { title: string } }
    }
    expect(body.id).toBe('')
    expect(body.result.structuredContent.title).toBe('Tom id')

    // And it really was stored, not just answered.
    const listed = await callOk(harnessed, tool('list_presentations'))
    expect((listed.presentations as { title: string }[]).map((entry) => entry.title)).toEqual([
      'Tom id',
    ])
  })

  it('krever application/json', async () => {
    const harnessed = harness()
    const response = await mcpRaw(harnessed, 'ikke json', {
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(response.status).toBe(415)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNSUPPORTED_CONTENT_TYPE')
  })

  it('svarer med en parse-feil på en kropp som ikke er JSON', async () => {
    const harnessed = harness()
    const response = await mcpRaw(harnessed, '{ nei')
    expect(response.status).toBe(400)
    const body = (await response.json()) as { id: null; error: { code: number } }
    expect(body.id).toBeNull()
    expect(body.error.code).toBe(-32700)
  })

  it('sier fra at batcher ikke finnes lenger, i stedet for å kjøre den første', async () => {
    const harnessed = harness()
    const response = await mcpRaw(harnessed, '[{"jsonrpc":"2.0","id":1,"method":"ping"}]')
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: number; message: string } }
    expect(body.error.code).toBe(-32600)
    expect(body.error.message).toMatch(/batch/i)
  })

  it('kvitterer for en notifikasjon uten å svare på den', async () => {
    const harnessed = harness()
    const response = await mcpRaw(
      harnessed,
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    )
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('avviser en kropp som er større enn grensen', async () => {
    const harnessed = harness()
    harnessed.deps.maxRequestBytes = 32
    const response = await mcpRaw(
      harnessed,
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { fyll: 'x'.repeat(200) } }),
    )
    expect(response.status).toBe(413)
  })

  it('slipper preflight gjennom med MCP-ens egne headere', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(address, { method: 'OPTIONS' }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('mcp-protocol-version')
  })

  it('svarer med JSON og de samme vernende headerne som resten av API-et', async () => {
    const harnessed = harness()
    const response = await handleAgentRequest(harnessed.deps, new Request(address, {
      method: 'POST',
      headers: { ...authorized, 'Content-Type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    }))
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

/* ------------------------------------------------------------------ *
 * The audit
 * ------------------------------------------------------------------ */

describe('auditen', () => {
  it('skriver én rad per melding, med operasjonsnavnet et REST-kall ville brukt', async () => {
    const harnessed = harness()
    await mcp(harnessed, 'initialize', { protocolVersion: MCP_PROTOCOL_VERSION })
    const created = await callOk(harnessed, tool('create_presentation'), { title: 'Revidert' })

    const operations = harnessed.audit.entries.map((entry) => entry.operation)
    expect(operations).toEqual(['mcp:initialize', 'create_presentation'])

    const write = harnessed.audit.entries[1]
    expect(write.success).toBe(true)
    expect(write.presentationId).toBe(created.presentationId)
    expect(write.tokenName).toBe('Testagenten')
  })

  it('noterer statusen feilkoden ville hatt over HTTP, så begge transportene kan leses sammen', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    await callOk(harnessed, tool('set_slide_title'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: deck.revision,
      spans: [{ text: 'Først' }],
    })
    await callError(harnessed, tool('set_slide_title'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: deck.revision,
      spans: [{ text: 'Etterpå' }],
    })

    const conflict = harnessed.audit.entries.at(-1)
    expect(conflict?.errorCode).toBe('CONFLICT')
    expect(conflict?.status).toBe(409)
  })

  it('lagrer aldri innholdet i kallet', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    const secret = 'Hemmelig innhold som aldri skal ligge i auditen'
    await callOk(harnessed, tool('set_zone_text'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: secret }] }],
    })

    expect(JSON.stringify(harnessed.audit.entries)).not.toContain('Hemmelig')
  })

  it('noterer også protokolltrafikk, inkludert en metode som ikke finnes', async () => {
    const harnessed = harness()
    await mcp(harnessed, 'resources/list')
    const entry = harnessed.audit.entries.at(-1)
    expect(entry?.operation).toBe('mcp:resources/list')
    expect(entry?.errorCode).toBe('MCP_METHOD_NOT_FOUND')
  })
})
