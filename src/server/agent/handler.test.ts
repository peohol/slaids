// @vitest-environment node
/**
 * The REST surface, driven with real `Request` objects.
 *
 * Node rather than jsdom on purpose, and it is doing two jobs. The API runs on a
 * server, so `Request`, `Response`, `FormData` and `crypto.subtle` should be the
 * platform's own — a multipart body parsed by jsdom would prove nothing about
 * the thing that runs in production. And it is a standing check that Agent Core
 * and everything under it really is headless: this whole file imports the
 * domain, the commands and the fit estimator with no DOM anywhere.
 *
 * The list of claims is §44's: scopes are enforced server-side, concurrency is
 * visible over the wire, binary uploads do not have to be base64, the audit
 * records the call without recording the content, and REST answers the same
 * thing Agent Core answers in process.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { operations, runOperation } from '../../agent/registry'
import { AGENT_SCOPES, type AgentContext, type AgentScope } from '../../agent/types'
import { realImages } from '../../domain/testImages'
import { DexieSlaidsRepository } from '../../persistence/dexieRepository'
import { SlaidsDatabase } from '../../persistence/db'
import type { AgentAuditRecord, AgentAuditSink } from './audit'
import { AGENT_API_BASE_PATH } from '../../routing'
import { INTERNAL_ERROR_MESSAGE, handleAgentRequest, type AgentApiDeps } from './handler'
import type { AgentPrincipal, AuthOutcome } from './tokens'

const ORIGIN = 'https://slaids.example'
const TOKEN = 'slaids_at_0123456789012345678901234567890123456789012'
const OTHER_TOKEN = 'slaids_at_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO'

let counter = 0
const databases: SlaidsDatabase[] = []

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

class MemoryAudit implements AgentAuditSink {
  readonly entries: AgentAuditRecord[] = []

  record(entry: AgentAuditRecord): Promise<void> {
    this.entries.push(entry)
    return Promise.resolve()
  }
}

interface Harness {
  deps: AgentApiDeps
  audit: MemoryAudit
  context: AgentContext
}

/**
 * A deployment with one token in it.
 *
 * The repository is the real Dexie one, so a claim like "nothing was written"
 * is about stored state rather than about which method a stub saw.
 */
function harness(options: { scopes?: AgentScope[]; principal?: Partial<AgentPrincipal> } = {}): Harness {
  counter += 1
  const database = new SlaidsDatabase(`slaids-agent-api-${counter}`)
  databases.push(database)
  const context: AgentContext = { repository: new DexieSlaidsRepository(database) }
  const audit = new MemoryAudit()

  const principal: AgentPrincipal = {
    tokenId: 'token-1',
    tokenName: 'Testagenten',
    ownerId: 'owner-1',
    scopes: options.scopes ?? ['presentations:read', 'presentations:write', 'assets:write'],
    ...options.principal,
  }

  return {
    audit,
    context,
    deps: {
      authenticate: (presented): Promise<AuthOutcome> =>
        Promise.resolve(
          presented === TOKEN ? { ok: true, principal } : { ok: false, reason: 'unknown' },
        ),
      contextFor: () => context,
      audit,
      maxRequestBytes: 1024 * 1024,
      now: () => new Date('2026-09-02T12:00:00.000Z'),
    },
  }
}

function url(path: string): string {
  return `${ORIGIN}${AGENT_API_BASE_PATH}${path}`
}

