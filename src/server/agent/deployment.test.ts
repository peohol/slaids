// @vitest-environment node
/**
 * The routing that happens *before* this directory's one function runs.
 *
 * `src/server/agent/handler.test.ts` drives the router with `Request` objects
 * it builds itself, so every address in it is correct by construction. That is
 * exactly the blind spot this file exists for: the agent API's first production
 * failure was not in the handler at all. `GET /api/agent/v1/operations` came
 * back with the catalogue while `POST /api/agent/v1/operations/<name>` — the
 * address every single operation is called at — came back as Vercel's own
 * `NOT_FOUND` text page, which an agent then tried to parse as JSON. The
 * request never reached `serveAgentApi`, and no unit test of `serveAgentApi`
 * could have noticed.
 *
 * The cause was routing the API by file name: a `[...path]` catch-all is
 * expanded by the platform, out of sight of the repository, and what it
 * actually expanded to was one segment. So this test asserts the shape that
 * removes the guesswork instead of the shape that failed:
 *
 *  - one **static** function under `api/`, whose address is its file name;
 *  - an **explicit** rewrite in `vercel.json` for everything under the version
 *    prefix, compiled here by Vercel's own `convertRewrites` — the same code
 *    that turns `vercel.json` into the deployment's route table;
 *  - and the SPA rewrite still never touching `/api/`.
 *
 * It then follows an address the whole way: through the rewrite, into the
 * function's URL, through the router and out as the operation's own answer. Two
 * segments after the version prefix is the case that was broken, so it is the
 * case that is checked.
 *
 * It lives under `src/` rather than next to `api/agent/v1.ts` for a deployment
 * reason of its own: Vercel turns *every* `.ts` file under `api/` into a public
 * function, so a test file there would ship as an endpoint.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { convertRewrites } from '@vercel/routing-utils'
import { agentImage } from '../../agent/image'
import type { SlidePreviewRenderer } from '../../agent/preview'
import { realImages } from '../../domain/testImages'
import type { AgentContext } from '../../agent/types'
import { runOperation } from '../../agent/registry'
import { DexieSlaidsRepository } from '../../persistence/dexieRepository'
import { SlaidsDatabase } from '../../persistence/db'
import { AGENT_API_BASE_PATH, AGENT_API_PATH_PARAM, AGENT_MCP_PATH } from '../../routing'
import type { AgentAuditRecord, AgentAuditSink } from './audit'
import { handleAgentRequest, type AgentApiDeps } from './handler'
import type { AgentPrincipal, AuthOutcome } from './tokens'

/** The repository root: this test reads the deployment's own files. */
const ROOT = process.cwd()
const ORIGIN = 'https://slaids.example'
const TOKEN = 'slaids_at_0123456789012345678901234567890123456789042'

interface VercelConfig {
  rewrites?: { source: string; destination: string }[]
  functions?: Record<string, { includeFiles?: string; maxDuration?: number }>
}

const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as VercelConfig
const rewrites = config.rewrites ?? []

/**
 * The Chromium the preview renders with, and why it needs saying twice.
 *
 * `@sparticuz/chromium` is an ordinary dependency, so the platform's dependency
 * tracer follows the *import* and packages the JavaScript. What it cannot see is
 * that the package then reads a browser out of its own `bin/` directory at
 * runtime: those are brotli blobs, reached by a path computed from
 * `import.meta.url`, and nothing in any import graph mentions them. A deployment
 * without them type-checks, builds, deploys green, and answers every preview
 * with "the input directory does not exist".
 *
 * So they are listed explicitly, and asserted here — this is precisely the
 * class of failure that only production would otherwise report.
 */
const CHROMIUM_BIN_GLOB = 'node_modules/@sparticuz/chromium/bin/**'

/**
 * Every function the platform builds from `api/`, keyed by the address it
 * answers on. `api/agent/v1.ts` is `/api/agent/v1`, and that is the whole rule
 * — which is the point: an address that comes from a file name is an address
 * the repository can state, and one that comes from a `[...]` expansion is not.
 */
function apiFunctions(directory = join(ROOT, 'api')): Map<string, string> {
  const found = new Map<string, string>()
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const [route, file] of apiFunctions(full)) found.set(route, file)
      continue
    }
    if (extname(entry.name) !== '.ts') continue
    const path = relative(ROOT, full).replace(/\.ts$/, '')
    found.set(`/${path}`, relative(ROOT, full))
  }
  return found
}

const functions = apiFunctions()

/** `$1` and `$name` in a rewrite destination, filled in from the match. */
function fillCaptures(destination: string, match: RegExpExecArray): string {
  return destination.replace(/\$(\d+|[A-Za-z_][A-Za-z0-9_]*)/g, (_whole, reference: string) => {
    const captured = /^\d+$/.test(reference)
      ? match[Number(reference)]
      : match.groups?.[reference]
    return captured ?? ''
  })
}

