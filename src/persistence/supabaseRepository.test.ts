import { describe, expect, it } from 'vitest'
import { createPresentation } from '../domain/presentation'
import { CURRENT_SCHEMA_VERSION } from '../domain/schema'
import { DEFAULT_FONT_SCALE, DEFAULT_SPACING } from '../domain/metrics'
import { newAssetId } from '../domain/ids'
import type { AssetRef, Presentation } from '../domain/types'
import { RepositoryConflictError, RepositoryError } from './repository'
import {
  ASSETS_BUCKET,
  ASSETS_TABLE,
  PRESENTATIONS_TABLE,
  SupabaseSlaidsRepository,
} from './supabaseRepository'
import {
  TEST_OWNER_ID,
  createFakeSupabase,
  type FakeSupabaseOptions,
  type QueryRecord,
} from './supabaseTestClient'

function repositoryFor(options: FakeSupabaseOptions) {
  const fake = createFakeSupabase(options)
  return { repository: new SupabaseSlaidsRepository(() => fake.client), fake }
}

function sampleAsset(): AssetRef {
  return {
    id: newAssetId(),
    name: 'bilde.png',
    mimeType: 'image/png',
    byteSize: 12,
    width: 100,
    height: 50,
    isVector: false,
  }
}

function filterValue(record: QueryRecord, column: string): unknown {
  return record.filters.find((filter) => filter.column === column)?.value
}

