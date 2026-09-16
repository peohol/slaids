// @vitest-environment node
/**
 * The whole journey, walked the way an outside agent walks it.
 *
 * Everything else in this directory checks one property at a time, and checks
 * it by handing `handleAgentRequest` a `Request` built in the test. Both of
 * those are right, and together they leave one claim unproved — the claim the
 * API actually makes:
 *
 *   **From «no presentation» to a stored, validated, renderable deck, over the
 *   transport a stranger uses, with the credential ChatGPT uses.**
 *
 * So nothing here is shortened. The deployment listens on a real socket. The
 * client is the official MCP SDK's own, which validates every message against
 * the specification's schemas, so a malformed result fails here rather than in
 * whichever client somebody tries first. The credential is a real ES256 access
 * token, verified against a published key set through the same
 * `authenticateOAuthToken` production calls — not an agent token, because
 * ChatGPT cannot be handed one and the OAuth family is therefore the one that
 * has to work. And the preview is drawn by a real Chromium over the app's own
 * stylesheets, because "renderable" is a claim about pixels.
 *
 * The one thing that is not production is where the rows land: a Dexie store
 * instead of Supabase, built per owner exactly as `agentContextFor` builds one
 * per principal. That is the seam `supabaseRepository.test.ts` covers, and the
 * property this file needs from it — a repository pinned to the token's owner —
 * is the property the harness reproduces.
 *
 * Two things are deliberately done the long way round:
 *
 *  - **the deck is read back over a second connection.** A client that reads
 *    what it just wrote can be reading its own memory; a new transport, a new
 *    handshake and a new `AgentContext` cannot.
 *  - **the deck is deleted at the end, and the deletion is checked.** A journey
 *    that leaves its subject behind has not tested the way out, and the way out
 *    is the operation an agent most needs to be able to trust.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { FONT_SCALE_RANGE, SPACING_RANGE } from '../../domain/metrics'
import { realImageBase64 } from '../../domain/testImages'
import { operations } from '../../agent/registry'
import { canonicalMcpUrl } from '../../routing'
import { chromiumSlidePreviewRenderer } from '../../render/preview'
import { decodePng, distinctColours } from '../../render/png'
import { pngPixelSize } from '../../render/rasterize'
import { authenticateOAuthToken } from '../agent/oauth'
import {
  OTHER_OWNER,
  TEST_CLIENT,
  TEST_ISSUER,
  TEST_OWNER,
  testAuthorizationServer,
  type TestAuthorizationServer,
} from '../agent/testOAuth'
import { closeHarnessDatabases, harness, type Harness } from './testHarness'
import { listenHarness, type ServedHarness } from './testServer'

/** A browser launch plus a font fetch is seconds, not milliseconds. */
const JOURNEY_TIMEOUT_MS = 180_000

/** The address this deployment answers on, as the metadata names it. */
const PUBLIC_ORIGIN = 'https://www.slaids.example'

let deployment: Harness
let served: ServedHarness
let authorization: TestAuthorizationServer
let accessToken: string

beforeAll(async () => {
  authorization = await testAuthorizationServer()
  // Two users of the same project, both allowed in. One owner would make the
  // isolation test below vacuous: a stranger who is refused at the door has
  // proved nothing about whether an accepted caller can reach another owner's
  // decks, and it is the second question the repository pinning answers.
  const config = authorization.config({ owners: new Set([TEST_OWNER, OTHER_OWNER]) })
  const jwks = authorization.jwks()

  // Wired exactly as `src/server/agent/index.ts` wires production: the same
  // verification function, the same config object, the same key cache. Only the
  // key set is served from memory rather than from Supabase.
  deployment = harness({
    preview: chromiumSlidePreviewRenderer(),
    oauth: config,
    publicOrigin: PUBLIC_ORIGIN,
    authenticateOAuth: (token) =>
      authenticateOAuthToken({ token, config, jwks, now: new Date() }),
  })
  served = await listenHarness(deployment)
  accessToken = await authorization.sign()
}, JOURNEY_TIMEOUT_MS)

afterAll(async () => {
  await served.close()
  await closeHarnessDatabases()
})

/**
 * A connected client, holding an OAuth access token and nothing else.
 *
 * Every call below goes through one of these, which is what makes the file a
 * test of the deployment rather than of the handler: the SDK opens a socket,
 * negotiates the protocol revision, and validates what comes back.
 */
