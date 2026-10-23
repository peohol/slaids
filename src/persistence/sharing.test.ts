/**
 * Sharing, at the repository level.
 *
 * The invariants under test are the ones that decide whether a revoked link
 * stays revoked, whether the audience sees what the owner saved, and whether
 * publishing can disturb the editor's concurrency protection.
 */

import { describe, expect, it } from 'vitest'
import { createUntitledCard } from '../domain/content'
import { createLeaf } from '../domain/layout'
import { createPresentation } from '../domain/presentation'
import { buildSharedSnapshot } from '../domain/sharing'
import { imageNode } from '../domain/richdoc'
import { newAssetId, newSandboxId } from '../domain/ids'
import type { AssetRef, Presentation } from '../domain/types'
import { RepositoryConflictError, RepositoryError } from './repository'
import { FOLDERS_TABLE, PRESENTATIONS_TABLE, SupabaseSlaidsRepository } from './supabaseRepository'
import {
  createFakeSupabase,
  type FakeSupabaseOptions,
  type QueryRecord,
} from './supabaseTestClient'
import { contentAt, sectionAt } from '../domain/testDecks'

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function repositoryFor(options: FakeSupabaseOptions) {
  const fake = createFakeSupabase(options)
  return { repository: new SupabaseSlaidsRepository(() => fake.client), fake }
}

function filterValue(record: QueryRecord, column: string): unknown {
  return record.filters.find((filter) => filter.column === column)?.value
}

function values(record: QueryRecord | undefined): Record<string, unknown> {
  return (record?.values ?? {}) as Record<string, unknown>
}

const SANDBOX_ASSET = newAssetId()

function asset(id: string): AssetRef {
  return {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 8,
    width: 2,
    height: 2,
    isVector: false,
  }
}

/** A presentation whose sandbox holds something that must never be published. */
function presentationWithSecrets(): Presentation {
  const base = createPresentation({ title: 'Med hemmeligheter' })
  return {
    ...base,
    folderId: 'fl_intern',
    sandbox: [
      {
        id: newSandboxId(),
        content: (() => {
          const card = createUntitledCard()
          return {
            ...card,
            body: {
              ...card.body,
              subfields: [
                {
                  ...card.body.subfields[0],
                  doc: {
                    type: 'doc' as const,
                    content: [{ type: 'paragraph', content: [imageNode(SANDBOX_ASSET)] }],
                  },
                },
              ],
            },
          }
        })(),
        createdAt: '2026-09-01T09:00:00.000Z',
        note: 'Ikke ferdig',
      },
    ],
    ideas: [{ id: 'i1', kind: 'idea', text: 'Intern note' }],
    assets: [asset(SANDBOX_ASSET)],
    slides: [sectionAt(base, 0),{ ...contentAt(base, 1), root: createLeaf(createUntitledCard()) }],
  }
}

describe('deling – lesing av status', () => {
  it('leser status fra raden', async () => {
    const { repository, fake } = repositoryFor({
      resolve: () => ({ data: { is_shared: true, share_token: 'aaaaaaaa-1111-4222-8333-444455556666' } }),
    })

    const state = await repository.readShareState('p1')

    expect(state).toEqual({ shared: true, token: 'aaaaaaaa-1111-4222-8333-444455556666' })
    expect(fake.queries[0]?.table).toBe(PRESENTATIONS_TABLE)
    // Den private kopien hentes ikke for å svare på et spørsmål om status.
    expect(fake.queries[0]?.columns).not.toContain('document')
  })

  it('gir aldri ut et token for en presentasjon som ikke er delt', async () => {
    const { repository } = repositoryFor({
      resolve: () => ({ data: { is_shared: false, share_token: 'bbbbbbbb-1111-4222-8333-444455556666' } }),
    })
    expect(await repository.readShareState('p1')).toEqual({ shared: false, token: null })
  })

  it('sier fra når raden ikke finnes', async () => {
    const { repository } = repositoryFor({ resolve: () => ({ data: null }) })
    await expect(repository.readShareState('borte')).rejects.toBeInstanceOf(RepositoryError)
  })

  it('lar en Supabase-feil boble opp i stedet for å bli en lokal antakelse', async () => {
    const { repository } = repositoryFor({
      resolve: () => ({ error: { message: 'nettverket er nede' } }),
    })
    await expect(repository.readShareState('p1')).rejects.toThrow(/nettverket er nede/)
  })
})