describe('SupabaseSlaidsRepository – lesing', () => {
  it('lager sammendrag av radene uten å laste ned dokumentene', async () => {
    const { repository, fake } = repositoryFor({
      resolve: () => ({
        data: [
          {
            id: 'p1',
            title: 'Første',
            folder_id: 'f1',
            slide_count: 4,
            version: 3,
            created_at: '2026-08-01 09:00:00+00',
            updated_at: '2026-08-30 11:30:00+00',
          },
          {
            id: 'p2',
            title: 'Andre',
            folder_id: null,
            slide_count: null,
            version: null,
            created_at: null,
            updated_at: null,
          },
        ],
      }),
    })

    const summaries = await repository.listPresentations()

    expect(summaries).toEqual([
      {
        id: 'p1',
        title: 'Første',
        folderId: 'f1',
        slideCount: 4,
        createdAt: '2026-08-01T09:00:00.000Z',
        updatedAt: '2026-08-30T11:30:00.000Z',
      },
      {
        id: 'p2',
        title: 'Andre',
        folderId: null,
        slideCount: 0,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ])
    // The whole point of the metadata columns: no `document` in the projection.
    expect(fake.queries[0]?.columns).not.toContain('document')
  })

  it('kjører remote dokumenter gjennom migrering og validering', async () => {
    const current = createPresentation({ title: 'Fra Supabase' })
    // A row written before the theme carried spacing and font scale.
    const stored = {
      ...current,
      schemaVersion: 4,
      theme: {
        backgroundColor: current.theme.backgroundColor,
        headingFontFamily: current.theme.headingFontFamily,
        bodyFontFamily: current.theme.bodyFontFamily,
      },
    }

    const { repository } = repositoryFor({
      resolve: () => ({ data: { document: stored, version: 9 } }),
    })

    const loaded = await repository.loadPresentation(current.id)

    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(loaded.id).toBe(current.id)
    expect(loaded.title).toBe('Fra Supabase')
    expect(loaded.slides).toHaveLength(1)
    expect(loaded.theme.spacing).toBe(DEFAULT_SPACING)
    expect(loaded.theme.fontScale).toBe(DEFAULT_FONT_SCALE)
  })

  it('avviser et ugyldig remote dokument i stedet for å slippe det inn i domenet', async () => {
    const { repository } = repositoryFor({
      resolve: () => ({ data: { document: { schemaVersion: 7, slides: 'ikke en liste' }, version: 1 } }),
    })

    await expect(repository.loadPresentation('p1')).rejects.toBeInstanceOf(RepositoryError)
  })

  it('sier tydelig fra når raden ikke finnes', async () => {
    const { repository } = repositoryFor({ resolve: () => ({ data: null }) })
    await expect(repository.loadPresentation('borte')).rejects.toThrow(/Fant ikke/)
  })

  it('gjør en Postgrest-feil om til en RepositoryError', async () => {
    const { repository } = repositoryFor({
      resolve: () => ({ error: { message: 'network error', code: '' } }),
    })
    await expect(repository.listPresentations()).rejects.toThrow(/network error/)
  })
})

describe('SupabaseSlaidsRepository – skriving', () => {
  it('setter owner_id fra sesjonen og legger hele dokumentet i document', async () => {
    const presentation = createPresentation({ title: 'Ny' })
    const { repository, fake } = repositoryFor({
      resolve: () => ({ data: { version: 1 } }),
    })

    await repository.savePresentation(presentation)

    const insert = fake.queries.at(-1)
    expect(insert?.op).toBe('insert')
    const values = insert?.values as Record<string, unknown>
    expect(values.owner_id).toBe(TEST_OWNER_ID)
    expect(values.id).toBe(presentation.id)
    expect(values.slide_count).toBe(1)
    expect((values.document as Presentation).slides).toHaveLength(1)
  })

  it('nekter å skrive uten innlogget bruker', async () => {
    const { repository } = repositoryFor({ session: null })
    await expect(repository.savePresentation(createPresentation({ title: 'Ny' }))).rejects.toThrow(
      /ikke logget inn/i,
    )
  })

  it('oppdaterer mot versjonen den leste', async () => {
    const presentation = createPresentation({ title: 'Lest' })
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 7 } }
          : { data: [{ version: 8 }] },
    })

    await repository.loadPresentation(presentation.id)
    await repository.savePresentation({ ...presentation, title: 'Endret' })

    const update = fake.queries.at(-1)
    expect(update?.op).toBe('update')
    expect(filterValue(update as QueryRecord, 'version')).toBe(7)

    // The next save must use the version the update returned, not the old one.
    await repository.savePresentation({ ...presentation, title: 'Endret igjen' })
    expect(filterValue(fake.queries.at(-1) as QueryRecord, 'version')).toBe(8)
  })

  it('gir en tydelig konfliktfeil i stedet for å overskrive en nyere kopi', async () => {
    const presentation = createPresentation({ title: 'Lest' })
    const { repository } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 2 } }
          : { data: [] },
    })

    await repository.loadPresentation(presentation.id)
    await expect(repository.savePresentation(presentation)).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )
  })

  it('melder konflikt når en ny presentasjon allerede finnes', async () => {
    const { repository } = repositoryFor({
      resolve: () => ({ error: { message: 'duplicate key value', code: '23505' } }),
    })
    await expect(repository.savePresentation(createPresentation({ title: 'Ny' }))).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )
  })

  it('sletter raden før filene den peker på', async () => {
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select' ? { data: [{ object_path: `${TEST_OWNER_ID}/p1/a1` }] } : { data: null },
    })

    await repository.deletePresentation('p1')

    // The other order would, if the row delete failed, leave a presentation
    // that still opens with its pictures permanently gone.
    const del = fake.queries.find((query) => query.op === 'delete')
    expect(del?.table).toBe(PRESENTATIONS_TABLE)
    expect(fake.storageCalls).toEqual([
      { op: 'remove', bucket: ASSETS_BUCKET, paths: [`${TEST_OWNER_ID}/p1/a1`] },
    ])
  })

  it('lar ikke en feilet filopprydding velte en sletting som gikk igjennom', async () => {
    let storageDown = true
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select' ? { data: [{ object_path: `${TEST_OWNER_ID}/p1/a1` }] } : { data: null },
      remove: () => (storageDown ? { error: { message: 'storage nede' } } : { data: [] }),
      list: () => ({ data: [] }),
    })

    // The user asked for a delete and got one; the leftover file is nobody's
    // problem but the sweep's.
    await expect(repository.deletePresentation('p1')).resolves.toBeUndefined()
    expect(fake.queries.some((query) => query.op === 'delete')).toBe(true)

    storageDown = false
    expect(await repository.deleteOrphanAssets()).toBe(1)
    expect(fake.storageCalls.filter((call) => call.op === 'remove')).toHaveLength(2)
  })
})