async function agent(token = accessToken): Promise<Client> {
  const client = new Client({ name: 'slaids-journey-test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(served.address, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

interface ToolAnswer {
  isError?: boolean
  content: { type: string; text?: string; data?: string; mimeType?: string }[]
  structuredContent?: Record<string, unknown>
}

/**
 * One tool call that is expected to work, unwrapped to its structured half.
 *
 * Both refusal shapes are turned into a message that names the tool and carries
 * Slaids' own error: a tool that *ran* and said no comes back as a result with
 * `isError`, while arguments that never matched the schema come back as a
 * JSON-RPC error the SDK raises. The second one arrives as an `McpError` whose
 * `data` is the Agent Core error object, and a failure that threw that away
 * would leave a red run saying only "-32602".
 */
async function call<T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  let result: ToolAnswer
  try {
    result = (await client.callTool({ name: `slaids_${name}`, arguments: args })) as ToolAnswer
  } catch (error) {
    const data = (error as { data?: unknown }).data
    throw new Error(`«${name}» ble avvist som protokollfeil: ${JSON.stringify(data ?? error)}`, {
      cause: error,
    })
  }
  if (result.isError) {
    throw new Error(
      `«${name}» ble avvist: ${JSON.stringify(result.structuredContent ?? result.content)}`,
    )
  }
  return result.structuredContent as T
}

/** One tool call the deck's own rules are expected to refuse. */
async function refused(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ code: string; message: string; details?: Record<string, unknown> }> {
  const result = (await client.callTool({
    name: `slaids_${name}`,
    arguments: args,
  })) as ToolAnswer
  if (!result.isError) throw new Error(`Forventet at «${name}» ble avvist, men den gikk gjennom.`)
  const error = (result.structuredContent as { error?: { code: string; message: string } })?.error
  if (!error) throw new Error(`«${name}» ble avvist uten et strukturert feilobjekt.`)
  return error as { code: string; message: string; details?: Record<string, unknown> }
}

/* ------------------------------------------------------------------ *
 * The shapes this file reads back. Only the fields it asserts on.
 * ------------------------------------------------------------------ */

interface CreatedDeck {
  presentationId: string
  title: string
  revision: string
  slideCount: number
  slides: { slideId: string; index: number; kind: string }[]
}

interface DeckView extends CreatedDeck {
  theme: {
    headingFont: { fontId: string | null }
    bodyFont: { fontId: string | null }
    spacing: number
    fontScale: number
  }
  assetCount: number
  referenceCount: number
  sandboxCount: number
}

interface Zone {
  nodeId: string
  kind: string
  empty?: boolean
  fits?: boolean
  contentKind?: string
  image?: { assetId: string | null }
  subfields?: { subfieldId: string; blocks: unknown[] }[]
}

interface SlideInspection {
  presentationId: string
  slideId: string
  revision: string
  rootNodeId: string
  title?: string
  zones: Zone[]
}

interface ValidationReport {
  presentationId: string
  revision: string
  valid: boolean
  issues: { code: string }[]
}

interface PreviewAnswer {
  presentationId: string
  slideId: string
  pageKind: string
  revision: string
  scale: number
  fontsReady: boolean
  warnings: string[]
  image: { mimeType: string; width: number; height: number; byteLength: number }
}

function zoneOf(inspection: SlideInspection, nodeId: string): Zone {
  const zone = inspection.zones.find((entry) => entry.nodeId === nodeId)
  if (!zone) throw new Error(`Fant ingen sone ${nodeId} i inspeksjonen.`)
  return zone
}

/* ------------------------------------------------------------------ *
 * The journey
 * ------------------------------------------------------------------ */

describe('en ekstern agent går hele veien, over MCP og med et OAuth-token', () => {
  it(
    'går fra ingen presentasjon til et lagret, validert og renderbart dekk',
    async () => {
      const client = await agent()

      /* ---- 0. what a client learns before it has done anything ---- */

      // The handshake the SDK just completed, and the catalogue it read. Both
      // are what ChatGPT's tool scan sees, and neither needed a credential —
      // but this connection has one, and gets the same answers.
      expect(client.getServerVersion()).toMatchObject({ name: 'slaids-agent' })
      const catalogue = await client.listTools()
      expect(catalogue.tools.length).toBeGreaterThan(20)
      // Every tool says it needs OAuth, which is how a client knows to send the
      // owner through a login before it calls anything.
      for (const tool of catalogue.tools) {
        expect(tool._meta?.securitySchemes).toBeDefined()
      }

      /* ---- 1. create ---- */

      const created = await call<CreatedDeck>(client, 'create_presentation', {
        title: 'Reisen gjennom agent-API-et',
      })
      const presentationId = created.presentationId
      expect(created.title).toBe('Reisen gjennom agent-API-et')
      // A new deck opens with a front section and one empty content slide.
      expect(created.slideCount).toBe(2)
      const frontSlideId = created.slides[0].slideId
      const firstSlideId = created.slides[1].slideId

      /* ---- 2. read it back ---- */

      const read = await call<DeckView>(client, 'get_presentation', { presentationId })
      expect(read.presentationId).toBe(presentationId)
      expect(read.revision).toBe(created.revision)
      expect(read.slides.map((slide) => slide.slideId)).toEqual([frontSlideId, firstSlideId])

      const listed = await call<{ presentations: { id: string }[] }>(client, 'list_presentations')
      expect(listed.presentations.map((entry) => entry.id)).toContain(presentationId)

      /* ---- 3. the theme, which is global and measured against the whole deck ---- */

      const themed = await call<{ theme: DeckView['theme'] }>(client, 'set_theme', {
        presentationId,
        headingFont: 'quicksand',
        bodyFont: 'atkinson',
        spacing: SPACING_RANGE.min,
        fontScale: FONT_SCALE_RANGE.min,
      })
      expect(themed.theme.headingFont.fontId).toBe('quicksand')
      expect(themed.theme.bodyFont.fontId).toBe('atkinson')
      expect(themed.theme.spacing).toBe(SPACING_RANGE.min)
      expect(themed.theme.fontScale).toBe(FONT_SCALE_RANGE.min)

      /* ---- 4. more pages: a named front, a second slide, a second part ---- */

      await call(client, 'set_section', {
        presentationId,
        slideId: frontSlideId,
        title: 'Agent-API-et',
        subtitle: 'Ende til ende',
      })

      const second = await call<{ slideId: string; index: number }>(client, 'add_slide', {
        presentationId,
      })
      const secondSlideId = second.slideId
      expect(second.index).toBe(2)

      await call(client, 'add_section', { presentationId, title: 'Del to' })
      const third = await call<{ slideId: string; index: number }>(client, 'add_slide', {
        presentationId,
      })
      expect(third.index).toBe(4)

      const grown = await call<DeckView>(client, 'get_presentation', { presentationId })
      expect(grown.slideCount).toBe(5)
      expect(grown.slides.map((slide) => slide.kind)).toEqual([
        'section',
        'content',
        'content',
        'section',
        'content',
      ])

      /* ---- 5. a reference, so the text can cite something real ---- */

      const added = await call<{ reference: { id: string } }>(client, 'add_reference', {
        presentationId,
        title: 'Slaids, agent-API-et',
        authors: 'Holman, P.',
        url: 'https://www.slaids.no',
        year: '2026',
      })
      const referenceId = added.reference.id
      expect(referenceId).toBeTruthy()

      /* ---- 6. zone layout on the first slide ---- */

      const before = await call<SlideInspection>(client, 'inspect_slide', {
        presentationId,
        slideId: firstSlideId,
      })
      const rootNodeId = before.rootNodeId

      const split = await call<{ childNodeIds: string[] }>(client, 'split_zone', {
        presentationId,
        slideId: firstSlideId,
        nodeId: rootNodeId,
        axis: 'x',
        weights: [3, 2],
      })
      expect(split.childNodeIds).toHaveLength(2)
      const [textZone, imageZone] = split.childNodeIds

      // Re-proportioning is its own operation, and the weights are quantised
      // centrally: [6, 4] is the same layout as [3, 2].
      await call(client, 'adjust_split', {
        presentationId,
        slideId: firstSlideId,
        nodeId: rootNodeId,
        weights: [1, 1],
      })

      /* ---- 7. text, with a citation pointing at the reference ---- */

      await call(client, 'set_slide_title', {
        presentationId,
        slideId: firstSlideId,
        spans: [{ text: 'Hva en agent kan gjøre' }],
      })

      await call(client, 'set_zone_text', {
        presentationId,
        slideId: firstSlideId,
        nodeId: textZone,
        blocks: [
          { type: 'accent', spans: [{ text: 'Semantiske operasjoner' }] },
          {
            type: 'bullets',
            items: [
              [{ text: 'Samme domenekommandoer som editoren' }],
              [{ text: 'Samme regler for hva som får plass' }, { citation: [referenceId] }],
            ],
          },
        ],
      })

      /* ---- 8. a real file, carried the only way MCP can carry one ---- */

      const uploaded = await call<{ assetId: string; name: string; byteLength: number }>(
        client,
        'upload_asset',
        {
          presentationId,
          name: 'figur.png',
          // Base64 inside the JSON-RPC message. There is no second request
          // shape on this transport, so this path is the whole of "an agent
          // brought a picture" for every MCP client there is.
          content: { encoding: 'base64', data: realImageBase64.png },
        },
      )
      expect(uploaded.assetId).toBeTruthy()

      await call(client, 'set_zone_asset', {
        presentationId,
        slideId: firstSlideId,
        nodeId: imageZone,
        assetId: uploaded.assetId,
      })

      const withContent = await call<SlideInspection>(client, 'inspect_slide', {
        presentationId,
        slideId: firstSlideId,
      })
      expect(zoneOf(withContent, textZone).subfields?.[0].blocks).toEqual([
        { type: 'accent', spans: [{ text: 'Semantiske operasjoner' }] },
        {
          type: 'bullets',
          items: [
            [{ text: 'Samme domenekommandoer som editoren' }],
            [{ text: 'Samme regler for hva som får plass' }, { citation: [referenceId] }],
          ],
        },
      ])
      expect(zoneOf(withContent, textZone).fits).toBe(true)
      expect(zoneOf(withContent, imageZone).image).toMatchObject({ assetId: uploaded.assetId })

      /* ---- 9. move content, across two slides ---- */

      const target = await call<SlideInspection>(client, 'inspect_slide', {
        presentationId,
        slideId: secondSlideId,
      })
      const targetSplit = await call<{ childNodeIds: string[] }>(client, 'split_zone', {
        presentationId,
        slideId: secondSlideId,
        nodeId: target.rootNodeId,
        axis: 'y',
        weights: [1, 1],
      })
      const [upperZone] = targetSplit.childNodeIds

      await call(client, 'move_zone_content', {
        presentationId,
        fromSlideId: firstSlideId,
        fromNodeId: textZone,
        toSlideId: secondSlideId,
        toNodeId: upperZone,
      })

      /* ---- 10. inspect, and see that the move really moved ---- */

      const emptied = await call<SlideInspection>(client, 'inspect_slide', {
        presentationId,
        slideId: firstSlideId,
      })
      expect(zoneOf(emptied, textZone).empty).toBe(true)
      expect(zoneOf(emptied, textZone).subfields).toBeUndefined()

      const moved = await call<SlideInspection>(client, 'inspect_slide', {
        presentationId,
        slideId: secondSlideId,
      })
      // The content kept its own ids through the move, which is what lets an
      // agent go on addressing the subfields it already knows about.
      expect(zoneOf(moved, upperZone).subfields?.[0].subfieldId).toBe(
        zoneOf(withContent, textZone).subfields?.[0].subfieldId,
      )
      expect(zoneOf(moved, upperZone).fits).toBe(true)

      /* ---- 11. validate: the slide, and the deck as a whole ---- */

      const slideReport = await call<ValidationReport>(client, 'validate_slide', {
        presentationId,
        slideId: firstSlideId,
      })
      expect(slideReport.issues).toEqual([])
      expect(slideReport.valid).toBe(true)

      const deckReport = await call<ValidationReport>(client, 'validate_presentation', {
        presentationId,
      })
      expect(deckReport.issues).toEqual([])
      expect(deckReport.valid).toBe(true)

      /* ---- 12. render it, with Slaids' own renderer ---- */

      const rendered = (await client.callTool({
        name: 'slaids_render_slide_preview',
        arguments: { presentationId, slideId: firstSlideId },
      })) as ToolAnswer
      expect(rendered.isError).toBeFalsy()

      const block = rendered.content.find((entry) => entry.type === 'image')
      expect(block?.mimeType).toBe('image/png')
      const bytes = new Uint8Array(Buffer.from(block?.data ?? '', 'base64'))

      const preview = rendered.structuredContent as unknown as PreviewAnswer
      expect(preview).toMatchObject({
        presentationId,
        slideId: firstSlideId,
        pageKind: 'authored-slide',
        scale: 1,
        image: { mimeType: 'image/png', width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      })
      // A real PNG of the right size, read off the file rather than off the
      // arithmetic that asked for it.
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(pngPixelSize(bytes)).toEqual({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT })
      // Nothing missing from the deck itself. A font warning may stand — the
      // faces come over the network and a sandbox may have none — and
      // `fontsReady` is what says so.
      expect(preview.warnings.filter((warning) => warning.includes('finnes ikke i lageret'))).toEqual([])

      // And something was actually drawn: the title band and the picture each
      // hold more than one colour. A blank rectangle holds exactly one, and is
      // the failure every other assertion in this file would pass through.
      const bitmap = decodePng(bytes)
      expect(distinctColours(bitmap, { x: 400, y: 30, width: 800, height: 60 })).toBeGreaterThan(3)
      expect(
        distinctColours(bitmap, { x: 900, y: 250, width: 600, height: 400 }),
      ).toBeGreaterThan(1)

      await client.close()

      /* ---- 13. it is stored: a second connection says the same thing ---- */

      // A new transport, a new handshake, a new `AgentContext`. Nothing this
      // client reads came from the one that wrote it.
      const returning = await agent()

      const persisted = await call<DeckView>(returning, 'get_presentation', { presentationId })
      expect(persisted.title).toBe('Reisen gjennom agent-API-et')
      expect(persisted.slideCount).toBe(5)
      expect(persisted.theme.headingFont.fontId).toBe('quicksand')
      expect(persisted.theme.spacing).toBe(SPACING_RANGE.min)
      expect(persisted.referenceCount).toBe(1)
      expect(persisted.assetCount).toBe(1)
      // Nothing was displaced along the way: every structural change here had
      // somewhere to put what it moved.
      expect(persisted.sandboxCount).toBe(0)

      const files = await call<{ assets: { assetId: string; name: string }[] }>(
        returning,
        'list_assets',
        { presentationId },
      )
      expect(files.assets.map((entry) => entry.name)).toEqual(['figur.png'])

      const persistedSlide = await call<SlideInspection>(returning, 'inspect_slide', {
        presentationId,
        slideId: secondSlideId,
      })
      expect(zoneOf(persistedSlide, upperZone).subfields?.[0].blocks).toEqual(
        zoneOf(moved, upperZone).subfields?.[0].blocks,
      )

      const persistedReport = await call<ValidationReport>(returning, 'validate_presentation', {
        presentationId,
      })
      expect(persistedReport.valid).toBe(true)

      /* ---- 14. and the way out works too ---- */

      await call(returning, 'delete_presentation', { presentationId })

      const gone = await refused(returning, 'get_presentation', { presentationId })
      expect(gone.code).toBe('PRESENTATION_NOT_FOUND')

      const emptied2 = await call<{ presentations: { id: string }[] }>(
        returning,
        'list_presentations',
      )
      expect(emptied2.presentations.map((entry) => entry.id)).not.toContain(presentationId)

      await returning.close()
    },
    JOURNEY_TIMEOUT_MS,
  )

  it('skrev én auditrad per kall, og tilskrev dem OAuth-klienten', async () => {
    // The owner's own record of what happened, and the only place the two
    // credential families are told apart after authentication.
    const rows = deployment.audit.entries.filter((entry) => entry.ownerId === TEST_OWNER)
    expect(rows.length).toBeGreaterThan(20)

    for (const row of rows) {
      expect(row.principalKind).toBe('oauth')
      expect(row.clientId).toBe(TEST_CLIENT)
      expect(row.tokenId).toBeNull()
    }
    // The journey both created and deleted a deck, and the log says so.
    const operations = rows.map((row) => row.operation)
    // A tool call is filed under the operation's own name, exactly as REST
    // files it — which is what lets an owner read one log for both transports.
    expect(operations).toContain('create_presentation')
    expect(operations).toContain('upload_asset')
    expect(operations).toContain('render_slide_preview')
    expect(operations).toContain('delete_presentation')
  })

  it('navngir seg selv med den kanoniske adressen i metadatadokumentet', async () => {
    // What a client reads *before* it has a credential, fetched over the same
    // socket with no `Authorization` at all. RFC 9728 builds the address by
    // inserting the well-known segment ahead of the resource's own path.
    const response = await fetch(
      `${served.address.origin}/.well-known/oauth-protected-resource/api/agent/v1/mcp`,
    )
    expect(response.status).toBe(200)

    const document = (await response.json()) as {
      resource: string
      authorization_servers: string[]
      bearer_methods_supported: string[]
    }
    // The resource identifier is the pinned origin, not the host this request
    // happened to arrive on — that is what makes it the fixed string RFC 8707
    // requires a client to send back.
    expect(document.resource).toBe(canonicalMcpUrl(PUBLIC_ORIGIN))
    expect(document.authorization_servers).toEqual([TEST_ISSUER])
    expect(document.bearer_methods_supported).toEqual(['header'])
  })
})

/* ------------------------------------------------------------------ *
 * The refusals, as an agent meets them
 * ------------------------------------------------------------------ */

/**
 * A JSON-RPC message sent with a plain HTTP client.
 *
 * Used where the SDK would get in the way rather than help: a `401` is refused
 * by the transport before a `CallToolResult` exists, so the thing under test —
 * the status and the `WWW-Authenticate` header a client is supposed to act on —
 * is not reachable through `callTool` at all.
 */
async function post(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; challenge: string | null; body: unknown }> {
  const response = await fetch(served.address, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return {
    status: response.status,
    challenge: response.headers.get('www-authenticate'),
    body: await response.json(),
  }
}

/** A call whose arguments never matched the schema, unwrapped to Slaids' error. */
async function protocolError(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ code: string; message: string; details?: Record<string, unknown> }> {
  try {
    await client.callTool({ name: `slaids_${name}`, arguments: args })
  } catch (error) {
    const data = (error as { data?: { code: string; message: string } }).data
    if (!data?.code) {
      throw new Error(`«${name}» feilet uten Slaids' eget feilobjekt: ${String(error)}`, {
        cause: error,
      })
    }
    return data as { code: string; message: string; details?: Record<string, unknown> }
  }
  throw new Error(`Forventet at «${name}» ble avvist som protokollfeil, men den gikk gjennom.`)
}

/** A deck with one split slide, for the refusals that need something to aim at. */
async function scratchDeck(client: Client): Promise<{
  presentationId: string
  slideId: string
  zones: string[]
  revision: string
}> {
  const created = await call<CreatedDeck>(client, 'create_presentation', { title: 'Feiltilfeller' })
  const slideId = created.slides[1].slideId
  const inspected = await call<SlideInspection>(client, 'inspect_slide', {
    presentationId: created.presentationId,
    slideId,
  })
  const split = await call<{ childNodeIds: string[] }>(client, 'split_zone', {
    presentationId: created.presentationId,
    slideId,
    nodeId: inspected.rootNodeId,
    axis: 'x',
    weights: [1, 1],
  })
  const after = await call<SlideInspection>(client, 'inspect_slide', {
    presentationId: created.presentationId,
    slideId,
  })
  return {
    presentationId: created.presentationId,
    slideId,
    zones: split.childNodeIds,
    revision: after.revision,
  }
}

describe('feilene en agent faktisk møter', () => {
  it('sier hvilken id som ikke finnes, på hvert nivå', async () => {
    const client = await agent()
    const deck = await scratchDeck(client)

    const noDeck = await refused(client, 'get_presentation', { presentationId: 'p_finnesikke' })
    expect(noDeck.code).toBe('PRESENTATION_NOT_FOUND')

    const noSlide = await refused(client, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: 's_finnesikke',
    })
    expect(noSlide.code).toBe('SLIDE_NOT_FOUND')

    const noZone = await refused(client, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: 'n_finnesikke',
      blocks: [{ type: 'paragraph', spans: [{ text: 'Hei' }] }],
    })
    expect(noZone.code).toBe('NODE_NOT_FOUND')

    // Three levels, three codes. An agent can tell "wrong deck" from "wrong
    // page" from "wrong zone" without reading a sentence.
    await client.close()
  })

  it('nevner det ukjente verktøyet sammen med de som finnes', async () => {
    const client = await agent()
    const unknown = await protocolError(client, 'lag_en_presentasjon_takk')

    expect(unknown.code).toBe('UNKNOWN_OPERATION')
    // The real names come with the refusal, so a misspelling is one round trip
    // rather than a client that has to go and list the tools again.
    expect(unknown.details?.available).toEqual(expect.arrayContaining(['create_presentation']))
    await client.close()
  })

  it('peker på feltet som ikke passer, ikke bare på at noe ikke passer', async () => {
    const client = await agent()
    const deck = await scratchDeck(client)

    const wrong = await protocolError(client, 'set_theme', {
      presentationId: deck.presentationId,
      headingFont: 'comic-sans',
    })
    expect(wrong.code).toBe('INVALID_INPUT')
    const issues = wrong.details?.issues as { path: string }[]
    expect(issues.map((issue) => issue.path)).toContain('headingFont')

    await client.close()
  })

  it('avviser et token som mangler scopet, og sier hvilket', async () => {
    // A token that names Slaids scopes is authoritative: it gets exactly the
    // intersection, never the deployment's default. This one may read.
    const readOnly = await agent(await authorization.sign({ scope: 'presentations:read' }))

    const refusal = await refused(readOnly, 'create_presentation', { title: 'Uten autoritet' })
    expect(refusal.code).toBe('FORBIDDEN_SCOPE')
    expect(refusal.details).toMatchObject({
      operation: 'create_presentation',
      required: ['presentations:write'],
      missing: ['presentations:write'],
    })

    // And the authority it *does* hold still works, so the refusal is about the
    // scope rather than about the token.
    const listed = await call<{ presentations: unknown[] }>(readOnly, 'list_presentations')
    expect(Array.isArray(listed.presentations)).toBe(true)

    await readOnly.close()
  })

  it('svarer CONFLICT når revisjonen er utdatert, og skriver ingenting', async () => {
    const client = await agent()
    const deck = await scratchDeck(client)

    // Somebody else writes first. From the agent's side that is simply a
    // revision it has not seen.
    await call(client, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      spans: [{ text: 'Skrevet av noen andre' }],
    })

    const stale = await refused(client, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: deck.revision,
      spans: [{ text: 'Skrevet mot en gammel lesning' }],
    })
    expect(stale.code).toBe('CONFLICT')

    // The first write is still there: a conflict refuses, it does not half-apply.
    const after = await call<SlideInspection>(client, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(after.title).toBe('Skrevet av noen andre')

    // And the revision the refusal was measured against is readable, so the way
    // forward is one read and one retry.
    const retried = await call<{ slideId: string }>(client, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: after.revision,
      spans: [{ text: 'Skrevet mot en fersk lesning' }],
    })
    expect(retried.slideId).toBe(deck.slideId)

    await client.close()
  })

  it('nekter å peke en sone på en fil som ikke finnes', async () => {
    const client = await agent()
    const deck = await scratchDeck(client)

    const missing = await refused(client, 'set_zone_asset', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.zones[0],
      assetId: 'a_finnesikke',
    })
    expect(missing.code).toBe('ASSET_NOT_FOUND')
    expect(missing.details).toMatchObject({ assetId: 'a_finnesikke' })

    // Nothing was written: the zone is still empty.
    const after = await call<SlideInspection>(client, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(zoneOf(after, deck.zones[0]).empty).toBe(true)

    await client.close()
  })

  it('sier at innholdet ikke får plass, med tall å handle på', async () => {
    const client = await agent()
    const deck = await scratchDeck(client)

    const tooMuch = await refused(client, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.zones[0],
      blocks: Array.from({ length: 40 }, (_unused, index) => ({
        type: 'paragraph',
        spans: [{ text: `Avsnitt ${index + 1}, langt nok til at det ikke er plass til alle sammen.` }],
      })),
    })
    expect(tooMuch.code).toBe('CONTENT_DOES_NOT_FIT')
    // A number, not just a sentence: an agent shortens by an amount rather than
    // by guessing.
    expect(typeof tooMuch.details?.overflow).toBe('number')

    const after = await call<SlideInspection>(client, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(zoneOf(after, deck.zones[0]).empty).toBe(true)

    await client.close()
  })

  it('slipper ingen inn på en annen eiers presentasjon', async () => {
    const owner = await agent()
    const deck = await scratchDeck(owner)

    // A real user of the same project, allowed into Slaids, with a valid token.
    // Everything about this caller is legitimate except which decks are theirs.
    const stranger = await agent(await authorization.sign({ sub: OTHER_OWNER }))

    const hidden = await refused(stranger, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    // Not `FORBIDDEN`: the repository is pinned to the caller's own owner, so
    // the deck is not refused, it is not there. A caller cannot use this to
    // find out whether somebody else's id exists.
    expect(hidden.code).toBe('PRESENTATION_NOT_FOUND')

    const theirs = await call<{ presentations: { id: string }[] }>(stranger, 'list_presentations')
    expect(theirs.presentations.map((entry) => entry.id)).not.toContain(deck.presentationId)

    // And a write is refused the same way, so isolation is not a read-only
    // property.
    const blocked = await refused(stranger, 'set_presentation_title', {
      presentationId: deck.presentationId,
      title: 'Overtatt',
    })
    expect(blocked.code).toBe('PRESENTATION_NOT_FOUND')

    await stranger.close()
    await owner.close()
  })

  it('avviser et token som ikke verifiserer, og sier hvor det skal hentes et nytt', async () => {
    // A token signed by somebody else: three segments, the right shape, and a
    // signature that does not check out against the project's key set.
    const forged = await authorization.sign()
    const tampered = `${forged.slice(0, -4)}AAAA`

    const answer = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'slaids_list_presentations', arguments: {} } },
      { Authorization: `Bearer ${tampered}` },
    )

    expect(answer.status).toBe(401)
    // `invalid_token` is the word that tells a client to refresh rather than to
    // give up, and `resource_metadata` is where it goes to find out how.
    expect(answer.challenge).toContain('error="invalid_token"')
    expect(answer.challenge).toContain(
      `resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/api/agent/v1/mcp"`,
    )
  })

  it('avviser et utløpt token på samme måte, uten å si at det var utløpt', async () => {
    const expired = await authorization.sign({ exp: Math.floor(Date.now() / 1000) - 60 })

    const answer = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'slaids_list_presentations', arguments: {} } },
      { Authorization: `Bearer ${expired}` },
    )

    expect(answer.status).toBe(401)
    expect(answer.challenge).toContain('error="invalid_token"')
    // The body says the same sentence every refusal says. Which of them it was
    // is the owner's to read in the audit, never the caller's.
    expect(JSON.stringify(answer.body)).not.toMatch(/utløpt|expired/i)

    // The owner *can* see it, because this token named a Slaids owner: a
    // credential that is ours and no longer usable is exactly what an audit is
    // for.
    const refusals = deployment.audit.entries.filter(
      (entry) => entry.errorCode === 'OAUTH_TOKEN_EXPIRED',
    )
    expect(refusals.length).toBeGreaterThan(0)
    expect(refusals[refusals.length - 1]).toMatchObject({
      ownerId: TEST_OWNER,
      principalKind: 'oauth',
      clientId: TEST_CLIENT,
    })
  })

  it('lar en klient uten legitimasjon finne veien videre i stedet for å stoppe', async () => {
    // The case mixed authentication exists for: a client that has handshaked
    // and read the catalogue, and only now discovers it needs a credential.
    const answer = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'slaids_list_presentations', arguments: {} },
    })

    expect(answer.status).toBe(401)
    // Nothing was presented, so nothing was rejected: RFC 6750 §3.1 says a
    // challenge for such a request carries no `error`.
    expect(answer.challenge).not.toContain('error=')
    expect(answer.challenge).toContain('resource_metadata=')

    // And the body carries the same challenge where a client that reads bodies
    // will find it, rather than only a status code.
    const result = (answer.body as { result?: { _meta?: Record<string, unknown>; isError?: boolean } })
      .result
    expect(result?.isError).toBe(true)
    // A list, because `WWW-Authenticate` may carry several challenges; this
    // deployment offers one, and it is the same string the header carries.
    expect(result?._meta?.['mcp/www_authenticate']).toEqual([answer.challenge])
  })
})