describe('deling – aktivering', () => {
  it('setter is_shared, et nytt token og snapshotet i én skriving', async () => {
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'update'
          ? { data: [{ is_shared: true, share_token: values(record).share_token }] }
          : { data: null },
    })

    const snapshot = buildSharedSnapshot(presentation)
    const state = await repository.enableSharing(presentation.id, snapshot)

    const update = fake.queries.at(-1)
    expect(update?.op).toBe('update')
    const written = values(update)
    expect(written.is_shared).toBe(true)
    expect(written.shared_document).toEqual(snapshot)
    expect(String(written.share_token)).toMatch(TOKEN_PATTERN)
    expect(state).toEqual({ shared: true, token: written.share_token })

    // Ingenting privat blir med ut.
    const published = JSON.stringify(written.shared_document)
    expect(published).not.toContain('Ikke ferdig')
    expect(published).not.toContain('Intern note')
    expect(published).not.toContain('fl_intern')
    expect(published).not.toContain(SANDBOX_ASSET)
  })

  it('rører ikke dokumentversjonen – ingen kolonner fra dokumentet skrives', async () => {
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'update'
          ? { data: [{ is_shared: true, share_token: values(record).share_token }] }
          : { data: null },
    })

    await repository.enableSharing(presentation.id, buildSharedSnapshot(presentation))

    const update = fake.queries.at(-1) as QueryRecord
    // Triggeren bumper bare version når en av disse endres; publisering rører
    // ingen av dem, og kan derfor ikke gjøre editorens versjon utdatert.
    for (const column of ['document', 'title', 'folder_id', 'slide_count']) {
      expect(Object.keys(values(update))).not.toContain(column)
    }
    // Versjonen *leses* riktignok — se testen under — men bare som vakt.
    // Skrivingen legger ingenting inn i den.
    expect(Object.keys(values(update))).not.toContain('version')
  })

  it('gir et nytt token ved hver aktivering, så en tilbakekalt lenke aldri gjenoppstår', async () => {
    const presentation = presentationWithSecrets()
    const seen: unknown[] = []
    const { repository } = repositoryFor({
      resolve: (record) => {
        if (record.op !== 'update') return { data: null }
        const token = values(record).share_token
        seen.push(token)
        return { data: [{ is_shared: values(record).is_shared === true, share_token: token }] }
      },
    })

    const snapshot = buildSharedSnapshot(presentation)
    const first = await repository.enableSharing(presentation.id, snapshot)
    await repository.disableSharing(presentation.id)
    const second = await repository.enableSharing(presentation.id, snapshot)

    expect(first.token).not.toBe(second.token)
    // Også avslåingen roterte: tokenet som var i omløp er dødt fra da av.
    expect(new Set(seen).size).toBe(3)
  })

  it('sier fra når raden ikke finnes i stedet for å påstå at den er delt', async () => {
    const presentation = presentationWithSecrets()
    const { repository } = repositoryFor({
      // Ingen rad matchet, og oppfølgingslesingen finner heller ingen.
      resolve: (record) => (record.op === 'update' ? { data: [] } : { data: null }),
    })
    await expect(
      repository.enableSharing(presentation.id, buildSharedSnapshot(presentation)),
    ).rejects.toBeInstanceOf(RepositoryError)
  })

  it('publiserer bare mot versjonen snapshotet faktisk avbilder', async () => {
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 7, is_shared: false } }
          : { data: [{ is_shared: true, share_token: values(record).share_token }] },
    })

    await repository.loadPresentation(presentation.id)
    await repository.enableSharing(presentation.id, buildSharedSnapshot(presentation))

    expect(filterValue(fake.queries.at(-1) as QueryRecord, 'version')).toBe(7)
  })

  it('publiserer ikke et snapshot over et dokument som er endret et annet sted', async () => {
    // Kappløpet: en annen fane lagret mellom flush og delingsskrivingen. Da er
    // snapshotet et bilde av en versjon som ikke lenger er lagret, og å
    // publisere det ville gitt publikum en eldre presentasjon enn eieren har –
    // og latt den bli stående slik til noen tilfeldigvis lagrer igjen.
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) => {
        if (record.op === 'update') return { data: [] }
        // Raden finnes fortsatt; det er versjonen som har flyttet seg.
        return record.columns === 'id'
          ? { data: { id: presentation.id } }
          : { data: { document: presentation, version: 7, is_shared: false } }
      },
    })

    await repository.loadPresentation(presentation.id)
    await expect(
      repository.enableSharing(presentation.id, buildSharedSnapshot(presentation)),
    ).rejects.toBeInstanceOf(RepositoryConflictError)

    // Og ingenting ble delt: den eneste skrivingen matchet ingen rad.
    expect(fake.queries.filter((query) => query.op === 'update')).toHaveLength(1)
  })
})

