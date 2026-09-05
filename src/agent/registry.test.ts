/**
 * The dispatch contract.
 *
 * Everything here is about what a transport can rely on: names it can route,
 * schemas it can publish, and one envelope shape it can serialise — including
 * for failures, because an agent can only act on what it can read.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createPresentation } from '../domain/presentation'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import { SlaidsDatabase } from '../persistence/db'
import { FOLDER_NAME_MAX_LENGTH } from '../persistence/library'
import { RepositoryError } from '../persistence/repository'
import type { PresentationSummary } from '../domain/types'
import { AGENT_TOOL_PREFIX, describeOperations, findOperation, operations, runOperation } from './registry'
import { AGENT_SCOPES, type AgentContext } from './types'

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
    expect(names).toContain('set_zone_asset')
    expect(names.some((name) => /generate.*image|image.*generate/.test(name))).toBe(false)
  })

  it('har hele fase 1-flaten fra §44', () => {
    const names = operations.map((operation) => operation.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'list_presentations',
        'get_presentation',
        'create_presentation',
        'inspect_slide',
        'add_slide',
        'duplicate_slide',
        'move_slide',
        'delete_slide',
        'set_slide_title',
        'split_zone',
        'adjust_split',
        'delete_zone',
        'clear_zone',
        'set_zone_text',
        'set_zone_card',
        'set_vertical_alignment',
        'add_reference',
        'update_reference',
        'delete_reference',
        'validate_slide',
        'validate_presentation',
      ]),
    )
  })

  it('har fase 5: rendret preview, som en lesing og ingenting mer', () => {
    // §44's phase 5. It is a *read*: nothing about looking at a slide changes
    // it, so a read-only token has to be enough — and a picture must never
    // require the authority to rewrite the deck it is a picture of.
    const preview = findOperation('render_slide_preview')
    expect(preview).toBeTruthy()
    expect(preview?.mutates).toBe(false)
    expect(preview?.scopes).toEqual(['presentations:read'])
  })

  it('har fase 6: hele sandkasseflaten, med lesing og skriving delt riktig', () => {
    // A structural change can park content in the sandbox with nothing more
    // than the default `disposition`, so the read has to need no more than
    // `presentations:read`, and every mutation has to need `presentations:write`
    // — the same split as the rest of the surface, never a scope of its own.
    const read = findOperation('list_sandbox_items')
    expect(read?.mutates).toBe(false)
    expect(read?.scopes).toEqual(['presentations:read'])

    for (const name of ['place_sandbox_item', 'duplicate_sandbox_item', 'delete_sandbox_item']) {
      const operation = findOperation(name)
      expect(operation, name).toBeTruthy()
      expect(operation?.mutates, name).toBe(true)
      expect(operation?.scopes, name).toEqual(['presentations:write'])
    }
  })

  it('har fase 6: subfeltlayouten, som én operasjon og ikke tre', () => {
    // Retning, forholdstall og antall er ett spørsmål mot den samme
    // rektangelet, og tre operasjoner ville gatet hver mellomtilstand for seg.
    // Én operasjon er derfor kontrakten, ikke en forenkling av den.
    const adjust = findOperation('adjust_subfields')
    expect(adjust).toBeTruthy()
    expect(adjust?.mutates).toBe(true)
    expect(adjust?.scopes).toEqual(['presentations:write'])

    const schema = describeOperations().find((entry) => entry.name === 'adjust_subfields')
    const properties = (schema?.inputSchema as { properties: Record<string, unknown> }).properties
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['axis', 'weights', 'subfieldCount']),
    )
    // The published enum is the domain's own axis, not a second vocabulary.
    expect((properties.axis as { enum: string[] }).enum).toEqual(['x', 'y'])
  })

  it('har fase 6: flytting av innhold, med kilde og mål navngitt hver for seg', () => {
    // Både kilden og målet trenger id-er her, så et enslig `slideId` eller
    // `nodeId` ville vært tvetydig. Kontrakten er fire navngitte felter, og
    // `toSlideId` er valgfri fordi «samme slide» er det vanlige tilfellet.
    const move = findOperation('move_zone_content')
    expect(move?.mutates).toBe(true)
    expect(move?.scopes).toEqual(['presentations:write'])

    const schema = describeOperations().find((entry) => entry.name === 'move_zone_content')
    const published = schema?.inputSchema as {
      properties: Record<string, unknown>
      required?: string[]
    }
    expect(Object.keys(published.properties)).toEqual(
      expect.arrayContaining(['fromSlideId', 'fromNodeId', 'toSlideId', 'toNodeId']),
    )
    expect(published.properties).not.toHaveProperty('slideId')
    expect(published.properties).not.toHaveProperty('nodeId')
    expect(published.required).toEqual(
      expect.arrayContaining(['fromSlideId', 'fromNodeId', 'toNodeId']),
    )
    expect(published.required).not.toContain('toSlideId')
  })

  it('har fase 6: kopiering av innhold, som en egen operasjon og ikke et flagg', () => {
    // Flytting og kopiering adresseres likt og lover forskjellige ting: en
    // flytting bevarer id-ene, en kopi lager nye. En «flytt» som noen ganger
    // gjorde det siste ville vært to operasjoner med ett navn, så de er to –
    // slik `move_slide` og `duplicate_slide` er det. Kontrakten pinnes felt for
    // felt her, så den ikke kan gli utilsiktet.
    const copy = findOperation('copy_zone_content')
    expect(copy?.mutates).toBe(true)
    expect(copy?.scopes).toEqual(['presentations:write'])

    const schemaFor = (
      name: string,
    ): { properties: Record<string, unknown>; required?: string[]; additionalProperties?: unknown } =>
      describeOperations().find((entry) => entry.name === name)?.inputSchema as {
        properties: Record<string, unknown>
        required?: string[]
        additionalProperties?: unknown
      }

    const published = schemaFor('copy_zone_content')
    expect(Object.keys(published.properties).sort()).toEqual([
      'expectedRevision',
      'fromNodeId',
      'fromSlideId',
      'presentationId',
      'toNodeId',
      'toSlideId',
    ])
    expect([...(published.required ?? [])].sort()).toEqual([
      'fromNodeId',
      'fromSlideId',
      'presentationId',
      'toNodeId',
    ])
    // Et felt som ikke finnes skal avvises, ikke ignoreres stille.
    expect(published.additionalProperties).toBe(false)

    // De to har den samme adresseringen — fire navngitte id-er, `toSlideId`
    // valgfri — og ingen av dem har et `copy`-flagg noe sted.
    const move = schemaFor('move_zone_content')
    expect(Object.keys(move.properties).sort()).toEqual(Object.keys(published.properties).sort())
    expect(move.required).toEqual(published.required)
    for (const schema of [published, move]) {
      expect(JSON.stringify(schema)).not.toContain('"copy"')
      expect(schema.properties).not.toHaveProperty('slideId')
      expect(schema.properties).not.toHaveProperty('nodeId')
    }
    // Og de sier hver sin ting om id-ene, som er hele forskjellen mellom dem.
    expect(copy?.summary).not.toBe(findOperation('move_zone_content')?.summary)
  })

  it('har fase 6: opprydding, med scopene ryddingen faktisk trenger', () => {
    // `delete_asset` is the mirror of `upload_asset` and carries the same
    // scope: the authority that put a file in is the authority that takes it
    // out, and it is enough *because* the operation is confined to the file
    // list — it refuses while anything shows the file, so a token that may only
    // store files can never use it to edit a deck. Pruning references is the
    // opposite: nothing about it touches the file store, and it is the same act
    // `delete_reference` performs on a set the deck picks out itself.
    const deleteAsset = findOperation('delete_asset')
    expect(deleteAsset?.mutates).toBe(true)
    expect(deleteAsset?.scopes).toEqual(['assets:write'])

    const prune = findOperation('delete_unused_references')
    expect(prune?.mutates).toBe(true)
    expect(prune?.scopes).toEqual(['presentations:write'])

    // Neither of them takes anything but the deck, the file and the reading the
    // caller wrote against. A `force` flag on either would be a way to leave a
    // dangling reference or to drop a citation nobody asked to drop.
    const schemaFor = (name: string): { properties: Record<string, unknown>; required?: string[] } =>
      describeOperations().find((entry) => entry.name === name)?.inputSchema as {
        properties: Record<string, unknown>
        required?: string[]
      }
    expect(Object.keys(schemaFor('delete_asset').properties).sort()).toEqual([
      'assetId',
      'expectedRevision',
      'presentationId',
    ])
    expect(Object.keys(schemaFor('delete_unused_references').properties).sort()).toEqual([
      'expectedRevision',
      'presentationId',
    ])
    for (const name of ['delete_asset', 'delete_unused_references']) {
      expect(JSON.stringify(schemaFor(name))).not.toContain('force')
    }
  })

  it('har fase 7: bibliotekets livsløp, med scope-grensen tegnet per operasjon', () => {
    // The six calls that act on a presentation from the outside. Each of them
    // asks for exactly the authority the act consumes, and the differences are
    // the contract rather than a detail:
    //  - listing folders is a reading of the library, which a read token has;
    //  - making a folder is a write and only a write: no bytes, nothing
    //    published, and a receipt made entirely of what the caller sent plus
    //    what Slaids minted for it, so there is nothing in it to have been read;
    //  - deleting one is a write on every presentation inside it — clearing the
    //    `folderId` that pointed at it — and nothing else, so the same one scope
    //    and no file scope;
    //  - a move writes one field and answers with the two ids the caller sent;
    //  - a copy reads the whole document and answers with it, *and* stores a new
    //    file for every file the source has, so it needs all three: a write-only
    //    token must not learn a deck's title by copying it, and a token denied
    //    `upload_asset` must not fill the store by copying either;
    //  - a deletion destroys the document *and* every file stored under it,
    //    which are precisely the two things the two write scopes protect.
    const expected: Record<string, { mutates: boolean; scopes: string[] }> = {
      list_folders: { mutates: false, scopes: ['presentations:read'] },
      create_folder: { mutates: true, scopes: ['presentations:write'] },
      delete_folder: { mutates: true, scopes: ['presentations:write'] },
      move_presentation: { mutates: true, scopes: ['presentations:write'] },
      duplicate_presentation: {
        mutates: true,
        scopes: ['presentations:read', 'presentations:write', 'assets:write'],
      },
      delete_presentation: { mutates: true, scopes: ['presentations:write', 'assets:write'] },
    }
    for (const [name, contract] of Object.entries(expected)) {
      const operation = findOperation(name)
      expect(operation, name).toBeTruthy()
      expect({ name, mutates: operation?.mutates, scopes: [...(operation?.scopes ?? [])] }).toEqual({
        name,
        ...contract,
      })
    }

    const schemaFor = (
      name: string,
    ): { properties: Record<string, unknown>; required?: string[] } =>
      describeOperations().find((entry) => entry.name === name)?.inputSchema as {
        properties: Record<string, unknown>
        required?: string[]
      }

    // A move must say where. Omitting the field would have to mean "leave it
    // where it is", which is not a move, so `null` is how you say "the root".
    const move = schemaFor('move_presentation')
    expect(Object.keys(move.properties).sort()).toEqual([
      'expectedRevision',
      'folderId',
      'presentationId',
    ])
    expect([...(move.required ?? [])].sort()).toEqual(['folderId', 'presentationId'])
    expect(JSON.stringify(move.properties.folderId)).toContain('null')

    // Nothing but the deck and the reading it is deleted against. A `force`
    // flag here would be a way past the one guard a deletion has.
    const remove = schemaFor('delete_presentation')
    expect(Object.keys(remove.properties).sort()).toEqual(['expectedRevision', 'presentationId'])
    expect(JSON.stringify(remove)).not.toContain('force')

    // The copy may be named on the way in, so building a variant is one call
    // rather than a duplication followed by a rename.
    expect(Object.keys(schemaFor('duplicate_presentation').properties).sort()).toEqual([
      'expectedRevision',
      'presentationId',
      'title',
    ])
    // Listing folders takes nothing: it is the whole library or nothing.
    expect(Object.keys(schemaFor('list_folders').properties ?? {})).toEqual([])

    // The two folder mutations take one field each, and it is the *whole*
    // contract: no id to name on the way in (Slaids mints it), no revision to
    // write against (a folder is not a document and has no reading), and no
    // `force` on the deletion — what happens to the presentations inside is not
    // a choice the caller gets to make, it is the promise.
    const made = schemaFor('create_folder') as typeof move & { additionalProperties?: unknown }
    expect(Object.keys(made.properties)).toEqual(['name'])
    expect(made.required).toEqual(['name'])
    expect(made.additionalProperties).toBe(false)
    // Published with every bound the library actually enforces, so a caller can
    // tell before it sends — and the length is the library's own number rather
    // than one this schema invented, which is what stops the two doors from
    // accepting different names.
    expect(made.properties.name).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: FOLDER_NAME_MAX_LENGTH,
    })

    const removedFolder = schemaFor('delete_folder') as typeof move & {
      additionalProperties?: unknown
    }
    expect(Object.keys(removedFolder.properties)).toEqual(['folderId'])
    expect(removedFolder.required).toEqual(['folderId'])
    expect(removedFolder.additionalProperties).toBe(false)
    expect(JSON.stringify(removedFolder)).not.toContain('force')

    // And neither of them may touch the file store, in either direction.
    for (const name of ['create_folder', 'delete_folder']) {
      expect({ name, scopes: findOperation(name)?.scopes }).toEqual({
        name,
        scopes: ['presentations:write'],
      })
    }

    // The one rule that ties the file scope to the file store: every operation
    // that can put bytes into it or take them out asks for `assets:write`.
    // Generated from the registry rather than listed, so an operation that
    // starts writing files without saying so fails here.
    for (const name of [
      'upload_asset',
      'create_svg_asset',
      'delete_asset',
      'duplicate_presentation',
      'delete_presentation',
    ]) {
      expect({ name, scopes: findOperation(name)?.scopes }).toMatchObject({
        name,
        scopes: expect.arrayContaining(['assets:write']),
      })
    }
  })

  it('gir hver operasjon minst ett scope, og aldri et skrivescope til en lesing', () => {
    for (const operation of operations) {
      expect(operation.scopes.length).toBeGreaterThan(0)
      for (const scope of operation.scopes) expect(AGENT_SCOPES).toContain(scope)
      const writes = operation.scopes.some((scope) => scope.endsWith(':write'))
      // Both directions. A mutation that only asks for a read scope would be a
      // write any token could make; a read that asks for a write scope would
      // make a read-only token useless for the thing it exists for.
      expect(writes).toBe(operation.mutates)
    }
  })

  it('lar ikke vanlig redigering gi rett til å publisere', () => {
    // §44's own words: "Vanlig presentasjonsredigering skal ikke automatisk gi
    // rett til å publisere/dele presentasjoner." That is this assertion.
    const publish = findOperation('set_sharing')
    expect(publish?.scopes).toEqual(['sharing:write'])
    for (const operation of operations) {
      if (operation.name === 'set_sharing') continue
      expect(operation.scopes).not.toContain('sharing:write')
    }
  })

  it('publiserer scopene sammen med skjemaet, fra samme felt', () => {
    for (const described of describeOperations()) {
      expect(described.requiredScopes).toEqual([...(findOperation(described.name)?.scopes ?? [])])
    }
  })

  it('lar enhver mutasjon oppgi revisjonen den skriver mot', () => {
    // Uniform on purpose: an agent must not have to know which writes can be
    // guarded against a stale reading and which cannot.
    //
    // Derived from the schema rather than from a list of exceptions, because the
    // rule is not "these operations are special" but "a revision is a reading of
    // one presentation". An operation that names a `presentationId` writes a
    // document the caller could have read, so it must take the guard; one that
    // does not name a presentation — `create_presentation`, which is making the
    // first one, and the two folder operations, which act on the library around
    // them — has no reading to be stale, and offering a field that could not be
    // checked against anything would be worse than not having it.
    for (const operation of operations.filter((entry) => entry.mutates)) {
      const properties =
        (
          z.toJSONSchema(operation.transportInput ?? operation.input, { io: 'input' }) as {
            properties?: Record<string, unknown>
          }
        ).properties ?? {}
      const guarded = 'presentationId' in properties
      expect({ name: operation.name, guarded: 'expectedRevision' in properties }).toEqual({
        name: operation.name,
        guarded,
      })
    }
  })

  it('avviser felter som ikke finnes i stedet for å ignorere dem stille', async () => {
    // A misspelled `expectedRevision` that is silently dropped is a
    // concurrency check that silently does not happen.
    const result = await runOperation(freshContext(), 'get_presentation', {
      presentationId: 'p1',
      expectedRevison: 'abc',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
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

  it('publiserer bare former som faktisk kan sendes over en ledning', () => {
    // `upload_asset` accepts a `Blob` and a `Uint8Array` in-process. Neither can
    // be put in a JSON request, so neither may appear in the published
    // contract — and it must not appear as an unconstrained `{}` either, which
    // is what an "unrepresentable" branch degrades into.
    const upload = describeOperations().find((entry) => entry.name === 'upload_asset')
    const content = (upload?.inputSchema.properties as Record<string, { anyOf?: unknown[] }>).content
    const branches = content.anyOf ?? []

    const typed = branches as { properties: { encoding: { const?: string }; data: unknown } }[]
    expect(typed.map((branch) => branch.properties.encoding.const)).toEqual(['base64', 'text'])
    for (const branch of typed) {
      expect(Object.keys(branch.properties)).toEqual(['encoding', 'data'])
      expect(branch.properties.data).toMatchObject({ type: 'string' })
    }

    const published = JSON.stringify(upload?.inputSchema)
    expect(published).not.toContain('"const":"blob"')
    expect(published).not.toContain('"const":"bytes"')
    // An empty branch would accept anything while promising nothing.
    expect(published).not.toContain('{}')
  })

  it('lar ingen operasjon publisere et skjema som ikke kan uttrykkes i JSON Schema', () => {
    // `describeOperations` generates with `unrepresentable: 'throw'`, so this
    // fails loudly the day someone puts a runtime-only type in a published
    // schema rather than shipping a contract that lies.
    expect(() => describeOperations()).not.toThrow()
    for (const described of describeOperations()) {
      expect(JSON.stringify(described.inputSchema)).not.toContain('"not":{}')
    }
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
    const placed = await runOperation(context, 'set_zone_asset', {
      presentationId: presentation.id,
      slideId: presentation.slides[0].id,
      nodeId: presentation.slides[0].root.id,
      assetId,
    })
    expect(placed).toMatchObject({ ok: true, value: { movedToSandbox: 0 } })

    const reloaded = await context.repository.loadPresentation(presentation.id)
    const root = reloaded.slides[0].root
    expect(root.kind === 'leaf' && root.content).toMatchObject({
      kind: 'image',
      image: { assetId, focus: { x: 0.5, y: 0.5 } },
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
