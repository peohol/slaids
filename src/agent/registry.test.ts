/**
 * The dispatch contract.
 *
 * Everything here is about what a transport can rely on: names it can route,
 * schemas it can publish, and one envelope shape it can serialise — including
 * for failures, because an agent can only act on what it can read.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createPresentation } from '../domain/presentation'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import { SlaidsDatabase } from '../persistence/db'
import { RepositoryError } from '../persistence/repository'
import type { PresentationSummary } from '../domain/types'
import { AGENT_TOOL_PREFIX, describeOperations, findOperation, operations, runOperation } from './registry'
import type { AgentContext } from './types'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshDatabase(): SlaidsDatabase {
  counter += 1
  const database = new SlaidsDatabase(`slaids-registry-${counter}`)
  databases.push(database)
  return database
}

function freshContext(): AgentContext {
  return { repository: new DexieSlaidsRepository(freshDatabase()) }
}

/** A store that is there but not answering, which is not the same as empty. */
class UnreachableRepository extends DexieSlaidsRepository {
  constructor(private readonly failure: Error) {
    super(freshDatabase())
  }

  override listPresentations(): Promise<PresentationSummary[]> {
    return Promise.reject(this.failure)
  }
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

describe('operasjonskatalogen', () => {
  it('har unike navn i snake_case', () => {
    const names = operations.map((operation) => operation.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('inneholder de to dørene bilder kommer inn gjennom, og ingen bildegenerering', () => {
    const names = operations.map((operation) => operation.name)
    expect(names).toContain('upload_asset')
    expect(names).toContain('create_svg_asset')
    expect(names).toContain('place_asset')
    expect(names.some((name) => /generate.*image|image.*generate/.test(name))).toBe(false)
  })

  it('beskriver hver operasjon med et JSON Schema et MCP-lag kan publisere', () => {
    for (const described of describeOperations()) {
      expect(described.toolName).toBe(`${AGENT_TOOL_PREFIX}${described.name}`)
      expect(described.summary.length).toBeGreaterThan(0)
      expect(described.inputSchema).toMatchObject({ type: 'object' })
      // A description is what a tool listing shows; it must survive generation.
      expect(JSON.stringify(described.inputSchema).length).toBeGreaterThan(2)
    }

    const upload = describeOperations().find((entry) => entry.name === 'upload_asset')
    expect(upload?.mutates).toBe(true)
    expect(Object.keys(upload?.inputSchema.properties as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['presentationId', 'name', 'content']),
    )
  })

  it('finner en operasjon på navn, og ingenting på et navn som ikke finnes', () => {
    expect(findOperation('create_svg_asset')?.mutates).toBe(true)
    expect(findOperation('slaids_create_svg_asset')).toBeNull()
  })
})

describe('runOperation', () => {
  it('svarer med en typet feil på et ukjent operasjonsnavn', async () => {
    const result = await runOperation(freshContext(), 'generate_image_asset', {})
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_OPERATION' } })
  })

  it('validerer inndata før noe kjøres, og sier hvor det gikk galt', async () => {
    const result = await runOperation(freshContext(), 'create_svg_asset', {
      presentationId: '',
      name: '   ',
    })
    if (result.ok) throw new Error('forventet avvisning')
    expect(result.error.code).toBe('INVALID_INPUT')
    const issues = result.error.details?.issues as { path: string }[]
    expect(issues.map((issue) => issue.path).sort()).toEqual(['name', 'presentationId', 'svgMarkup'])
  })

  it('gir maskinlesbare resultater som overlever en JSON-runde', async () => {
    const context = freshContext()
    const presentation = createPresentation({ title: 'Serialisering' })
    await context.repository.savePresentation(presentation)

    const result = await runOperation(context, 'create_svg_asset', {
      presentationId: presentation.id,
      name: 'figur',
      svgMarkup: '<svg viewBox="0 0 10 5"><rect width="10" height="5"/></svg>',
    })
    expect(result.ok).toBe(true)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('fyller inn de samme standardverdiene som skjemaet lover', async () => {
    const context = freshContext()
    const presentation = createPresentation({ title: 'Standardverdier' })
    await context.repository.savePresentation(presentation)
    const created = await runOperation(context, 'create_svg_asset', {
      presentationId: presentation.id,
      name: 'figur',
      svgMarkup: '<svg viewBox="0 0 10 5"><rect width="10" height="5"/></svg>',
    })
    if (!created.ok) throw new Error('kunne ikke lage assetet')
    const { assetId } = created.value as { assetId: string }

    // No `fit`, no `replace`: the schema's defaults are the contract.
    const placed = await runOperation(context, 'place_asset', {
      presentationId: presentation.id,
      slideId: presentation.slides[0].id,
      nodeId: presentation.slides[0].root.id,
      assetId,
    })
    expect(placed).toMatchObject({ ok: true, value: { movedToSandbox: 0 } })

    const reloaded = await context.repository.loadPresentation(presentation.id)
    const root = reloaded.slides[0].root
    expect(root.kind === 'leaf' && root.content).toMatchObject({
      payload: { type: 'asset', fit: 'contain' },
    })
  })

  it('gjør en lagringsfeil om til en typet feil i stedet for et kast', async () => {
    const repository = new UnreachableRepository(new RepositoryError('Basen svarer ikke.'))

    const result = await runOperation({ repository }, 'list_presentations', {})
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_FAILED', message: 'Basen svarer ikke.' },
    })
  })

  it('gjør en uventet feil om til INTERNAL_ERROR', async () => {
    const repository = new UnreachableRepository(new TypeError('noe uventet'))

    const result = await runOperation({ repository }, 'list_presentations', {})
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } })
  })
})