/* ------------------------------------------------------------------ *
 * The whole catalogue, through the real transport
 * ------------------------------------------------------------------ */

/**
 * Every operation, called the way a client calls one.
 *
 * `parity.test.ts` already sweeps the surface in-process and checks that MCP
 * and REST refuse identically. What it cannot see is the half that only exists
 * once there is a socket: a tool definition the SDK will not accept, a result
 * that does not validate against the specification's schema, an answer that
 * never becomes JSON. That is the shape of "it worked in the tests and not
 * through the transport", and it is the shape an operation added later is most
 * likely to have.
 *
 * So the assertion is deliberately weak about *what* each call answers — most
 * of them are refused, because `{}` is not valid input for an operation that
 * addresses a deck — and strict about the answer being one of Slaids' own. A
 * transport-level failure is not a value here; it is a thrown error that is not
 * an `McpError` carrying an Agent Core code, and it fails the test.
 */
describe('hver operasjon er nåbar gjennom den ekte transporten', () => {
  it('svarer med Slaids’ eget resultat eller Slaids’ egen feil, aldri med et transportbrudd', async () => {
    const client = await agent()
    const listed = await client.listTools()

    // The catalogue is the registry, so this is every operation there is — and
    // an operation added later is in it without anybody coming back here.
    expect(listed.tools.length).toBe(operations.length)

    const unreachable: string[] = []
    for (const tool of listed.tools) {
      try {
        const result = (await client.callTool({ name: tool.name, arguments: {} })) as ToolAnswer
        // The SDK validated this against `CallToolResult` on the way in. What
        // is left to say is that a refusal carries Slaids' own error object
        // rather than only prose.
        if (result.isError) {
          const error = (result.structuredContent as { error?: { code?: string } })?.error
          if (!error?.code) unreachable.push(`${tool.name}: avvisning uten feilkode`)
        }
      } catch (error) {
        const code = (error as { data?: { code?: string } }).data?.code
        if (!code) unreachable.push(`${tool.name}: ${String(error)}`)
      }
    }

    expect(unreachable).toEqual([])
    await client.close()
  }, JOURNEY_TIMEOUT_MS)
})