interface Routed {
  /** The file the platform would invoke, repo-relative. */
  file: string
  /** The URL that function is handed, rewrite parameters and all. */
  url: URL
}

/**
 * What the edge does with one public address.
 *
 * The order is the platform's: a request that matches a file is served by it,
 * and only what is left over reaches the rewrites. The rewritten destination is
 * looked up the same way, and the incoming query survives the rewrite — all
 * three are facts this test would be worthless without, and all three are how
 * Vercel documents rewrites to behave.
 */
function routeOf(address: string): Routed | null {
  const requested = new URL(address, ORIGIN)

  const direct = functions.get(requested.pathname)
  if (direct) return { file: direct, url: requested }

  for (const route of convertRewrites(rewrites)) {
    const match = new RegExp(route.src ?? '').exec(requested.pathname)
    if (!match) continue

    const destination = new URL(fillCaptures(route.dest ?? '', match), ORIGIN)
    for (const [key, value] of requested.searchParams) destination.searchParams.append(key, value)
    const file = functions.get(destination.pathname)
    return file ? { file, url: destination } : null
  }
  return null
}

describe('adressene til agent-API-et', () => {
  it('serveres av én statisk funksjon, ikke av en catch-all plattformen utvider selv', () => {
    // Every file under `api/` becomes a public endpoint, so the list is the
    // deployment's whole function surface — one entry, at the API's base path,
    // with no `[...]` for the platform to expand on its own.
    expect([...functions.keys()]).toEqual([AGENT_API_BASE_PATH])
  })

  it.each([
    AGENT_API_BASE_PATH,
    `${AGENT_API_BASE_PATH}/operations`,
    `${AGENT_API_BASE_PATH}/operations/list_presentations`,
    `${AGENT_API_BASE_PATH}/operations/upload_asset?presentationId=p_1&name=figur.png`,
    `${AGENT_API_BASE_PATH}/operations/render_slide_preview`,
    AGENT_MCP_PATH,
  ])('%s når inngangsfilen', (address) => {
    expect(routeOf(address)?.file).toBe(join('api', 'agent', 'v1.ts'))
  })

  it('bærer stien videre i parameteren ruteren pakker den ut av', () => {
    const routed = routeOf(`${AGENT_API_BASE_PATH}/operations/list_presentations`)
    expect(routed?.url.searchParams.get(AGENT_API_PATH_PARAM)).toBe('operations/list_presentations')
  })

  it('lar en råopplastings egne query-felt stå urørt gjennom rewriten', () => {
    const routed = routeOf(`${AGENT_API_BASE_PATH}/operations/upload_asset?presentationId=p_1&name=figur.png`)
    expect(routed?.url.searchParams.get('presentationId')).toBe('p_1')
    expect(routed?.url.searchParams.get('name')).toBe('figur.png')
  })

  it('pakker Chromium-binærene med funksjonen, som ingen importgraf nevner', () => {
    const entry = config.functions?.[join('api', 'agent', 'v1.ts')]
    expect(entry?.includeFiles).toBe(CHROMIUM_BIN_GLOB)
    // A browser launch plus a first inflation is seconds, not milliseconds, so
    // the default ten is not enough for the first preview a cold instance draws.
    expect(entry?.maxDuration).toBeGreaterThanOrEqual(30)
  })

  it('lister nøyaktig den filen som faktisk deployes', () => {
    // The `functions` key is matched against the source path, so a rename of
    // the entry point that forgot this line would silently drop the browser.
    expect([...functions.values()]).toEqual(Object.keys(config.functions ?? {}))
  })

  it.each([
    '/api/agent/v1',
    '/api/agent/v1/operations',
    '/api/agent/v1/operations/list_presentations',
    '/api/agent/v1/mcp',
    '/api/noe-helt-annet',
  ])('lar SPA-rewriten aldri svelge %s', (address) => {
    const spa = convertRewrites(rewrites).find((route) => route.dest === '/index.html')
    expect(spa).toBeDefined()
    expect(new RegExp(spa?.src ?? '').test(address)).toBe(false)
  })
})

class MemoryAudit implements AgentAuditSink {
  readonly entries: AgentAuditRecord[] = []

  record(entry: AgentAuditRecord): Promise<void> {
    this.entries.push(entry)
    return Promise.resolve()
  }
}

let counter = 0
const databases: SlaidsDatabase[] = []

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

interface Deployment {
  deps: AgentApiDeps
  context: AgentContext
}