describe('deling – avslåing', () => {
  it('nuller snapshotet og roterer tokenet i samme skriving', async () => {
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'update'
          ? { data: [{ is_shared: false, share_token: values(record).share_token }] }
          : { data: null },
    })

    const state = await repository.disableSharing('p1')

    const written = values(fake.queries.at(-1))
    expect(written.is_shared).toBe(false)
    expect(written.shared_document).toBeNull()
    expect(String(written.share_token)).toMatch(TOKEN_PATTERN)
    expect(state).toEqual({ shared: false, token: null })
  })
})

describe('deling – lagring holder den delte kopien oppdatert', () => {
  it('oppdaterer document og shared_document i samme save', async () => {
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 3, is_published: true } }
          : { data: [{ version: 4, is_published: true }] },
    })

    await repository.loadPresentation(presentation.id)
    await repository.savePresentation({ ...presentation, title: 'Endret' })

    const update = fake.queries.at(-1) as QueryRecord
    expect(update.op).toBe('update')
    const written = values(update)
    expect((written.document as Presentation).title).toBe('Endret')
    expect((written.shared_document as { title: string }).title).toBe('Endret')
    // Den vanlige samtidighetsbeskyttelsen står: dette *er* en dokumentendring.
    expect(filterValue(update, 'version')).toBe(3)
  })

  it('sender ingen delt kopi for en presentasjon som ikke er delt', async () => {
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 3, is_published: false } }
          : { data: [{ version: 4, is_published: false }] },
    })

    await repository.loadPresentation(presentation.id)
    await repository.savePresentation(presentation)

    expect(Object.keys(values(fake.queries.at(-1)))).not.toContain('shared_document')
  })

  it('publiserer i etterkant når delingen ble slått på et annet sted', async () => {
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? // Da vi leste var den ikke delt …
            { data: { document: presentation, version: 3, is_published: false } }
          : // … men raden er delt nå.
            { data: [{ version: 4, is_published: true }] },
    })

    await repository.loadPresentation(presentation.id)
    await repository.savePresentation(presentation)

    const writes = fake.queries.filter((query) => query.op === 'update')
    expect(writes).toHaveLength(2)
    const followUp = writes[1]
    // Bare den delte kopien skrives — dokumentet er allerede lagret …
    expect(Object.keys(values(followUp))).toEqual(['shared_document'])
    // … mot den versjonen snapshotet avbilder, og bare på en rad som er publisert.
    expect(filterValue(followUp, 'version')).toBe(4)
    expect(filterValue(followUp, 'is_published')).toBe(true)
  })

  it('behandler en helt ny presentasjon som udelt', async () => {
    const presentation = createPresentation({ title: 'Ny' })
    const { repository, fake } = repositoryFor({ resolve: () => ({ data: { version: 1 } }) })

    await repository.savePresentation(presentation)
    expect(Object.keys(values(fake.queries.at(-1)))).not.toContain('shared_document')

    // Og den neste lagringen arver heller ikke deling fra noe sted.
    await repository.savePresentation({ ...presentation, title: 'Ny igjen' })
    expect(Object.keys(values(fake.queries.at(-1)))).not.toContain('shared_document')
  })
})