describe('SupabaseSlaidsRepository – maler', () => {
  const template = {
    id: 't_1',
    name: 'Todelt',
    hasTitle: true,
    root: { id: 'n1', kind: 'leaf' as const, content: null },
    createdAt: '2026-08-01T09:00:00.000Z',
  }

  it('oppdaterer en mal som er vår, uten å sette inn på nytt', async () => {
    const { repository, fake } = repositoryFor({
      resolve: (record) => (record.op === 'update' ? { data: [{ id: 't_1' }] } : { data: null }),
    })

    await repository.saveTemplate(template)

    // One request, and no insert to fall back on.
    expect(fake.queries.map((query) => query.op)).toEqual(['update'])
  })

  it('setter inn når ingen egen rad matchet', async () => {
    const { repository, fake } = repositoryFor({
      resolve: (record) => (record.op === 'update' ? { data: [] } : { data: null }),
    })

    await repository.saveTemplate(template)

    expect(fake.queries.map((query) => query.op)).toEqual(['update', 'insert'])
    const values = fake.queries.at(-1)?.values as Record<string, unknown>
    expect(values.owner_id).toBe(TEST_OWNER_ID)
  })

  it('melder konflikt når id-en tilhører en rad vi ikke ser', async () => {
    // RLS hides the other account's row, so the update matches nothing and the
    // insert is the first thing that can tell us the id is taken.
    const { repository } = repositoryFor({
      resolve: (record) =>
        record.op === 'update'
          ? { data: [] }
          : { error: { message: 'duplicate key value', code: '23505' } },
    })

    await expect(repository.saveTemplate(template)).rejects.toBeInstanceOf(RepositoryConflictError)
  })

  it('gjør ikke en nettverksfeil om til en konflikt', async () => {
    const { repository } = repositoryFor({
      resolve: (record) =>
        record.op === 'update' ? { data: [] } : { error: { message: 'network error', code: '' } },
    })

    const failure = await repository.saveTemplate(template).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RepositoryError)
    expect(failure).not.toBeInstanceOf(RepositoryConflictError)
  })
})

