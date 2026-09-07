/**
 * The library's shared rules, and the proof that they are shared.
 *
 * `createFolder` is here because two callers need the same answer to "what is a
 * new folder?" — the sidebar's dialog and the agent's `create_folder` — and the
 * way that goes wrong is not that one of them breaks. It is that one of them
 * quietly starts accepting a name the other refuses. So this file checks the
 * rule itself against a real store, and then checks mechanically that there is
 * only one place a folder can be minted at all.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlaidsDatabase } from './db'
import { DexieSlaidsRepository } from './dexieRepository'
import { RepositoryError } from './repository'
import { createPresentation } from '../domain/presentation'
import {
  FOLDER_NAME_MAX_LENGTH,
  TRASH_RETENTION_DAYS,
  createFolder,
  emptyTrash,
  isTrashExpired,
  purgeExpiredTrash,
  trashExpiry,
} from './library'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshRepository(): DexieSlaidsRepository {
  counter += 1
  const database = new SlaidsDatabase(`slaids-library-${counter}`)
  databases.push(database)
  return new DexieSlaidsRepository(database)
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

describe('createFolder', () => {
  it('lager en mappe med id, trimmet navn og et tidspunkt, og lagrer den', async () => {
    const repository = freshRepository()

    const created = await createFolder(repository, '  Kundemøter  ')
    if (!created.ok) throw new Error(`forventet en mappe, fikk ${created.error.code}`)

    expect(created.value.name).toBe('Kundemøter')
    expect(created.value.id).toMatch(/^fl_/)
    expect(Date.parse(created.value.createdAt)).not.toBeNaN()
    // The store, not the return value: this function's job is that the folder
    // is in the library afterwards.
    expect(await repository.listFolders()).toEqual([created.value])
  })

  it('avviser et navn som ikke er et navn, uten å skrive noe', async () => {
    const repository = freshRepository()

    for (const name of ['', '   ', '\t\n']) {
      const refused = await createFolder(repository, name)
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.error.code).toBe('INVALID_ARGUMENT')
    }
    // A folder shown by its name alone cannot be called nothing: the row would
    // be indistinguishable from every other, and the only way out is to delete
    // it. So the refusal comes before the write, not as a repair afterwards.
    expect(await repository.listFolders()).toEqual([])
  })

  it('avviser et navn som er for langt, og godtar det lengste som er lov', async () => {
    // The bound lives here rather than in the agent's schema alone. One door
    // enforcing it and the other not is exactly the drift this function exists
    // to prevent: the editor would store a name the agent refuses.
    const repository = freshRepository()

    const longest = 'a'.repeat(FOLDER_NAME_MAX_LENGTH)
    const accepted = await createFolder(repository, longest)
    expect(accepted.ok).toBe(true)

    // Measured after trimming, so surrounding space is not what pushes it over.
    const refused = await createFolder(repository, `  ${'a'.repeat(FOLDER_NAME_MAX_LENGTH + 1)}  `)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('INVALID_ARGUMENT')

    const padded = await createFolder(repository, `  ${longest}  `)
    expect(padded.ok).toBe(true)

    expect(await repository.listFolders()).toHaveLength(2)
  })

  it('gir hver mappe sin egen id, også når to har samme navn', async () => {
    const repository = freshRepository()
    const first = await createFolder(repository, 'Arkiv')
    const second = await createFolder(repository, 'Arkiv')
    if (!first.ok || !second.ok) throw new Error('forventet to mapper')

    expect(second.value.id).not.toBe(first.value.id)
    expect(await repository.listFolders()).toHaveLength(2)
  })

  it('lar en lagringsfeil være en lagringsfeil, ikke en tom mappe', async () => {
    // A store that refused the row throws, the same as `duplicatePresentation`:
    // the typed `Result` is for a name that is not a name, and conflating the
    // two would have a caller report "bad name" for a database that is down.
    const repository = freshRepository()
    const failing = Object.assign(Object.create(repository) as DexieSlaidsRepository, {
      saveFolder: () => Promise.reject(new RepositoryError('Basen svarer ikke.')),
    })

    await expect(createFolder(failing, 'Kundemøter')).rejects.toBeInstanceOf(RepositoryError)
    expect(await repository.listFolders()).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * The trash
 * ------------------------------------------------------------------ */

/** Trash a presentation as if at this moment. Only the clock is faked. */
async function trashedAt(repository: DexieSlaidsRepository, id: string, at: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(new Date(at))
    await repository.trashPresentation(id)
  } finally {
    vi.useRealTimers()
  }
}

