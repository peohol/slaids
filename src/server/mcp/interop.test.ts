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
 * the deployment a web `Request` and expects a `Response`; `testServer.ts` is
 * the shortest shim that produces one from a real socket.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { agentImage } from '../../agent/image'
import { realImages } from '../../domain/testImages'
import { MCP_PROTOCOL_VERSION } from './tools'
import { TOKEN, closeHarnessDatabases, harness, type Harness } from './testHarness'
import { listenHarness, type ServedHarness } from './testServer'

let deployment: Harness
let served: ServedHarness
let address: URL

/**
 * A renderer that answers with a real PNG.
 *
 * Not a browser: what this file is for is the *protocol*, and the claim being
 * checked is that a rendered preview reaches a client as MCP's own
 * `ImageContent` — base64 plus a media type — which the SDK validates. That a
 * real Chromium draws the right pixels is `src/render/agentLoop.test.ts`, which
 * makes the same call through the same client.
 */
function pngRenderer() {
  const bytes = realImages.png()
  return () =>
    Promise.resolve({
      ok: true as const,
      value: {
        image: agentImage({ mimeType: 'image/png', bytes, width: 3, height: 2 }),
        fontsReady: true,
        warnings: [],
      },
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
  deployment = harness({ preview: pngRenderer() })
  served = await listenHarness(deployment)
  address = served.address
})

afterAll(async () => {
  await served.close()
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

  it('leverer et rendret preview som en image-blokk SDK-en godtar', async () => {
    const client = await connectedClient()

    const created = (await client.callTool({
      name: 'slaids_create_presentation',
      arguments: { title: 'Med preview' },
    })) as { structuredContent?: { presentationId: string; slides: { slideId: string }[] } }
    const deck = created.structuredContent
    if (!deck) throw new Error('Ingen presentasjon ble opprettet.')

    const rendered = (await client.callTool({
      name: 'slaids_render_slide_preview',
      arguments: { presentationId: deck.presentationId, slideId: deck.slides[0].slideId },
    })) as {
      isError?: boolean
      content: { type: string; text?: string; data?: string; mimeType?: string }[]
      structuredContent?: {
        image: { mimeType: string; width: number; height: number; byteLength: number }
        pageKind: string
        fontsReady: boolean
      }
    }

    expect(rendered.isError).toBeFalsy()

    // Reaching this line at all means the SDK validated the result against the
    // specification's `CallToolResult` — an image block with the wrong shape,
    // or base64 that is not a string, fails inside `callTool`.
    const image = rendered.content.find((block) => block.type === 'image')
    if (!image) throw new Error('Previewet kom ikke som en image-blokk.')
    expect(image.mimeType).toBe('image/png')
    expect(typeof image.data).toBe('string')
    // Visual content a client can actually decode, not a base64 string in prose.
    const bytes = Buffer.from(image.data ?? '', 'base64')
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(bytes.byteLength).toBe(rendered.structuredContent?.image.byteLength)

    // The structured half describes the picture and does not repeat it: bytes in
    // `structuredContent` would be a second copy in everything that logs JSON.
    expect(rendered.structuredContent?.image.mimeType).toBe('image/png')
    expect(rendered.structuredContent?.pageKind).toBe('authored-slide')
    expect(JSON.stringify(rendered.structuredContent)).not.toContain(image.data)

    // And the text block is still the structured half, for a client that only
    // shows text.
    const text = rendered.content.find((block) => block.type === 'text')?.text ?? ''
    expect(JSON.parse(text)).toEqual(rendered.structuredContent)

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