describe('SupabaseSlaidsRepository – filer', () => {
  it('legger filen under brukerens UUID og knytter raden til presentasjonen', async () => {
    const ref = sampleAsset()
    const { repository, fake } = repositoryFor({ resolve: () => ({ data: null }) })

    await repository.putAsset('p1', ref, new Blob(['bytes']))

    expect(fake.storageCalls[0]).toEqual({
      op: 'upload',
      bucket: ASSETS_BUCKET,
      paths: [`${TEST_OWNER_ID}/p1/${ref.id}`],
    })
    const row = fake.queries.at(-1)
    expect(row?.table).toBe(ASSETS_TABLE)
    expect(row?.op).toBe('upsert')
    const values = row?.values as Record<string, unknown>
    expect(values.owner_id).toBe(TEST_OWNER_ID)
    expect(values.presentation_id).toBe('p1')
    expect(values.object_path).toBe(`${TEST_OWNER_ID}/p1/${ref.id}`)
    expect(values.ref).toEqual(ref)
  })

  it('rydder bort en opplastet fil som ikke fikk metadata', async () => {
    const ref = sampleAsset()
    const { repository, fake } = repositoryFor({
      resolve: () => ({ error: { message: 'rad avvist' } }),
    })

    await expect(repository.putAsset('p1', ref, new Blob(['bytes']))).rejects.toThrow(/rad avvist/)
    expect(fake.storageCalls.map((call) => call.op)).toEqual(['upload', 'remove'])
  })

  it('avviser ugyldig fil-metadata fra remote', async () => {
    const { repository } = repositoryFor({
      resolve: () => ({ data: { ref: { id: 'a1', name: 'x' }, object_path: 'p/a1' } }),
    })
    await expect(repository.getAsset('a1')).rejects.toThrow(/ugyldig/i)
  })

  it('henter ref og blob sammen', async () => {
    const ref = sampleAsset()
    const blob = new Blob(['innhold'])
    const { repository } = repositoryFor({
      resolve: () => ({ data: { ref, object_path: `${TEST_OWNER_ID}/p1/${ref.id}` } }),
      download: () => ({ data: blob }),
    })

    const stored = await repository.getAsset(ref.id)
    expect(stored?.ref).toEqual(ref)
    expect(stored?.blob).toBe(blob)
  })

  it('svarer null når filen ikke finnes', async () => {
    const { repository } = repositoryFor({ resolve: () => ({ data: null }) })
    expect(await repository.getAsset('mangler')).toBeNull()
  })

  it('feier ikke bort en fil som har fått rad igjen', async () => {
    const ref = sampleAsset()
    let rowFails = true
    const { repository, fake } = repositoryFor({
      resolve: () => (rowFails ? { error: { message: 'rad avvist' } } : { data: null }),
      remove: () => ({ error: { message: 'storage nede' } }),
      list: () => ({ data: [] }),
    })

    // First attempt: the row is rejected and the file cannot be taken back out,
    // so its path is queued for reclaiming.
    await expect(repository.putAsset('p1', ref, new Blob(['bytes']))).rejects.toThrow(/rad avvist/)

    // Second attempt succeeds. The queued path now points at a live file.
    rowFails = false
    await repository.putAsset('p1', ref, new Blob(['bytes']))

    const before = fake.storageCalls.filter((call) => call.op === 'remove').length
    expect(await repository.deleteOrphanAssets()).toBe(0)
    expect(fake.storageCalls.filter((call) => call.op === 'remove')).toHaveLength(before)
  })

  it('rydder mappen til en presentasjon som er borte', async () => {
    const { repository, fake } = repositoryFor({
      // `p1` finnes fortsatt; `p2` er slettet, men filene ble liggende igjen.
      resolve: () => ({ data: [{ id: 'p1' }] }),
      list: (prefix) => {
        if (prefix === TEST_OWNER_ID) {
          return { data: [{ name: 'p1', id: null }, { name: 'p2', id: null }] }
        }
        if (prefix === `${TEST_OWNER_ID}/p2`) {
          return { data: [{ name: 'a1', id: 'o1' }, { name: 'a2', id: 'o2' }] }
        }
        return { data: [] }
      },
    })

    expect(await repository.deleteOrphanAssets()).toBe(2)
    expect(fake.storageCalls.filter((call) => call.op === 'remove')).toEqual([
      {
        op: 'remove',
        bucket: ASSETS_BUCKET,
        paths: [`${TEST_OWNER_ID}/p2/a1`, `${TEST_OWNER_ID}/p2/a2`],
      },
    ])
    // The live presentation's folder is never opened, let alone emptied.
    expect(fake.storageCalls.some((call) => call.paths[0] === `${TEST_OWNER_ID}/p1`)).toBe(false)
  })

  it('feier bare én gang per innlogging, og koster to kall når det er tomt', async () => {
    const { repository, fake } = repositoryFor({
      resolve: () => ({ data: [] }),
      list: () => ({ data: [] }),
    })

    expect(await repository.deleteOrphanAssets()).toBe(0)
    const afterFirst = fake.storageCalls.length + fake.queries.length
    expect(afterFirst).toBeLessThanOrEqual(2)

    expect(await repository.deleteOrphanAssets()).toBe(0)
    // The library refreshes often; a second sweep must not cost anything.
    expect(fake.storageCalls.length + fake.queries.length).toBe(afterFirst)
  })

  it('feier ikke når ingen er logget inn', async () => {
    const { repository } = repositoryFor({ session: null, list: () => ({ data: [] }) })
    expect(await repository.deleteOrphanAssets()).toBe(0)
  })
})
