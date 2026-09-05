import { describe, expect, it } from 'vitest'
import { createPresentation } from '../domain/presentation'
import { presentationRevision } from '../domain/revision'
import { CURRENT_SCHEMA_VERSION } from '../domain/schema'
import { FONT_SCALE_RANGE, SPACING_RANGE } from '../domain/metrics'
import { newAssetId } from '../domain/ids'
import type { AssetRef, Presentation } from '../domain/types'
import { RepositoryConflictError, RepositoryError } from './repository'
import {
  ASSETS_BUCKET,
  ASSETS_TABLE,
  FOLDERS_TABLE,
  PRESENTATIONS_TABLE,
  SupabaseSlaidsRepository,
  TEMPLATES_TABLE,
} from './supabaseRepository'
import {
  TEST_OWNER_ID,
  createFakeSupabase,
  type FakeSupabaseOptions,
  type QueryRecord,
  type QueryResolver,
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
    // Migrated to the neutral multiplier the row was drawn at, then clamped
    // into the range the theme offers today.
    expect(loaded.theme.spacing).toBe(SPACING_RANGE.min)
    expect(loaded.theme.fontScale).toBe(FONT_SCALE_RANGE.min)
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

  it('lar ikke en vaktet lagring arve versjonen en annen lagring nettopp skaffet', async () => {
    // The race this exists for, in order and without any timing:
    //   A og B leser samme versjon → A lagrer → B lagrer.
    // Versjonen B skriver mot må være den B *leste*, ikke den A etterlot seg i
    // repositoryets delte tilstand. Ellers matcher B raden A nettopp skrev, og
    // As endring forsvinner.
    const presentation = createPresentation({ title: 'Start' })
    let remoteVersion = 1
    let stored: Presentation = presentation

    const { repository, fake } = repositoryFor({
      resolve: (record) => {
        if (record.op === 'select') {
          return { data: { document: stored, version: remoteVersion, is_shared: false } }
        }
        if (record.op !== 'update') return { data: [] }
        // The database's own compare-and-swap: the UPDATE touches nothing
        // unless the row still has the version the statement asked for.
        if (filterValue(record, 'version') !== remoteVersion) return { data: [] }
        remoteVersion += 1
        stored = (record.values as { document: Presentation }).document
        return { data: [{ version: remoteVersion, is_shared: false }] }
      },
    })

    const readByA = await repository.loadPresentation(presentation.id)
    const readByB = await repository.loadPresentation(presentation.id)
    const guardA = { expectedRevision: presentationRevision(readByA) }
    const guardB = { expectedRevision: presentationRevision(readByB) }

    await repository.savePresentation({ ...readByA, title: 'Skrevet av A' }, guardA)
    await expect(
      repository.savePresentation({ ...readByB, title: 'Skrevet av B' }, guardB),
    ).rejects.toBeInstanceOf(RepositoryConflictError)

    // A's write is the one that stands, and B guarded on the version it read.
    expect(stored.title).toBe('Skrevet av A')
    expect(remoteVersion).toBe(2)
    const writes = fake.queries.filter((query) => query.op === 'update')
    expect(writes.map((query) => filterValue(query, 'version'))).toEqual([1, 1])
  })

  it('avviser en vaktet lagring av en lesing denne økten ikke har gjort', async () => {
    // Nothing to look the version up by, so there is no version to guard with.
    // Refusing is the only safe answer: guessing one is the overwrite the guard
    // exists to prevent.
    const presentation = createPresentation({ title: 'Ulest' })
    const { repository, fake } = repositoryFor({
      resolve: () => ({ data: [{ version: 2, is_shared: false }] }),
    })

    await expect(
      repository.savePresentation(presentation, { expectedRevision: 'en-revisjon-vi-aldri-leste' }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)
    expect(fake.queries.filter((query) => query.op !== 'select')).toEqual([])
  })

  it('lar editorens autolagring skrive ubetinget, som før', async () => {
    // No guard: the version is this repository's last known one, and each save
    // builds on the one before it. That contract is unchanged.
    const presentation = createPresentation({ title: 'Autosave' })
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 5, is_shared: false } }
          : { data: [{ version: 6, is_shared: false }] },
    })

    await repository.loadPresentation(presentation.id)
    await repository.savePresentation({ ...presentation, title: 'Endret' })
    await repository.savePresentation({ ...presentation, title: 'Endret igjen' })

    const writes = fake.queries.filter((query) => query.op === 'update')
    expect(writes.map((query) => filterValue(query, 'version'))).toEqual([5, 6])
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

  it('gjenoppretter ikke en presentasjon som er slettet et annet sted', async () => {
    const presentation = createPresentation({ title: 'Lest' })
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 4 } }
          : // Raden er borte: en annen fane slettet den, så ingen update matcher.
            { data: [] },
    })

    await repository.loadPresentation(presentation.id)
    await expect(repository.savePresentation(presentation)).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )

    // Autosave beholder snapshotet og prøver igjen. Dette forsøket må fortsatt
    // være en vaktet UPDATE: et INSERT ville gjenopprettet presentasjonen fra en
    // gammel kopi, med AssetRef-er som peker på filer sletttingen tok med seg.
    await expect(repository.savePresentation(presentation)).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )

    const writes = fake.queries.filter((query) => query.op !== 'select')
    expect(writes.map((query) => query.op)).toEqual(['update', 'update'])
    expect(writes.every((query) => filterValue(query, 'version') === 4)).toBe(true)
  })

  it('slipper gjennom igjen først når dokumentet er lest på nytt', async () => {
    const presentation = createPresentation({ title: 'Lest' })
    let remoteVersion = 4
    let updateMatches = false
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: remoteVersion } }
          : { data: updateMatches ? [{ version: remoteVersion + 1 }] : [] },
    })

    await repository.loadPresentation(presentation.id)
    // Noen andre skrev versjon 5 i mellomtiden.
    await expect(repository.savePresentation(presentation)).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )
    // Uten en ny lesing er vi fortsatt låst til versjonen vi leste.
    await expect(repository.savePresentation(presentation)).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )
    expect(filterValue(fake.queries.at(-1) as QueryRecord, 'version')).toBe(4)

    // Å åpne den på nytt er det som løser en vanlig versjonskonflikt.
    remoteVersion = 5
    updateMatches = true
    await repository.loadPresentation(presentation.id)
    await repository.savePresentation(presentation)

    const write = fake.queries.at(-1)
    expect(write?.op).toBe('update')
    expect(filterValue(write as QueryRecord, 'version')).toBe(5)
  })

  it('behandler en presentasjon som ny igjen bare når vi selv slettet den', async () => {
    const presentation = createPresentation({ title: 'Lest' })
    const { repository, fake } = repositoryFor({
      resolve: (record) => {
        if (record.table === ASSETS_TABLE) return { data: [] }
        if (record.op === 'select') return { data: { document: presentation, version: 4 } }
        return { data: { version: 1 } }
      },
    })

    await repository.loadPresentation(presentation.id)
    await repository.deletePresentation(presentation.id)
    await repository.savePresentation(presentation)

    // Vi slettet den selv, så det å lagre den igjen er å lage en ny.
    expect(fake.queries.at(-1)?.op).toBe('insert')
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

  it('sletter mot versjonen lesingen kom fra, og lar raden stå når den har flyttet seg', async () => {
    // The delete is the same conditional statement the guarded save is — the
    // version travels in the WHERE clause, so the comparison happens in the
    // database rather than between two round trips here.
    const presentation = createPresentation({ title: 'Vaktet sletting' })
    let remoteVersion = 1
    const { repository, fake } = repositoryFor({
      resolve: (record) => {
        if (record.table === ASSETS_TABLE) return { data: [] }
        if (record.op === 'select') {
          return { data: { document: presentation, version: remoteVersion, is_shared: false } }
        }
        if (record.op !== 'delete') return { data: [] }
        return filterValue(record, 'version') === remoteVersion ? { data: [{ id: presentation.id }] } : { data: [] }
      },
    })

    const read = await repository.loadPresentation(presentation.id)
    const guard = { expectedRevision: presentationRevision(read) }
    // Somebody else writes in the meantime; the row is now at version 2.
    remoteVersion = 2

    await expect(repository.deletePresentation(presentation.id, guard)).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )
    const refused = fake.queries.find((query) => query.op === 'delete')
    expect(filterValue(refused as QueryRecord, 'version')).toBe(1)
    // Nothing was reclaimed either: a refused delete touches neither store.
    expect(fake.storageCalls.filter((call) => call.op === 'remove')).toEqual([])

    remoteVersion = 1
    await expect(repository.deletePresentation(presentation.id, guard)).resolves.toBeUndefined()
  })

  it('avviser en vaktet sletting av en lesing denne økten ikke har gjort', async () => {
    // The same answer the guarded save gives, and for a sharper reason: there is
    // no version to guard with, and guessing one on a delete is the one guess
    // with no way back.
    const { repository, fake } = repositoryFor({ resolve: () => ({ data: [] }) })

    await expect(
      repository.deletePresentation('p1', { expectedRevision: 'en-revisjon-vi-aldri-leste' }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)
    expect(fake.queries.some((query) => query.op === 'delete')).toBe(false)
  })

  it('tar delingen med seg fordi den ligger på den samme raden', async () => {
    // `is_shared`, `share_token` and `shared_document` are columns on the
    // presentation row, so one DELETE takes the published copy down with the
    // document. No separate revocation to forget, and none is made.
    const { repository, fake } = repositoryFor({
      resolve: (record) => (record.op === 'select' ? { data: [] } : { data: null }),
    })

    await repository.deletePresentation('p1')

    const writes = fake.queries.filter((query) => query.op !== 'select')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ table: PRESENTATIONS_TABLE, op: 'delete' })
    expect(filterValue(writes[0], 'id')).toBe('p1')
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

  it('sier fra når raden er borte men bytene ble liggende igjen', async () => {
    // Deleting one file is two removals, and only the first one may fail the
    // call: the row is gone, which is what the caller asked for. But a caller
    // that *reports* the outcome — `delete_asset` answers an agent with
    // `fileRemoved` — must not be told the bytes went with it when they did
    // not. The pending path is remembered for the sweep, and remembering is a
    // weaker promise than it looks: on the server the repository is built per
    // request, so nothing here outlives the call.
    const objectPath = `${TEST_OWNER_ID}/p1/a1`
    const { repository, fake } = repositoryFor({
      // `deleteAsset` reads its one row with `maybeSingle()`, so the row is an
      // object rather than the array a plain select answers with.
      resolve: (record) => (record.op === 'select' ? { data: { object_path: objectPath } } : { data: null }),
      remove: () => ({ error: { message: 'storage nede' } }),
    })

    expect(await repository.deleteAsset('a1')).toBe(false)
    // The row still went first, and it still went.
    const del = fake.queries.find((query) => query.op === 'delete')
    expect(del?.table).toBe(ASSETS_TABLE)
    expect(fake.storageCalls).toEqual([
      { op: 'remove', bucket: ASSETS_BUCKET, paths: [objectPath] },
    ])
  })

  it('sier at filen er borte når begge halvdelene gikk igjennom', async () => {
    const { repository } = repositoryFor({
      resolve: (record) =>
        record.op === 'select' ? { data: { object_path: `${TEST_OWNER_ID}/p1/a1` } } : { data: null },
      remove: () => ({ data: [] }),
    })
    expect(await repository.deleteAsset('a1')).toBe(true)
  })

  it('sier at filen er borte når det ikke fantes noen rad å slette', async () => {
    // Nothing points at any bytes, which is the state the caller asked for.
    const { repository, fake } = repositoryFor({ resolve: () => ({ data: null }) })
    expect(await repository.deleteAsset('a_borte')).toBe(true)
    expect(fake.storageCalls).toEqual([])
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
    // An insert, never an upsert: an upsert conflicts on the primary key alone,
    // so a taken id would be a row taken over rather than a collision refused.
    // See `saveOwnedRow`.
    expect(row?.op).toBe('insert')
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

/**
 * The server-side shape of the repository.
 *
 * The agent REST layer has no browser session to ask who is signed in — it
 * authenticates an agent token and reads the owner off that token's row — and
 * it holds a secret key, which bypasses row level security. Both halves of the
 * pin are therefore load-bearing: the owner on a write comes from the pin, and
 * the filter RLS would have applied is written out instead of assumed.
 */
describe('SupabaseSlaidsRepository – pinnet til én eier', () => {
  const PINNED = '99999999-8888-4777-8666-555555555555'

  function pinnedRepositoryFor(options: FakeSupabaseOptions) {
    const fake = createFakeSupabase({ session: null, ...options })
    return { repository: new SupabaseSlaidsRepository(() => fake.client, PINNED), fake }
  }

  it('skriver med eieren fra pinnen, uten en sesjon å spørre', async () => {
    const { repository, fake } = pinnedRepositoryFor({
      resolve: (record) => (record.op === 'insert' ? { data: { version: 1 } } : { data: [] }),
    })

    await repository.savePresentation(createPresentation({ title: 'Fra agenten' }))

    const insert = fake.queries.find((record) => record.op === 'insert')
    expect((insert?.values as { owner_id?: string })?.owner_id).toBe(PINNED)
  })

  it('filtrerer lesing og skriving på eieren, siden RLS er omgått', async () => {
    const presentation = createPresentation({ title: 'Eid' })
    const { repository, fake } = pinnedRepositoryFor({
      resolve: (record) =>
        record.table === PRESENTATIONS_TABLE && record.op === 'select' && record.single === 'maybe'
          ? { data: { document: presentation, version: 2 } }
          : { data: [] },
    })

    await repository.listPresentations()
    await repository.loadPresentation(presentation.id)
    await repository.listAssets(presentation.id)
    await repository.listFolders()
    await repository.listTemplates()

    // Every one of them, not most of them: a single unfiltered read against a
    // key that bypasses RLS is a read of somebody else's rows.
    for (const record of fake.queries) {
      expect(filterValue(record, 'owner_id')).toBe(PINNED)
    }
  })

  it('holder den vaktede skrivingen bundet til eieren *og* versjonen', async () => {
    const presentation = createPresentation({ title: 'Vaktet' })
    const { repository, fake } = pinnedRepositoryFor({
      resolve: (record) =>
        record.op === 'update' ? { data: [{ version: 4, is_shared: false }] } : { data: { document: presentation, version: 3 } },
    })

    const loaded = await repository.loadPresentation(presentation.id)
    await repository.savePresentation(loaded, { expectedRevision: presentationRevision(loaded) })

    const update = fake.queries.find((record) => record.op === 'update')
    expect(filterValue(update as QueryRecord, 'owner_id')).toBe(PINNED)
    expect(filterValue(update as QueryRecord, 'version')).toBe(3)
  })

  it('lar nettleseren være helt uendret: ingen eierfilter uten pin', async () => {
    // The browser has RLS doing this, and adding a redundant filter there would
    // be a second copy of the rule that can drift from the policy.
    const { repository, fake } = repositoryFor({ resolve: () => ({ data: [] }) })
    await repository.listPresentations()
    await repository.listFolders()
    for (const record of fake.queries) {
      expect(record.filters.some((filter) => filter.column === 'owner_id')).toBe(false)
    }
  })
})


/**
 * Two owners, one table.
 *
 * The claims here are about *stored state*, so the resolver below is a small
 * stand-in for Postgres rather than a recorder: it has a primary key on `id`,
 * it raises `23505` when one is taken, and filters actually filter. A test that
 * only asserted "the right method was called" could not tell an upsert that
 * takes a row over from an insert that refuses to.
 *
 * A server-side client holds a secret key and therefore has no row level
 * security narrowing anything. What stops it reaching the other owner's rows is
 * only what this file checks.
 */
describe('SupabaseSlaidsRepository – to eiere, én tabell', () => {
  const OURS = '99999999-8888-4777-8666-555555555555'
  const THEIRS = '00000000-1111-4222-8333-444444444444'

  type Row = Record<string, unknown>

  function matches(row: Row, filters: QueryRecord['filters']): boolean {
    return filters.every((filter) =>
      Array.isArray(filter.value)
        ? filter.value.includes(row[filter.column])
        : row[filter.column] === filter.value,
    )
  }

  /** One `id` primary key per table, and a unique violation when it is taken. */
  function fakeDatabase(seed: Record<string, Row[]>) {
    const tables: Record<string, Row[]> = {}
    for (const [table, rows] of Object.entries(seed)) tables[table] = rows.map((row) => ({ ...row }))

    const resolve: QueryResolver = (record) => {
      const rows = (tables[record.table] ??= [])
      const hit = rows.filter((row) => matches(row, record.filters))

      switch (record.op) {
        case 'select':
          return { data: record.single === 'none' ? hit : (hit[0] ?? null) }
        case 'insert': {
          const incoming = (Array.isArray(record.values) ? record.values : [record.values]) as Row[]
          for (const row of incoming) {
            if (rows.some((existing) => existing.id === row.id)) {
              return {
                error: { message: 'duplicate key value violates unique constraint', code: '23505' },
              }
            }
          }
          rows.push(...incoming.map((row) => ({ ...row })))
          return { data: record.single === 'none' ? incoming : incoming[0] }
        }
        case 'update': {
          for (const row of hit) Object.assign(row, record.values as Row)
          return { data: hit }
        }
        case 'upsert': {
          // Never reached by the paths under test — asserted below — but honest
          // about what it would do if one came back: take the row over.
          const incoming = (Array.isArray(record.values) ? record.values : [record.values]) as Row[]
          for (const row of incoming) {
            const existing = rows.find((entry) => entry.id === row.id)
            if (existing) Object.assign(existing, row)
            else rows.push({ ...row })
          }
          return { data: incoming }
        }
        case 'delete':
          for (const row of hit) rows.splice(rows.indexOf(row), 1)
          return { data: hit }
      }
    }

    return { tables, resolve }
  }

  function theirFolder(): Row {
    return { id: 'fl_delt', owner_id: THEIRS, name: 'Deres mappe', created_at: EARLIER }
  }

  function theirAsset(): Row {
    return {
      id: 'a_delt',
      owner_id: THEIRS,
      presentation_id: 'p_deres',
      ref: { id: 'a_delt', name: 'deres.png' },
      object_path: `${THEIRS}/p_deres/a_delt`,
    }
  }

  const EARLIER = '2026-08-01T09:00:00.000Z'

  function pinned(seed: Record<string, Row[]>) {
    const database = fakeDatabase(seed)
    const fake = createFakeSupabase({ session: null, resolve: database.resolve })
    return {
      repository: new SupabaseSlaidsRepository(() => fake.client, OURS),
      fake,
      tables: database.tables,
    }
  }

  /* ---------------------------------------------------------------- *
   * Reading
   * ---------------------------------------------------------------- */

  it('ser ikke den andre eierens filer', async () => {
    const { repository } = pinned({
      [ASSETS_TABLE]: [
        theirAsset(),
        {
          id: 'a_vår',
          owner_id: OURS,
          presentation_id: 'p_vår',
          ref: { id: 'a_vår', name: 'vår.png', mimeType: 'image/png', byteSize: 1, width: 1, height: 1, isVector: false },
          object_path: `${OURS}/p_vår/a_vår`,
        },
      ],
    })

    // `presentation_id` is not what protects this: the ids are asked for
    // directly, across presentations.
    expect(await repository.existingAssetIds(['a_delt', 'a_vår'])).toEqual(['a_vår'])
    // And a direct lookup by their id finds nothing at all.
    expect(await repository.getAsset('a_delt')).toBeNull()
  })

  it('ser ikke den andre eierens mapper eller presentasjoner', async () => {
    const { repository } = pinned({
      [FOLDERS_TABLE]: [theirFolder(), { id: 'fl_vår', owner_id: OURS, name: 'Vår', created_at: EARLIER }],
      [PRESENTATIONS_TABLE]: [
        { id: 'p_deres', owner_id: THEIRS, title: 'Deres', version: 1 },
        { id: 'p_vår', owner_id: OURS, title: 'Vår', folder_id: null, slide_count: 1, version: 1 },
      ],
    })

    expect((await repository.listFolders()).map((folder) => folder.id)).toEqual(['fl_vår'])
    expect((await repository.listPresentations()).map((summary) => summary.id)).toEqual(['p_vår'])
  })

  /* ---------------------------------------------------------------- *
   * Writing: never a takeover
   * ---------------------------------------------------------------- */

  it('kan ikke overta den andre eierens mappe ved id-kollisjon', async () => {
    const { repository, tables, fake } = pinned({ [FOLDERS_TABLE]: [theirFolder()] })

    await expect(
      repository.saveFolder({ id: 'fl_delt', name: 'Vår nå', createdAt: EARLIER }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)

    // Their row, byte for byte as it was. Not renamed, and still theirs.
    expect(tables[FOLDERS_TABLE]).toEqual([theirFolder()])
    // And no upsert was ever sent: the takeover is impossible, not merely unlikely.
    expect(fake.queries.some((record) => record.op === 'upsert')).toBe(false)
  })

  it('kan ikke overta den andre eierens fil ved id-kollisjon, og rydder opp etter seg', async () => {
    const { repository, tables, fake } = pinned({ [ASSETS_TABLE]: [theirAsset()] })

    await expect(
      repository.putAsset('p_vår', sampleAssetWithId('a_delt'), new Blob(['x'])),
    ).rejects.toBeInstanceOf(RepositoryConflictError)

    expect(tables[ASSETS_TABLE]).toEqual([theirAsset()])
    expect(fake.queries.some((record) => record.op === 'upsert')).toBe(false)

    // The bytes we uploaded sit under *our* prefix and are now unreferenced, so
    // they go back out. Their file was never touched — different prefix.
    const removed = fake.storageCalls.filter((call) => call.op === 'remove')
    expect(removed.flatMap((call) => call.paths)).toEqual([`${OURS}/p_vår/a_delt`])
    expect(removed.flatMap((call) => call.paths)).not.toContain(`${THEIRS}/p_deres/a_delt`)
  })

  /* ---------------------------------------------------------------- *
   * Writing: our own rows still work
   * ---------------------------------------------------------------- */

  it('oppretter og oppdaterer sine egne rader som før', async () => {
    const { repository, tables } = pinned({ [FOLDERS_TABLE]: [theirFolder()] })

    await repository.saveFolder({ id: 'fl_vår', name: 'Vår', createdAt: EARLIER })
    expect(tables[FOLDERS_TABLE]).toContainEqual({
      id: 'fl_vår',
      owner_id: OURS,
      name: 'Vår',
      created_at: EARLIER,
    })

    // Saving the same id again updates in place rather than duplicating.
    await repository.saveFolder({ id: 'fl_vår', name: 'Vår, omdøpt', createdAt: EARLIER })
    expect(tables[FOLDERS_TABLE].filter((row) => row.id === 'fl_vår')).toEqual([
      { id: 'fl_vår', owner_id: OURS, name: 'Vår, omdøpt', created_at: EARLIER },
    ])
    expect(tables[FOLDERS_TABLE]).toContainEqual(theirFolder())
  })

  it('lagrer og overskriver sin egen fil', async () => {
    const { repository, tables } = pinned({ [ASSETS_TABLE]: [theirAsset()] })

    await repository.putAsset('p_vår', sampleAssetWithId('a_vår'), new Blob(['x']))
    expect(tables[ASSETS_TABLE].find((row) => row.id === 'a_vår')).toMatchObject({
      owner_id: OURS,
      presentation_id: 'p_vår',
      object_path: `${OURS}/p_vår/a_vår`,
    })

    await repository.putAsset('p_vår', { ...sampleAssetWithId('a_vår'), name: 'nytt.png' }, new Blob(['y']))
    const ours = tables[ASSETS_TABLE].filter((row) => row.id === 'a_vår')
    expect(ours).toHaveLength(1)
    expect((ours[0].ref as AssetRef).name).toBe('nytt.png')
    expect(tables[ASSETS_TABLE]).toContainEqual(theirAsset())
  })

  it('kan ikke overta den andre eierens presentasjon eller mal heller', async () => {
    // These two already refused a taken id — an insert, never an upsert, with
    // the unique violation mapped to a conflict. Pinned here so the whole class
    // is covered by a test rather than by a reading of it.
    const { repository, tables } = pinned({
      [PRESENTATIONS_TABLE]: [{ id: 'p_deres', owner_id: THEIRS, title: 'Deres', version: 4 }],
      [TEMPLATES_TABLE]: [{ id: 't_deres', owner_id: THEIRS, name: 'Deres mal', template: {} }],
    })

    const ours = createPresentation({ title: 'Vår' })
    await expect(
      repository.savePresentation({ ...ours, id: 'p_deres' }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)
    expect(tables[PRESENTATIONS_TABLE]).toEqual([
      { id: 'p_deres', owner_id: THEIRS, title: 'Deres', version: 4 },
    ])

    await expect(
      repository.saveTemplate({
        id: 't_deres',
        name: 'Vår mal',
        createdAt: EARLIER,
        root: ours.slides[0].root,
        hasTitle: false,
      }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)
    expect(tables[TEMPLATES_TABLE]).toEqual([
      { id: 't_deres', owner_id: THEIRS, name: 'Deres mal', template: {} },
    ])
  })

  /* ---------------------------------------------------------------- *
   * Deleting a folder
   * ---------------------------------------------------------------- */

  /** A stored presentation, with the folder written in both places it lives. */
  function deckRow(id: string, folderId: string | null, version = 1): Row {
    return {
      id,
      owner_id: OURS,
      title: id,
      folder_id: folderId,
      document: { id, title: id, folderId },
      slide_count: 1,
      version,
    }
  }

  it('sletter mappen og lar presentasjonene i den bli liggende, uten mappe', async () => {
    // The contract on `SlaidsRepository.deleteFolder`, checked against the store
    // rather than against a method call — and in Supabase, because the database
    // has its own `on delete set null` on the *column* and would happily leave
    // the `folderId` inside the document pointing at a folder that is gone.
    const { repository, tables } = pinned({
      [FOLDERS_TABLE]: [
        theirFolder(),
        { id: 'fl_slettes', owner_id: OURS, name: 'Slettes', created_at: EARLIER },
        { id: 'fl_beholdes', owner_id: OURS, name: 'Beholdes', created_at: EARLIER },
      ],
      [PRESENTATIONS_TABLE]: [
        deckRow('p_en', 'fl_slettes'),
        deckRow('p_to', 'fl_slettes'),
        deckRow('p_annen_mappe', 'fl_beholdes'),
        deckRow('p_rot', null),
        { ...deckRow('p_deres', 'fl_slettes'), owner_id: THEIRS },
      ],
    })

    await repository.deleteFolder('fl_slettes')

    // The folder is gone; the other one, and the other owner's, are not.
    expect(tables[FOLDERS_TABLE].map((row) => row.id).sort()).toEqual(['fl_beholdes', 'fl_delt'])

    // Every presentation is still there.
    expect(tables[PRESENTATIONS_TABLE]).toHaveLength(5)
    for (const id of ['p_en', 'p_to']) {
      const row = tables[PRESENTATIONS_TABLE].find((entry) => entry.id === id)
      // Both places the folder is written down, because the library filters on
      // the column and the editor reads the document.
      expect({ id, column: row?.folder_id }).toEqual({ id, column: null })
      expect((row?.document as { folderId: string | null }).folderId).toBeNull()
    }
    // Untouched: another folder, the root, and the other owner's row — which we
    // must not reach even though it names the folder we just deleted.
    const kept = tables[PRESENTATIONS_TABLE].find((entry) => entry.id === 'p_annen_mappe')
    expect(kept?.folder_id).toBe('fl_beholdes')
    expect(tables[PRESENTATIONS_TABLE].find((entry) => entry.id === 'p_deres')).toEqual({
      ...deckRow('p_deres', 'fl_slettes'),
      owner_id: THEIRS,
    })
  })

  it('tømmer mappen før den fjerner den, og skriver mot versjonen den leste', async () => {
    // The order is the safety property, not a detail: removing the folder first
    // would leave the database's own `on delete set null` to clear the column
    // while the document still named a folder that no longer exists — a deck
    // shown neither at the root nor in any folder.
    const { repository, fake } = pinned({
      [FOLDERS_TABLE]: [{ id: 'fl_x', owner_id: OURS, name: 'X', created_at: EARLIER }],
      [PRESENTATIONS_TABLE]: [deckRow('p_en', 'fl_x', 7)],
    })

    await repository.deleteFolder('fl_x')

    const moved = fake.queries.findIndex(
      (record) => record.table === PRESENTATIONS_TABLE && record.op === 'update',
    )
    const removed = fake.queries.findIndex(
      (record) => record.table === FOLDERS_TABLE && record.op === 'delete',
    )
    expect(moved).toBeGreaterThanOrEqual(0)
    expect(moved).toBeLessThan(removed)
    // Guarded on the version the move read: the write puts the whole document
    // back, so an unguarded one would revert an edit made in between.
    expect(filterValue(fake.queries[moved], 'version')).toBe(7)
    expect(filterValue(fake.queries[moved], 'owner_id')).toBe(OURS)
  })

  it('leser raden på nytt og fortsetter når den taper kappløpet', async () => {
    // A lost guard is not a reason to abandon a deletion half-way through: that
    // would leave some decks at the root with the folder still standing, which
    // is exactly the half-done state Dexie's single transaction never produces.
    // So the row is re-read and the folder stripped from *that* document.
    const database = fakeDatabase({
      [FOLDERS_TABLE]: [{ id: 'fl_x', owner_id: OURS, name: 'X', created_at: EARLIER }],
      [PRESENTATIONS_TABLE]: [deckRow('p_en', 'fl_x', 1)],
    })

    let raced = false
    const fake = createFakeSupabase({
      session: null,
      resolve: (record) => {
        // One concurrent save, landing between the read and the guarded write.
        if (record.table === PRESENTATIONS_TABLE && record.op === 'update' && !raced) {
          raced = true
          const row = database.tables[PRESENTATIONS_TABLE][0]
          row.version = 2
          row.document = { ...(row.document as object), title: 'Endret av noen andre' }
        }
        return database.resolve(record)
      },
    })
    const repository = new SupabaseSlaidsRepository(() => fake.client, OURS)

    await repository.deleteFolder('fl_x')

    expect(database.tables[FOLDERS_TABLE]).toEqual([])
    const row = database.tables[PRESENTATIONS_TABLE][0]
    expect(row.folder_id).toBeNull()
    // Written against the *newer* reading: the concurrent edit survives, and the
    // folder is stripped from the document that actually won.
    expect(row.document).toEqual({
      id: 'p_en',
      title: 'Endret av noen andre',
      folderId: null,
    })
  })

  it('gir opp med en konflikt, og lar mappen stå, når raden aldri slutter å endre seg', async () => {
    const database = fakeDatabase({
      [FOLDERS_TABLE]: [{ id: 'fl_x', owner_id: OURS, name: 'X', created_at: EARLIER }],
      [PRESENTATIONS_TABLE]: [deckRow('p_en', 'fl_x', 1)],
    })

    const fake = createFakeSupabase({
      session: null,
      resolve: (record) => {
        if (record.table === PRESENTATIONS_TABLE && record.op === 'update') {
          const row = database.tables[PRESENTATIONS_TABLE][0]
          row.version = (row.version as number) + 1
        }
        return database.resolve(record)
      },
    })
    const repository = new SupabaseSlaidsRepository(() => fake.client, OURS)

    await expect(repository.deleteFolder('fl_x')).rejects.toBeInstanceOf(RepositoryConflictError)
    // Bounded rather than unbounded, and the folder is still there — so a caller
    // that reads again and retries lands somewhere it can reason about.
    expect(database.tables[FOLDERS_TABLE]).toHaveLength(1)
    expect(database.tables[PRESENTATIONS_TABLE][0].folder_id).toBe('fl_x')
  })

  it('lar en presentasjon som forsvant ut av mappen underveis være i fred', async () => {
    // Moved out or deleted by somebody else between the scan and the write. The
    // state this asked for is the state it found, so it is not a failure and the
    // deletion carries on.
    const database = fakeDatabase({
      [FOLDERS_TABLE]: [{ id: 'fl_x', owner_id: OURS, name: 'X', created_at: EARLIER }],
      [PRESENTATIONS_TABLE]: [deckRow('p_en', 'fl_x', 1)],
    })

    let raced = false
    const fake = createFakeSupabase({
      session: null,
      resolve: (record) => {
        if (record.table === PRESENTATIONS_TABLE && record.op === 'update' && !raced) {
          raced = true
          const row = database.tables[PRESENTATIONS_TABLE][0]
          row.version = 2
          row.folder_id = 'fl_et_annet_sted'
          row.document = { ...(row.document as object), folderId: 'fl_et_annet_sted' }
        }
        return database.resolve(record)
      },
    })
    const repository = new SupabaseSlaidsRepository(() => fake.client, OURS)

    await repository.deleteFolder('fl_x')

    expect(database.tables[FOLDERS_TABLE]).toEqual([])
    // Left exactly where its new owner put it, not dragged back to the root.
    expect(database.tables[PRESENTATIONS_TABLE][0].folder_id).toBe('fl_et_annet_sted')
  })

  it('gir ikke opp når raden forsvant på det aller siste forsøket', async () => {
    // The boundary case of the two above: every attempt loses, and the *last*
    // re-read is the one that comes back empty. The row is out of the folder,
    // so there is nothing left to move and the folder must still go — throwing
    // a conflict here would refuse a deletion whose work is already done.
    const database = fakeDatabase({
      [FOLDERS_TABLE]: [{ id: 'fl_x', owner_id: OURS, name: 'X', created_at: EARLIER }],
      [PRESENTATIONS_TABLE]: [deckRow('p_en', 'fl_x', 1)],
    })

    let updates = 0
    const fake = createFakeSupabase({
      session: null,
      resolve: (record) => {
        if (record.table === PRESENTATIONS_TABLE && record.op === 'update') {
          updates += 1
          const row = database.tables[PRESENTATIONS_TABLE][0]
          // Always lose the guard, and on the final attempt also leave the
          // folder, so the re-read after it finds nothing.
          row.version = (row.version as number) + 1
          if (updates >= 4) {
            row.folder_id = 'fl_et_annet_sted'
            row.document = { ...(row.document as object), folderId: 'fl_et_annet_sted' }
          }
        }
        return database.resolve(record)
      },
    })
    const repository = new SupabaseSlaidsRepository(() => fake.client, OURS)

    await expect(repository.deleteFolder('fl_x')).resolves.toBeUndefined()
    expect(database.tables[FOLDERS_TABLE]).toEqual([])
    expect(database.tables[PRESENTATIONS_TABLE][0].folder_id).toBe('fl_et_annet_sted')
  })

  it('sletter en mappe som ikke finnes uten å klage', async () => {
    // Idempotent by contract, which is why the agent surface looks the folder up
    // first: a store that shrugs cannot answer "no such folder".
    const { repository, tables } = pinned({ [FOLDERS_TABLE]: [theirFolder()] })
    await expect(repository.deleteFolder('fl_finnes_ikke')).resolves.toBeUndefined()
    expect(tables[FOLDERS_TABLE]).toEqual([theirFolder()])
  })

  /* ---------------------------------------------------------------- *
   * The browser is unchanged
   * ---------------------------------------------------------------- */

  it('legger ikke noe eierfilter på skrivingene uten pin', async () => {
    // Without a pin there is no filter to add, and row level security is what
    // decides — exactly as before. The write shape may have changed; the
    // browser's authorization has not.
    const database = fakeDatabase({})
    const fake = createFakeSupabase({ resolve: database.resolve })
    const repository = new SupabaseSlaidsRepository(() => fake.client)

    await repository.saveFolder({ id: 'fl_1', name: 'Uten pin', createdAt: EARLIER })
    await repository.putAsset('p_1', sampleAssetWithId('a_1'), new Blob(['x']))

    for (const record of fake.queries) {
      expect(record.filters.some((filter) => filter.column === 'owner_id')).toBe(false)
    }
    // And `owner_id` still comes from the session, never from a caller.
    const inserted = fake.queries.filter((record) => record.op === 'insert')
    expect(inserted).toHaveLength(2)
    for (const record of inserted) {
      expect((record.values as { owner_id?: string }).owner_id).toBe(TEST_OWNER_ID)
    }
  })
})

function sampleAssetWithId(id: string): AssetRef {
  return { ...sampleAsset(), id }
}