describe('søppelkassen', () => {
  it('regner utløpet fra kastetidspunktet', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30)
    expect(trashExpiry('2026-09-07T10:00:00.000Z').toISOString()).toBe('2026-10-07T10:00:00.000Z')
    expect(isTrashExpired('2026-09-07T10:00:00.000Z', new Date('2026-10-07T09:59:59.999Z'))).toBe(
      false,
    )
    expect(isTrashExpired('2026-09-07T10:00:00.000Z', new Date('2026-10-07T10:00:00.000Z'))).toBe(
      true,
    )
    // A trash entry nobody can date has been there long enough.
    expect(isTrashExpired('ikke en dato', new Date())).toBe(true)
  })

  it('tømmer det som har ligget der lenge nok, og lar resten ligge', async () => {
    const repository = freshRepository()
    const old = createPresentation({ title: 'Gammel' })
    const fresh = createPresentation({ title: 'Ny' })
    const kept = createPresentation({ title: 'I biblioteket' })
    for (const presentation of [old, fresh, kept]) await repository.savePresentation(presentation)
    await trashedAt(repository, old.id, '2026-08-01T12:00:00.000Z')
    await trashedAt(repository, fresh.id, '2026-08-20T12:00:00.000Z')

    // The moment before the old one expires, nothing goes.
    expect(await purgeExpiredTrash(repository, new Date('2026-08-31T11:59:59.999Z'))).toBe(0)
    expect(await repository.listTrashedPresentations()).toHaveLength(2)

    expect(await purgeExpiredTrash(repository, new Date('2026-08-31T12:00:00.000Z'))).toBe(1)

    expect((await repository.listTrashedPresentations()).map((summary) => summary.id)).toEqual([
      fresh.id,
    ])
    await expect(repository.loadPresentation(old.id)).rejects.toThrow(/Fant ikke/)
    // The library is not the trash's business.
    expect((await repository.listPresentations()).map((summary) => summary.id)).toEqual([kept.id])
  })

  it('tømmes helt på forespørsel, uansett alder', async () => {
    const repository = freshRepository()
    const first = createPresentation({ title: 'Første' })
    const second = createPresentation({ title: 'Andre' })
    const kept = createPresentation({ title: 'I biblioteket' })
    for (const presentation of [first, second, kept]) await repository.savePresentation(presentation)
    await repository.trashPresentation(first.id)
    await repository.trashPresentation(second.id)

    expect(await emptyTrash(repository)).toBe(2)

    expect(await repository.listTrashedPresentations()).toEqual([])
    await expect(repository.loadPresentation(first.id)).rejects.toThrow(/Fant ikke/)
    await expect(repository.loadPresentation(second.id)).rejects.toThrow(/Fant ikke/)
    expect((await repository.listPresentations()).map((summary) => summary.id)).toEqual([kept.id])
    // An empty trash empties to nothing.
    expect(await emptyTrash(repository)).toBe(0)
  })

  it('sletter aldri en presentasjon som ble gjenopprettet etter at søppelkassen ble listet', async () => {
    // The race: the sweep reads the trash, and before it gets to an entry
    // another tab restores that deck. The listing was true when it was taken
    // and is not any more, and the deck must survive — automatically and by
    // hand alike, since both go through the same purge.
    const repository = freshRepository()
    const restored = createPresentation({ title: 'Gjenopprettet i mellomtiden' })
    const expired = createPresentation({ title: 'Virkelig utløpt' })
    await repository.savePresentation(restored)
    await repository.savePresentation(expired)
    await trashedAt(repository, restored.id, '2026-08-01T12:00:00.000Z')
    await trashedAt(repository, expired.id, '2026-08-02T12:00:00.000Z')

    const racing = Object.assign(Object.create(repository) as DexieSlaidsRepository, {
      listTrashedPresentations: async () => {
        const listed = await repository.listTrashedPresentations()
        await repository.restorePresentation(restored.id)
        return listed
      },
    })

    expect(await purgeExpiredTrash(racing, new Date('2026-09-15T12:00:00.000Z'))).toBe(1)
    expect((await repository.listPresentations()).map((summary) => summary.id)).toEqual([
      restored.id,
    ])
    expect(await repository.listTrashedPresentations()).toEqual([])

    await repository.trashPresentation(restored.id)
    expect(await emptyTrash(racing)).toBe(0)
    expect((await repository.listPresentations()).map((summary) => summary.id)).toEqual([
      restored.id,
    ])
  })

  it('stopper ved en lagringsfeil, uten å late som resten er tømt', async () => {
    // What was purged stays purged, what was not is still in the trash, and the
    // caller hears about it: a sweep that swallowed the error would report a
    // trash that is empty while it is not.
    const repository = freshRepository()
    const first = createPresentation({ title: 'Første' })
    const second = createPresentation({ title: 'Andre' })
    await repository.savePresentation(first)
    await repository.savePresentation(second)
    await trashedAt(repository, first.id, '2026-08-01T12:00:00.000Z')
    await trashedAt(repository, second.id, '2026-08-02T12:00:00.000Z')

    const failing = Object.assign(Object.create(repository) as DexieSlaidsRepository, {
      purgePresentation: (id: string, deletedAt: string) =>
        id === first.id
          ? Promise.reject(new RepositoryError('Basen svarer ikke.'))
          : repository.purgePresentation(id, deletedAt),
    })

    // Newest first, so the second is purged before the first is refused.
    await expect(emptyTrash(failing)).rejects.toBeInstanceOf(RepositoryError)
    expect((await repository.listTrashedPresentations()).map((summary) => summary.id)).toEqual([
      first.id,
    ])
  })
})

/* ------------------------------------------------------------------ *
 * One place a folder comes from
 * ------------------------------------------------------------------ */

const ROOT = join(process.cwd(), 'src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return []
    return /\.test\.tsx?$/.test(entry.name) ? [] : [full]
  })
}

describe('mappen har én opprinnelse', () => {
  it('mintes fra nøyaktig ett sted i hele appen', () => {
    /*
     * `newFolderId` has one caller, and that is what makes "the folder an agent
     * makes is the folder the sidebar makes" a property of the code rather than
     * two functions written to match. A second caller would be free to answer
     * the same question differently — to keep the untrimmed name, to skip the
     * timestamp, to accept `"   "` — and neither of them would fail.
     *
     * The import clause, not the word, so naming it in a comment does not count.
     */
    const imported = /import\s*\{[^}]*\bnewFolderId\b[^}]*\}\s*from/
    const callers = sourceFiles(ROOT)
      .filter((file) => imported.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file))

    expect(callers).toEqual([join('src', 'persistence', 'library.ts')])
  })
})
