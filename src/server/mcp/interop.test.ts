// @vitest-environment node
/**
 * The one test with an oracle that is not us.
 *
 * Everything else in this directory checks the endpoint against the protocol as
 * *read* — which is exactly the thing that can be wrong when a transport is
 * implemented by hand rather than taken from a library. So this file starts a
 * real HTTP server, points the official MCP TypeScript SDK's own client at it,
 * and drives it the way a client would: connect, negotiate, list tools, call one,
 * be refused by one.
 *
 * The SDK validates every message it receives against the specification's own
 * schemas, so a wrong `initialize` result, a tool whose `inputSchema` is not an
 * object, or a `CallToolResult` with the wrong shape fails here rather than in
 * whichever client someone tries first. That is what makes it worth a
 * development dependency for a layer that deliberately does not ship one: the
 * SDK is the reference, so it is the test, not the implementation.
 *
 * The server is `node:http` rather than a framework, because the platform hands
 * the deployment a web `Request` and expects a `Response` — this shim is the
 * shortest thing that produces one from a real socket.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AGENT_MCP_PATH } from '../../routing'
import { handleAgentRequest } from '../agent/handler'
import { MCP_PROTOCOL_VERSION } from './tools'
import { TOKEN, closeHarnessDatabases, harness, type Harness } from './testHarness'

let deployment: Harness
let server: Server
let address: URL

/** The deployment, behind a real socket. */
function serve(harnessed: Harness): Server {
  return createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const body = Buffer.concat(chunks)
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        for (const single of Array.isArray(value) ? value : [value ?? '']) {
          if (single) headers.append(name, single)
        }
      }

      const request = new Request(`http://localhost${incoming.url ?? '/'}`, {
        method: incoming.method,
        headers,
        ...(body.byteLength > 0 ? { body } : {}),
      })

      void handleAgentRequest(harnessed.deps, request).then(async (response) => {
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
      })
    })
  })
}

async function connectedClient(): Promise<Client> {
  const client = new Client({ name: 'slaids-interop-test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(address, {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  )
  return client
}

beforeAll(async () => {
  deployment = harness()
  server = serve(deployment)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  address = new URL(`http://127.0.0.1:${port}${AGENT_MCP_PATH}`)
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeHarnessDatabases()
})

describe('den offisielle MCP-klienten mot en ekte socket', () => {
  it('håndhilser, og får en server som bare tilbyr verktøy', async () => {
    const client = await connectedClient()

    expect(client.getServerVersion()).toMatchObject({ name: 'slaids-agent' })
    expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: false } })
    // No resources, no prompts, no sampling: a client that asked would be asking
    // for a second way to read the same decks.
    expect(client.getServerCapabilities()?.resources).toBeUndefined()
    expect(client.getServerCapabilities()?.prompts).toBeUndefined()
    expect(client.getInstructions()).toContain('Slaids')

    await client.close()
  })

  it('lister hele katalogen, og SDK-en godtar hvert eneste skjema', async () => {
    const client = await connectedClient()
    const listed = await client.listTools()

    // The SDK validates each entry against the specification's own schema, so
    // reaching this line is the assertion; the count is only a floor.
    expect(listed.tools.length).toBeGreaterThan(20)
    expect(listed.tools.map((entry) => entry.name)).toContain('slaids_create_presentation')
    expect(listed.nextCursor).toBeUndefined()

    await client.close()
  })

  it('kjører en ekte operasjon og får strukturerte data tilbake', async () => {
    const client = await connectedClient()

    const created = (await client.callTool({
      name: 'slaids_create_presentation',
      arguments: { title: 'Fra en ekte MCP-klient' },
    })) as {
      isError?: boolean
      content: { type: string; text: string }[]
      structuredContent?: { presentationId?: string; title?: string }
    }

    expect(created.isError).toBeFalsy()
    expect(created.structuredContent?.title).toBe('Fra en ekte MCP-klient')
    const presentationId = created.structuredContent?.presentationId
    expect(presentationId).toBeTypeOf('string')

    // And the deck is really there, read back through a second call.
    const listed = (await client.callTool({ name: 'slaids_list_presentations' })) as {
      structuredContent?: { presentations: { id: string }[] }
    }
    expect(listed.structuredContent?.presentations.map((entry) => entry.id)).toContain(
      presentationId,
    )

    await client.close()
  })

  it('leverer en avvisning som et resultat klienten kan lese, ikke som et brudd', async () => {
    const client = await connectedClient()

    const refused = (await client.callTool({
      name: 'slaids_get_presentation',
      arguments: { presentationId: 'p_finnes_ikke' },
    })) as { isError?: boolean; structuredContent?: { error: { code: string } } }

    expect(refused.isError).toBe(true)
    expect(refused.structuredContent?.error.code).toBe('PRESENTATION_NOT_FOUND')

    // The connection is still usable afterwards — a refusal is an answer.
    expect((await client.listTools()).tools.length).toBeGreaterThan(0)
    await client.close()
  })

  it('avviser en klient uten token, slik resten av API-et gjør', async () => {
    const client = new Client({ name: 'uten-token', version: '1.0.0' })
    await expect(client.connect(new StreamableHTTPClientTransport(address))).rejects.toThrow()
  })

  it('lar den nyeste offisielle klienten falle ned til revisjonen serveren har', async () => {
    // The SDK asks for its own newest revision, which this server does not
    // implement. Narrowing what Slaids announces to the one revision it really
    // does implement must not break that client — the negotiation is what it is
    // for, and the client accepts the answer and carries on.
    const client = await connectedClient()
    expect((await client.listTools()).tools.length).toBeGreaterThan(0)
    await client.close()
  })

  it('snakker den protokollversjonen den sier den snakker', async () => {
    // Straight over the wire, so the negotiated version is read off the answer
    // rather than off the client's own bookkeeping.
    const response = await fetch(address, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'rå', version: '1.0.0' },
        },
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { protocolVersion: string } }
    expect(body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
  })
})