function deployment(options: { preview?: SlidePreviewRenderer } = {}): Deployment {
  counter += 1
  const database = new SlaidsDatabase(`slaids-api-routing-${counter}`)
  databases.push(database)
  const context: AgentContext = {
    repository: new DexieSlaidsRepository(database),
    ...(options.preview ? { preview: options.preview } : {}),
  }
  const principal: AgentPrincipal = {
    tokenId: 'token-1',
    tokenName: 'Testagenten',
    ownerId: 'owner-1',
    scopes: ['presentations:read'],
  }

  return {
    context,
    deps: {
      authenticate: (presented): Promise<AuthOutcome> =>
        Promise.resolve(
          presented === TOKEN ? { ok: true, principal } : { ok: false, reason: 'unknown' },
        ),
      contextFor: () => context,
      audit: new MemoryAudit(),
      maxRequestBytes: 1024 * 1024,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    },
  }
}

function deps(): AgentApiDeps {
  return deployment().deps
}

/** The request the function is handed for a public address, edge and all. */
function deployed(address: string, init: RequestInit): Request {
  const routed = routeOf(address)
  if (!routed) throw new Error(`Ingen funksjon svarer på ${address} med denne deployen.`)
  return new Request(routed.url, init)
}

describe('en adresse med to ledd etter versjonsprefikset, hele veien', () => {
  it('kommer fram til operasjonen og svarer med Slaids-JSON', async () => {
    const response = await handleAgentRequest(
      deps(),
      deployed(`${AGENT_API_BASE_PATH}/operations/list_presentations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: '{}',
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { ok: boolean; operation: string; data: unknown }
    expect(body.ok).toBe(true)
    expect(body.operation).toBe('list_presentations')
    expect(body.data).toEqual({ presentations: [] })
  })

  it('bærer et binært previewsvar hele veien ut, med media-typen intakt', async () => {
    // The preview is the one operation whose answer is not JSON, and the
    // platform is the one thing that can quietly turn that into something else:
    // a rewrite that lost the path, a header the router never set. So the
    // picture is followed the same way the JSON is — through `vercel.json`
    // compiled by Vercel's own rules, into the function's URL, and out.
    const bytes = realImages.png()
    const site = deployment({
      preview: () =>
        Promise.resolve({
          ok: true,
          value: {
            image: agentImage({ mimeType: 'image/png', bytes, width: 1600, height: 900 }),
            fontsReady: true,
            warnings: [],
          },
        }),
    })

    const created = await runOperation(site.context, 'create_presentation', { title: 'Deployet' })
    if (!created.ok) throw new Error(created.error.code)
    const deck = created.value as { presentationId: string; slides: { slideId: string }[] }

    const response = await handleAgentRequest(
      site.deps,
      deployed(`${AGENT_API_BASE_PATH}/operations/render_slide_preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presentationId: deck.presentationId,
          slideId: deck.slides[0].slideId,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-slaids-operation')).toBe('render_slide_preview')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  it('svarer 401 som JSON uten token, ikke plattformens egen side', async () => {
    const response = await handleAgentRequest(
      deps(),
      deployed(`${AGENT_API_BASE_PATH}/operations/list_presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('kommer fram til MCP-endepunktet og svarer JSON-RPC, ikke plattformens 404', async () => {
    // The address that broke before had two segments after the version prefix.
    // This one has one, but it is new, and the deployment that answers it is the
    // same rewrite plus the same static function — so it is followed the whole
    // way here too rather than assumed.
    const response = await handleAgentRequest(
      deps(),
      deployed(AGENT_MCP_PATH, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { jsonrpc: string; result: { tools: unknown[] } }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.result.tools.length).toBeGreaterThan(0)
  })

  it('svarer på katalogen og på basisadressen med det de er', async () => {
    const shared = deps()
    const catalogue = await handleAgentRequest(
      shared,
      deployed(`${AGENT_API_BASE_PATH}/operations`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    )
    expect(catalogue.status).toBe(200)
    const listed = (await catalogue.json()) as { operation: string; data: { operations: unknown[] } }
    expect(listed.operation).toBe('catalogue')
    expect(listed.data.operations.length).toBeGreaterThan(0)

    const index = await handleAgentRequest(
      shared,
      deployed(AGENT_API_BASE_PATH, { method: 'GET', headers: { Authorization: `Bearer ${TOKEN}` } }),
    )
    expect(index.status).toBe(200)
    const meta = (await index.json()) as {
      operation: string
      data: { operations: string; mcp: string }
    }
    expect(meta.operation).toBe('index')
    expect(meta.data.operations).toBe(`${AGENT_API_BASE_PATH}/operations`)
    // A client that guessed the base address should be able to find the MCP
    // endpoint from it, rather than from documentation it may not have.
    expect(meta.data.mcp).toBe(AGENT_MCP_PATH)
  })
})