describe('deling av mapper', () => {
  const FOLDER = 'fl_kurs'

  it('publiserer en ny presentasjon som opprettes i en delt mappe med en gang', async () => {
    // Laget eller duplisert rett inn i en delt mappe: lenken skal vise den fra start.
    const presentation = { ...presentationWithSecrets(), folderId: FOLDER }
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'insert'
          ? { data: { version: 1, is_published: true } }
          : { data: [{ version: 2, is_published: true }] },
    })

    await repository.savePresentation(presentation)

    const publish = fake.queries.find((query) => query.op === 'update')
    expect(publish).toBeDefined()
    expect(Object.keys(values(publish))).toEqual(['shared_document'])
    expect(filterValue(publish!, 'version')).toBe(1)
    expect(filterValue(publish!, 'is_published')).toBe(true)

    // Den neste lagringen bærer kopien selv, uten en ekstra skriving.
    await repository.savePresentation({ ...presentation, title: 'Endret' })
    expect(Object.keys(values(fake.queries.at(-1)))).toContain('shared_document')
  })

  it('lagrer en presentasjon som bare er publisert gjennom mappen med en fersk kopi', async () => {
    // Ikke delt alene, men i en delt mappe: lagringen må holde kopien oppdatert.
    const presentation = { ...presentationWithSecrets(), folderId: FOLDER }
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 3, is_shared: false, is_published: true } }
          : { data: [{ version: 4, is_published: true }] },
    })

    await repository.loadPresentation(presentation.id)
    await repository.savePresentation({ ...presentation, title: 'Endret' })

    const writes = fake.queries.filter((query) => query.op === 'update')
    // Én skriving: dokumentet og kopien sammen, ingen etterslengt publisering.
    expect(writes).toHaveLength(1)
    expect((values(writes[0]).shared_document as { title: string }).title).toBe('Endret')
  })

  it('holder kopien oppdatert når presentasjonens egen deling slås av i en delt mappe', async () => {
    const presentation = { ...presentationWithSecrets(), folderId: FOLDER }
    const { repository, fake } = repositoryFor({
      resolve: (record) => {
        if (record.op === 'select') {
          return { data: { document: presentation, version: 3, is_shared: true, is_published: true } }
        }
        if (values(record).is_shared === false) {
          // Mappen publiserer den fortsatt.
          return { data: [{ is_shared: false, share_token: values(record).share_token, is_published: true }] }
        }
        return { data: [{ version: 4, is_published: true }] }
      },
    })

    await repository.loadPresentation(presentation.id)
    expect(await repository.disableSharing(presentation.id)).toEqual({ shared: false, token: null })
    await repository.savePresentation({ ...presentation, title: 'Fortsatt i mappen' })

    const save = fake.queries.at(-1) as QueryRecord
    expect((values(save).shared_document as { title: string }).title).toBe('Fortsatt i mappen')
  })

  it('publiserer i etterkant når presentasjonen ble lagt i en delt mappe', async () => {
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'select'
          ? { data: { document: presentation, version: 3, is_published: false } }
          : // Flyttet inn i en delt mappe av akkurat denne lagringen.
            { data: [{ version: 4, is_published: true }] },
    })

    await repository.loadPresentation(presentation.id)
    await repository.savePresentation({ ...presentation, folderId: FOLDER })

    const writes = fake.queries.filter((query) => query.op === 'update')
    expect(writes).toHaveLength(2)
    expect(Object.keys(values(writes[1]))).toEqual(['shared_document'])
    const snapshot = values(writes[1]).shared_document as Record<string, unknown>
    // Den saniterte kopien, aldri arbeidskopien.
    expect(snapshot.folderId).toBeUndefined()
    expect(snapshot.sandbox).toBeUndefined()
    expect(filterValue(writes[1], 'version')).toBe(4)
    expect(filterValue(writes[1], 'is_published')).toBe(true)
  })

  it('lister bare delte mapper, med token', async () => {
    const token = 'cccccccc-1111-4222-8333-444455556666'
    const { repository, fake } = repositoryFor({
      resolve: () => ({ data: [{ id: FOLDER, is_shared: true, share_token: token }] }),
    })

    expect(await repository.listFolderShareStates()).toEqual({ [FOLDER]: { shared: true, token } })
    expect(fake.queries[0].table).toBe(FOLDERS_TABLE)
    expect(filterValue(fake.queries[0], 'is_shared')).toBe(true)
  })

  it('slår på mappen med et nytt token og publiserer hver presentasjon i den før lenken gis ut', async () => {
    const first = presentationWithSecrets()
    const second = { ...createPresentation({ title: 'Andre' }), folderId: FOLDER }
    const documents: Record<string, { document: Presentation; version: number }> = {
      [first.id]: { document: { ...first, folderId: FOLDER }, version: 5 },
      [second.id]: { document: second, version: 2 },
    }
    const { repository, fake } = repositoryFor({
      resolve: (record) => {
        if (record.table === FOLDERS_TABLE) {
          return { data: [{ is_shared: values(record).is_shared, share_token: values(record).share_token }] }
        }
        if (record.op === 'select' && record.columns === 'id') {
          return { data: Object.keys(documents).map((id) => ({ id })) }
        }
        if (record.op === 'select') return { data: documents[filterValue(record, 'id') as string] }
        return { data: null }
      },
    })

    const state = await repository.enableFolderSharing(FOLDER)

    const folderWrite = fake.queries[0]
    expect(folderWrite.table).toBe(FOLDERS_TABLE)
    expect(folderWrite.op).toBe('update')
    expect(values(folderWrite).is_shared).toBe(true)
    expect(String(values(folderWrite).share_token)).toMatch(TOKEN_PATTERN)
    expect(state).toEqual({ shared: true, token: values(folderWrite).share_token })

    const publishes = fake.queries.filter(
      (query) => query.table === PRESENTATIONS_TABLE && query.op === 'update',
    )
    expect(publishes.map((query) => filterValue(query, 'id'))).toEqual([first.id, second.id])
    for (const publish of publishes) {
      // Bare kopien, mot versjonen den ble skåret fra, og bare på en publisert rad.
      expect(Object.keys(values(publish))).toEqual(['shared_document'])
      expect(filterValue(publish, 'is_published')).toBe(true)
      const snapshot = values(publish).shared_document as Record<string, unknown>
      expect(snapshot.sandbox).toBeUndefined()
      expect(snapshot.ideas).toBeUndefined()
      expect(snapshot.folderId).toBeUndefined()
    }
    expect(filterValue(publishes[0], 'version')).toBe(5)
    expect(filterValue(publishes[1], 'version')).toBe(2)
    // Hele mappen, også det som ligger i søppelkassen, så en gjenoppretting
    // kommer tilbake publisert.
    const listing = fake.queries.find((query) => query.columns === 'id')
    expect(listing?.filters.map((filter) => filter.column)).toEqual(['folder_id'])
  })

  it('slår mappen av igjen, med nytt token, når en presentasjon ikke kan publiseres', async () => {
    const presentation = presentationWithSecrets()
    const { repository, fake } = repositoryFor({
      resolve: (record) => {
        if (record.table === FOLDERS_TABLE) {
          return { data: [{ is_shared: values(record).is_shared, share_token: values(record).share_token }] }
        }
        if (record.op === 'select' && record.columns === 'id') return { data: [{ id: presentation.id }] }
        if (record.op === 'select') return { data: { document: presentation, version: 1 } }
        return { error: { message: 'nede' } }
      },
    })

    await expect(repository.enableFolderSharing(FOLDER)).rejects.toBeInstanceOf(RepositoryError)

    const folderWrites = fake.queries.filter((query) => query.table === FOLDERS_TABLE)
    expect(folderWrites.map((query) => values(query).is_shared)).toEqual([true, false])
    expect(values(folderWrites[1]).share_token).not.toBe(values(folderWrites[0]).share_token)
  })

  it('slår av med et nytt token, og overlater kopiene til databasen', async () => {
    const { repository, fake } = repositoryFor({
      resolve: (record) => ({
        data: [{ is_shared: values(record).is_shared, share_token: values(record).share_token }],
      }),
    })

    expect(await repository.disableFolderSharing(FOLDER)).toEqual({ shared: false, token: null })
    expect(fake.queries).toHaveLength(1)
    expect(fake.queries[0].table).toBe(FOLDERS_TABLE)
    expect(values(fake.queries[0]).is_shared).toBe(false)
    expect(String(values(fake.queries[0]).share_token)).toMatch(TOKEN_PATTERN)
  })

  it('gir en delt mappe nytt navn uten å røre delingen', async () => {
    // The link reads the name from the row, so a rename only has to write the
    // name. Writing the share columns here would be a way to turn a link off, or
    // to rotate its token, by renaming the folder.
    const { repository, fake } = repositoryFor({
      resolve: (record) =>
        record.op === 'insert'
          ? { error: { message: 'duplicate key value', code: '23505' } }
          : { data: [{ id: FOLDER }] },
    })

    await repository.saveFolder({ id: FOLDER, name: 'Nytt navn', createdAt: '2026-10-01T08:00:00.000Z' })

    const update = fake.queries.find((query) => query.op === 'update')
    expect(update?.table).toBe(FOLDERS_TABLE)
    expect(filterValue(update as QueryRecord, 'id')).toBe(FOLDER)
    expect(values(update).name).toBe('Nytt navn')
    expect(Object.keys(values(update))).not.toContain('is_shared')
    expect(Object.keys(values(update))).not.toContain('share_token')
  })

  it('sier fra når mappen ikke finnes', async () => {
    const { repository } = repositoryFor({ resolve: () => ({ data: [] }) })
    await expect(repository.disableFolderSharing(FOLDER)).rejects.toThrow(/Fant ikke mappen/)
    await expect(repository.enableFolderSharing(FOLDER)).rejects.toThrow(/Fant ikke mappen/)
  })
})