function authorized(token = TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

async function call(
  harnessed: Harness,
  operation: string,
  input: unknown,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handleAgentRequest(
    harnessed.deps,
    new Request(url(`/operations/${operation}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authorized(), ...(init.headers ?? {}) },
      body: JSON.stringify(input),
      ...init,
    }),
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

function dataOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.data as Record<string, unknown>
}

function errorOf(body: Record<string, unknown>): { code: string; message: string; details?: Record<string, unknown> } {
  return body.error as { code: string; message: string; details?: Record<string, unknown> }
}

async function newPresentation(harnessed: Harness, title = 'Agentdekk'): Promise<{ id: string; revision: string }> {
  const created = await call(harnessed, 'create_presentation', { title })
  expect(created.status).toBe(200)
  return {
    id: dataOf(created.body).presentationId as string,
    revision: created.body.revision as string,
  }
}

/* ------------------------------------------------------------------ *
 * Authentication
 * ------------------------------------------------------------------ */

describe('autentisering', () => {
  it('krever et token, og sier hvordan det sendes', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(url('/operations'), { method: 'GET' }),
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
    expect(errorOf((await response.json()) as Record<string, unknown>).code).toBe('UNAUTHENTICATED')
  })

  it('svarer likt på ukjent, feilformet og manglende token', async () => {
    const deps = harness().deps
    const bodies = await Promise.all(
      [
        new Request(url('/operations'), { method: 'GET' }),
        new Request(url('/operations'), { method: 'GET', headers: { Authorization: 'Bearer tull' } }),
        new Request(url('/operations'), { method: 'GET', headers: authorized(OTHER_TOKEN) }),
        new Request(url('/operations'), { method: 'GET', headers: { Authorization: TOKEN } }),
      ].map(async (request) => {
        const response = await handleAgentRequest(deps, request)
        return { status: response.status, body: await response.text() }
      }),
    )
    // One answer for every reason. Telling them apart would let a guesser learn
    // that a token exists and has merely been revoked.
    for (const outcome of bodies) {
      expect(outcome.status).toBe(401)
      expect(outcome.body).toBe(bodies[0].body)
    }
  })

  it('lar ingen kartlegge flaten uten et token', async () => {
    // A 404 here and a 405 there is a map. Authentication comes first.
    const response = await handleAgentRequest(
      harness().deps,
      new Request(url('/finnes-ikke'), { method: 'DELETE' }),
    )
    expect(response.status).toBe(401)
  })

  it('slipper preflight gjennom uten token', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(url('/operations'), { method: 'OPTIONS' }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    // No credentials: a page without a token gains nothing from being allowed
    // to ask, and there is no cookie for it to ride on.
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('lekker aldri en uventet feils egen tekst til kalleren', async () => {
    // The exception's message is written by whatever threw — a Postgres driver,
    // the Supabase client — and those name relations, constraints and hosts.
    // The caller gets one fixed sentence; the detail goes to the server log,
    // which only the owner can read.
    const secret =
      'relation "slaids_presentations" does not exist at db.hemmelig-prosjekt.supabase.co:5432 (key sb_secret_lekkasje)'
    const api = harness()
    api.deps.authenticate = () => {
      throw new Error(secret)
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await handleAgentRequest(
      api.deps,
      new Request(url('/operations'), { method: 'GET', headers: authorized() }),
    )
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(body).toContain('INTERNAL_ERROR')
    for (const fragment of [
      secret,
      'slaids_presentations',
      'hemmelig-prosjekt',
      'sb_secret_lekkasje',
      '5432',
    ]) {
      expect(body).not.toContain(fragment)
    }
    expect(JSON.parse(body)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE },
    })

    // Not swallowed either: the owner still gets the whole thing, server-side.
    expect(logged).toHaveBeenCalled()
    expect(logged.mock.calls.flat().some((argument) => String(argument).includes(secret))).toBe(true)
    logged.mockRestore()
  })

  it('svarer 404 for en adresse som ikke er agent-API-et i det hele tatt', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(`${ORIGIN}/api/annet`, { method: 'GET', headers: authorized() }),
    )
    expect(response.status).toBe(404)
  })
})

/* ------------------------------------------------------------------ *
 * The catalogue
 * ------------------------------------------------------------------ */

describe('katalogen', () => {
  it('kommer fra describeOperations(), med scopes og JSON Schema', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(url('/operations'), { method: 'GET', headers: authorized() }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    const listed = dataOf(body).operations as {
      name: string
      requiredScopes: string[]
      inputSchema: Record<string, unknown>
    }[]

    const upload = listed.find((entry) => entry.name === 'upload_asset')
    expect(upload?.requiredScopes).toEqual(['assets:write'])
    expect(upload?.inputSchema).toMatchObject({ type: 'object' })
    expect(listed.find((entry) => entry.name === 'set_sharing')?.requiredScopes).toEqual([
      'sharing:write',
    ])
  })

  it('avviser feil metode med Allow', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(url('/operations'), { method: 'POST', headers: authorized() }),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toContain('GET')
  })

  it('svarer på rot-adressen med hvor katalogen er', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(url(''), { method: 'GET', headers: authorized() }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(dataOf(body)).toMatchObject({ version: 'v1', operations: `${AGENT_API_BASE_PATH}/operations` })
  })
})

/* ------------------------------------------------------------------ *
 * Scopes
 * ------------------------------------------------------------------ */

describe('scopes håndheves serverside', () => {
  it('lar et lesetoken lese og ikke skrive', async () => {
    const readOnly = harness({ scopes: ['presentations:read'] })
    const listed = await call(readOnly, 'list_presentations', {})
    expect(listed.status).toBe(200)

    const refused = await call(readOnly, 'create_presentation', { title: 'Nei' })
    expect(refused.status).toBe(403)
    expect(errorOf(refused.body)).toMatchObject({
      code: 'FORBIDDEN_SCOPE',
      details: { required: ['presentations:write'], missing: ['presentations:write'] },
    })

    // And nothing was written: the refusal is before Agent Core, not inside it.
    expect(await readOnly.context.repository.listPresentations()).toEqual([])
  })

  it('lar vanlig redigering ikke gi rett til å publisere', async () => {
    const editor = harness({ scopes: ['presentations:read', 'presentations:write'] })
    const { id } = await newPresentation(editor)

    const refused = await call(editor, 'set_sharing', { presentationId: id, shared: true })
    expect(refused.status).toBe(403)
    expect(errorOf(refused.body).details).toMatchObject({ missing: ['sharing:write'] })
  })

  it('skiller filopplasting fra sliderredigering', async () => {
    const editor = harness({ scopes: ['presentations:read', 'presentations:write'] })
    const { id } = await newPresentation(editor)
    const refused = await call(editor, 'upload_asset', {
      presentationId: id,
      name: 'bilde.png',
      content: { encoding: 'base64', data: '' },
    })
    expect(refused.status).toBe(403)
    expect(errorOf(refused.body).details).toMatchObject({ missing: ['assets:write'] })
  })

  it('håndhever hvert eneste scope hver eneste operasjon ber om', async () => {
    // Generated from the registry rather than listed here, which is the whole
    // point: an operation added later is covered the day it is added, and an
    // operation that quietly stopped checking its scope fails this.
    for (const operation of operations) {
      for (const required of operation.scopes) {
        const withoutOne = harness({
          scopes: AGENT_SCOPES.filter((scope) => scope !== required),
        })
        const refused = await call(withoutOne, operation.name, {})
        expect(
          { operation: operation.name, without: required, status: refused.status },
        ).toEqual({ operation: operation.name, without: required, status: 403 })
        expect(errorOf(refused.body).details).toMatchObject({ missing: [required] })
      }
    }
  })

  it('leser ikke kroppen før scopet er avklart', async () => {
    // An unauthorised caller must not be able to make the server buffer
    // megabytes for it. The body here is far over the limit, and the answer is
    // the scope refusal rather than the size one.
    const readOnly = harness({ scopes: ['presentations:read'] })
    readOnly.deps.maxRequestBytes = 32
    const refused = await call(readOnly, 'create_presentation', { title: 'x'.repeat(500) })
    expect(refused.status).toBe(403)
  })
})

/* ------------------------------------------------------------------ *
 * Results, statuses and concurrency
 * ------------------------------------------------------------------ */

describe('resultater over ledningen', () => {
  it('svarer med revisjonen både i konvolutten og i data', async () => {
    const api = harness()
    const created = await call(api, 'create_presentation', { title: 'Med revisjon' })
    expect(created.body.ok).toBe(true)
    expect(created.body.operation).toBe('create_presentation')
    expect(created.body.revision).toBe(dataOf(created.body).revision)
    expect(typeof created.body.revision).toBe('string')
  })

  it('gir CONFLICT sin egen HTTP-status når agenten skriver mot en gammel lesing', async () => {
    const api = harness()
    const { id, revision } = await newPresentation(api)
    // Index 0 is the deck's front section; the slide with zones is the next one.
    const slideId = (dataOf((await call(api, 'get_presentation', { presentationId: id })).body).slides as {
      slideId: string
    }[])[1].slideId

    const first = await call(api, 'set_slide_title', {
      presentationId: id,
      slideId,
      expectedRevision: revision,
      spans: [{ text: 'Først' }],
    })
    expect(first.status).toBe(200)

    // The same reading, used twice. The second write is against a document that
    // has moved on, and an agent must be able to branch on that without reading
    // prose: 409, and read again.
    const stale = await call(api, 'set_slide_title', {
      presentationId: id,
      slideId,
      expectedRevision: revision,
      spans: [{ text: 'Etterpå' }],
    })
    expect(stale.status).toBe(409)
    expect(errorOf(stale.body).code).toBe('CONFLICT')
    expect(errorOf(stale.body).details).toMatchObject({ expectedRevision: revision })
  })

  it('skiller «du sendte tull» fra «Slaids sa nei»', async () => {
    const api = harness()
    const { id } = await newPresentation(api)
    // Index 0 is the deck's front section; the slide with zones is the next one.
    const slideId = (dataOf((await call(api, 'get_presentation', { presentationId: id })).body).slides as {
      slideId: string
    }[])[1].slideId
    const inspection = dataOf((await call(api, 'inspect_slide', { presentationId: id, slideId })).body)
    const zone = (inspection.zones as { nodeId: string; kind: string }[]).find(
      (entry) => entry.kind === 'leaf',
    )

    // 400: the request itself was wrong.
    const malformed = await call(api, 'set_zone_text', { presentationId: id, slideId })
    expect(malformed.status).toBe(400)
    expect(errorOf(malformed.body).code).toBe('INVALID_INPUT')

    // 422: understood, and the rules refused it. Retrying it unchanged will
    // fail again, and the details say by how much.
    const overflowing = await call(api, 'set_zone_text', {
      presentationId: id,
      slideId,
      nodeId: zone?.nodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Ord. '.repeat(4000) }] }],
    })
    expect(overflowing.status).toBe(422)
    expect(errorOf(overflowing.body).code).toBe('CONTENT_DOES_NOT_FIT')
    expect(errorOf(overflowing.body).details).toMatchObject({
      slideId,
      nodeId: zone?.nodeId,
      subject: 'zone-content',
    })
    expect(errorOf(overflowing.body).details?.overflow).toBeGreaterThan(0)
  })

  it('svarer 404 med navnene som finnes for en ukjent operasjon', async () => {
    const unknown = await call(harness(), 'set_zone_hologram', {})
    expect(unknown.status).toBe(404)
    expect(errorOf(unknown.body).code).toBe('UNKNOWN_OPERATION')
    expect(errorOf(unknown.body).details?.available).toContain('set_zone_text')
  })

  it('gir samme svar over REST som i prosess', async () => {
    // §44's own test: the same operation through both doors must be semantically
    // the same result. It is the same code — this is what pins that it stays so.
    const api = harness()
    const created = await call(api, 'create_presentation', { title: 'Samme svar' })
    const id = dataOf(created.body).presentationId as string

    const overRest = await call(api, 'get_presentation', { presentationId: id })
    const inProcess = await runOperation(api.context, 'get_presentation', { presentationId: id })

    expect(inProcess.ok).toBe(true)
    expect(dataOf(overRest.body)).toEqual(JSON.parse(JSON.stringify(inProcess.ok && inProcess.value)))
  })

  it('krever POST på en operasjon', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(url('/operations/list_presentations'), { method: 'GET', headers: authorized() }),
    )
    expect(response.status).toBe(405)
  })

  it('svarer ikke fra en cache og lar seg ikke indeksere', async () => {
    const response = await handleAgentRequest(
      harness().deps,
      new Request(url('/operations'), { method: 'GET', headers: authorized() }),
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

/* ------------------------------------------------------------------ *
 * Binary transport
 * ------------------------------------------------------------------ */

describe('binær opplasting', () => {
  async function uploadedAsset(
    api: Harness,
    request: Request,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await handleAgentRequest(api.deps, request)
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  it('tar imot en fil som multipart, uten base64 noe sted', async () => {
    const api = harness()
    const { id } = await newPresentation(api)

    const form = new FormData()
    form.set('presentationId', id)
    form.set('name', 'figur.png')
    form.set('file', new Blob([realImages.png() as unknown as BlobPart], { type: 'image/png' }), 'figur.png')

    const uploaded = await uploadedAsset(
      api,
      new Request(url('/operations/upload_asset'), {
        method: 'POST',
        headers: authorized(),
        body: form,
      }),
    )
    expect(uploaded.status).toBe(200)
    const assetId = dataOf(uploaded.body).assetId as string
    expect(assetId).toBeTruthy()
    // The size came out of the bitstream, not out of the request.
    expect(dataOf(uploaded.body).ref).toMatchObject({ mimeType: 'image/png', width: 3, height: 2 })

    // And it is a normal asset: `set_zone_asset` places it like any other.
    // Index 0 is the deck's front section; the slide with zones is the next one.
    const slideId = (dataOf((await call(api, 'get_presentation', { presentationId: id })).body).slides as {
      slideId: string
    }[])[1].slideId
    const inspection = dataOf((await call(api, 'inspect_slide', { presentationId: id, slideId })).body)
    const nodeId = (inspection.zones as { nodeId: string; kind: string }[]).find(
      (zone) => zone.kind === 'leaf',
    )?.nodeId
    const placed = await call(api, 'set_zone_asset', { presentationId: id, slideId, nodeId, assetId })
    expect(placed.status).toBe(200)
  })

  it('tar imot rå bytes med feltene i query-strengen', async () => {
    const api = harness()
    const { id } = await newPresentation(api)

    const uploaded = await uploadedAsset(
      api,
      new Request(
        `${url('/operations/upload_asset')}?presentationId=${id}&name=${encodeURIComponent('rå.png')}`,
        {
          method: 'POST',
          headers: { ...authorized(), 'Content-Type': 'image/png' },
          body: realImages.png() as unknown as BodyInit,
        },
      ),
    )
    expect(uploaded.status).toBe(200)
    expect(dataOf(uploaded.body).ref).toMatchObject({ name: 'rå.png', mimeType: 'image/png' })
  })

  it('lar en operasjon uten content-felt avvise en binærforespørsel selv', async () => {
    // The transport does not keep a list of which operations take a file. The
    // operation's own strict schema is what says no.
    const api = harness()
    const refused = await uploadedAsset(
      api,
      new Request(url('/operations/list_presentations'), {
        method: 'POST',
        headers: { ...authorized(), 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array([1, 2, 3]) as unknown as BodyInit,
      }),
    )
    expect(refused.status).toBe(400)
    expect(errorOf(refused.body).code).toBe('INVALID_INPUT')
  })

  it('avviser en forespørsel som er større enn grensen', async () => {
    const api = harness()
    api.deps.maxRequestBytes = 64
    const refused = await uploadedAsset(
      api,
      new Request(url('/operations/upload_asset'), {
        method: 'POST',
        headers: { ...authorized(), 'Content-Type': 'image/png' },
        body: new Uint8Array(256) as unknown as BodyInit,
      }),
    )
    expect(refused.status).toBe(413)
    expect(errorOf(refused.body).code).toBe('REQUEST_TOO_LARGE')
  })

  it('avviser mer enn én fil i samme forespørsel', async () => {
    const api = harness()
    const { id } = await newPresentation(api)
    const form = new FormData()
    form.set('presentationId', id)
    form.append('a', new Blob([realImages.png() as unknown as BlobPart]), 'en.png')
    form.append('b', new Blob([realImages.gif() as unknown as BlobPart]), 'to.gif')

    const refused = await uploadedAsset(
      api,
      new Request(url('/operations/upload_asset'), { method: 'POST', headers: authorized(), body: form }),
    )
    expect(refused.status).toBe(400)
    expect(errorOf(refused.body).code).toBe('MALFORMED_BODY')
  })

  it('avviser en JSON-kropp som ikke er JSON', async () => {
    const api = harness()
    const refused = await uploadedAsset(
      api,
      new Request(url('/operations/list_presentations'), {
        method: 'POST',
        headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: '{ikke json',
      }),
    )
    expect(refused.status).toBe(400)
    expect(errorOf(refused.body).code).toBe('MALFORMED_BODY')
  })

  it('lar en tom kropp bety «ingen argumenter»', async () => {
    const api = harness()
    const response = await handleAgentRequest(
      api.deps,
      new Request(url('/operations/list_presentations'), { method: 'POST', headers: authorized() }),
    )
    expect(response.status).toBe(200)
  })
})

/* ------------------------------------------------------------------ *
 * Audit
 * ------------------------------------------------------------------ */

describe('audit', () => {
  it('skriver én rad per kall, med token, operasjon og presentasjon', async () => {
    const api = harness()
    const { id } = await newPresentation(api)

    expect(api.audit.entries).toHaveLength(1)
    expect(api.audit.entries[0]).toMatchObject({
      ownerId: 'owner-1',
      tokenId: 'token-1',
      tokenName: 'Testagenten',
      operation: 'create_presentation',
      // Nothing told the API which presentation this was; the answer did.
      presentationId: id,
      success: true,
      errorCode: null,
      status: 200,
    })
    expect(api.audit.entries[0].at).toBe('2026-09-02T12:00:00.000Z')
  })

  it('skriver også raden for et avvist kall, med feilkoden', async () => {
    const readOnly = harness({ scopes: ['presentations:read'] })
    await call(readOnly, 'create_presentation', { title: 'Nei' })
    expect(readOnly.audit.entries[0]).toMatchObject({
      operation: 'create_presentation',
      success: false,
      errorCode: 'FORBIDDEN_SCOPE',
      status: 403,
    })
  })

  it('lagrer aldri innholdet, filen eller hele forespørselen', async () => {
    const api = harness()
    const { id } = await newPresentation(api)
    // Index 0 is the deck's front section; the slide with zones is the next one.
    const slideId = (dataOf((await call(api, 'get_presentation', { presentationId: id })).body).slides as {
      slideId: string
    }[])[1].slideId
    const inspection = dataOf((await call(api, 'inspect_slide', { presentationId: id, slideId })).body)
    const nodeId = (inspection.zones as { nodeId: string; kind: string }[]).find(
      (zone) => zone.kind === 'leaf',
    )?.nodeId

    const secret = 'Pasientjournal 1972 fortrolig'
    await call(api, 'set_zone_text', {
      presentationId: id,
      slideId,
      nodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: secret }] }],
    })

    const form = new FormData()
    form.set('presentationId', id)
    form.set('name', 'hemmelig.png')
    form.set('file', new Blob([realImages.png() as unknown as BlobPart], { type: 'image/png' }))
    await handleAgentRequest(
      api.deps,
      new Request(url('/operations/upload_asset'), { method: 'POST', headers: authorized(), body: form }),
    )

    const written = JSON.stringify(api.audit.entries)
    expect(written).not.toContain(secret)
    expect(written).not.toContain('Pasientjournal')
    expect(written).not.toContain('blocks')
    expect(written).not.toContain('content')
    // What it does contain is what §44 asks for, and only that.
    expect(Object.keys(api.audit.entries[0]).sort()).toEqual([
      'at',
      'durationMs',
      'errorCode',
      'operation',
      'ownerId',
      'presentationId',
      'status',
      'success',
      'tokenId',
      'tokenName',
    ])
  })

  it('skriver en rad når et tilbakekalt token brukes igjen', async () => {
    // The single most useful thing an audit can tell an owner. The caller is
    // still told only «UNAUTHENTICATED»; the reason exists in the log, which
    // only the owner can read.
    const api = harness()
    api.deps.authenticate = () =>
      Promise.resolve({
        ok: false,
        reason: 'revoked',
        identified: { ownerId: 'owner-1', tokenId: 'token-1', tokenName: 'Gammel agent' },
      })

    const response = await handleAgentRequest(
      api.deps,
      new Request(url('/operations/create_presentation'), {
        method: 'POST',
        headers: authorized(),
      }),
    )
    expect(response.status).toBe(401)
    const body = (await response.json()) as Record<string, unknown>
    expect(errorOf(body).code).toBe('UNAUTHENTICATED')
    expect(JSON.stringify(body)).not.toContain('REVOKED')

    expect(api.audit.entries[0]).toMatchObject({
      tokenName: 'Gammel agent',
      operation: 'create_presentation',
      errorCode: 'TOKEN_REVOKED',
      success: false,
      status: 401,
    })
  })

  it('skriver ingen rad for et token ingen har sett før', async () => {
    // Nobody to attribute it to, and an unauthenticated write is a way to fill
    // somebody else's table.
    const api = harness()
    await handleAgentRequest(
      api.deps,
      new Request(url('/operations/list_presentations'), {
        method: 'POST',
        headers: authorized(OTHER_TOKEN),
      }),
    )
    expect(api.audit.entries).toEqual([])
  })

  it('kutter et absurd operasjonsnavn i stedet for å miste raden', async () => {
    const api = harness()
    const response = await handleAgentRequest(
      api.deps,
      new Request(url(`/operations/${'x'.repeat(5000)}`), {
        method: 'POST',
        headers: authorized(),
      }),
    )
    expect(response.status).toBe(404)
    expect(api.audit.entries).toHaveLength(1)
    expect(api.audit.entries[0].operation.length).toBe(100)
  })

  it('skriver en rad for hvert autentisert kall, også katalogoppslag', async () => {
    // "One row per call" means all of them. A stolen token's first move is to
    // ask what it can do, and that is the earliest thing an owner could notice.
    const api = harness()
    for (const path of ['', '/operations', '/finnes-ikke']) {
      await handleAgentRequest(
        api.deps,
        new Request(url(path), { method: 'GET', headers: authorized() }),
      )
    }
    expect(api.audit.entries.map((entry) => entry.operation)).toEqual([
      'index',
      'catalogue',
      'unknown_route',
    ])
    expect(api.audit.entries[1]).toMatchObject({ success: true, status: 200 })
    expect(api.audit.entries[2]).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('skriver en rad for feil metode, med operasjonen den gjaldt', async () => {
    const api = harness()
    const response = await handleAgentRequest(
      api.deps,
      new Request(url('/operations/list_presentations'), { method: 'GET', headers: authorized() }),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toContain('POST')
    expect(api.audit.entries[0]).toMatchObject({
      operation: 'list_presentations',
      errorCode: 'METHOD_NOT_ALLOWED',
      status: 405,
    })
  })

  it('lagrer aldri tokenet selv', async () => {
    const api = harness()
    await call(api, 'list_presentations', {})
    expect(JSON.stringify(api.audit.entries)).not.toContain(TOKEN)
  })

  it('lar ikke en audit som feiler velte en mutasjon som allerede landet', async () => {
    const api = harness()
    api.deps.audit = {
      record: () => Promise.reject(new Error('auditbasen er nede')),
    }
    const created = await call(api, 'create_presentation', { title: 'Landet likevel' })
    expect(created.status).toBe(200)
    expect(await api.context.repository.listPresentations()).toHaveLength(1)
  })
})
