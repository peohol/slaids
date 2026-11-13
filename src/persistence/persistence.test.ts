import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlaidsDatabase } from './db'
import { DexieSlaidsRepository } from './dexieRepository'
import {
  RepositoryConflictError,
  RepositoryError,
  RepositoryNotFoundError,
  type SlaidsRepository,
} from './repository'
import { exportSlaidsArchive, importSlaidsArchive, suggestedFileName } from './backup'
import {
  createInteractiveSlide,
  createPresentation,
  documentByteSize,
  presentationByteSize,
} from '../domain/presentation'
import { presentationRevision } from '../domain/revision'
import { DEFAULT_AUTOCORRECT_RULES } from '../domain/autocorrect'
import { MAX_INTERACTIVE_HTML_BYTES, MAX_INTERACTIVE_HTML_TOTAL_BYTES } from '../domain/constants'
import { CURRENT_SCHEMA_VERSION } from '../domain/schema'
import { createLeaf, createSplit, stripContent } from '../domain/layout'
import { containerWithDoc, createImage, createUntitledCard } from '../domain/content'
import { registerAsset, setThemeLogo, unknownAssetIds, usedAssetIds } from '../domain/commands'
import { themeTemplateContent } from '../domain/themeTemplate'
import { newAssetId, newTemplateId } from '../domain/ids'
import { decodeBase64, realImageBase64 } from '../domain/testImages'
import { bytesToBlob } from './blob'
import { unzipSync, zipSync } from 'fflate'
import type { AssetRef, LayoutTemplate, Presentation } from '../domain/types'
import { contentAt, htmlOfBytes, interactiveAt, sectionAt } from '../domain/testDecks'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshDatabase(): SlaidsDatabase {
  counter += 1
  const database = new SlaidsDatabase(`slaids-test-${counter}`)
  databases.push(database)
  return database
}

function freshRepository(): DexieSlaidsRepository {
  return new DexieSlaidsRepository(freshDatabase())
}

afterEach(async () => {
  while (databases.length > 0) {
    const database = databases.pop()
    await database?.delete()
  }
})

function samplePresentation(): Presentation {
  const presentation = createPresentation({ title: 'Lagringstest' })
  return {
    ...presentation,
    slides: [
      sectionAt(presentation, 0),
      {
        ...contentAt(presentation, 1),
        root: createSplit('x', [2, 3], [createLeaf(createUntitledCard()), createLeaf()]),
      },
    ],
  }
}

const assetRef: AssetRef = {
  id: 'asset-1',
  name: 'figur.svg',
  mimeType: 'image/svg+xml',
  byteSize: 42,
  width: 100,
  height: 80,
  isVector: true,
}

/**
 * A real figure, because import is a door into the asset store.
 *
 * `.slaids` files come from outside Slaids, so their files go through
 * `domain/assetIngress.ts` on the way back in — the same door the editor's
 * upload dialog and `upload_asset` stand behind. A stand-in like `<svg />`
 * would be refused there for having no intrinsic size, which is a property of
 * the fixture rather than of the thing under test.
 */
function svgFixture(id: string): Blob {
  return new Blob([svgMarkup(id)], { type: 'image/svg+xml' })
}

function svgMarkup(id: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect id="${id}" width="100" height="80"/></svg>`
}

interface RemoteQuirks {
  /** Ids owned by an account this user cannot see, as RLS would hide them. */
  invisibleIds?: string[]
  /** Template ids owned by an account this user cannot see. */
  invisibleTemplateIds?: string[]
  /** Make every asset write fail, as a full bucket or a dropped link would. */
  failAssets?: boolean
  /** Make every template write fail with something that is not a clash. */
  failTemplates?: boolean
}

/**
 * A repository that behaves the way the Supabase one has to.
 *
 * Three things separate it from Dexie: a row may only reference a parent that
 * exists (the foreign keys on folder and presentation), and an id taken by
 * another account comes back as a conflict rather than as a row this user could
 * have seen beforehand.
 */
function withRemoteQuirks(inner: DexieSlaidsRepository, quirks: RemoteQuirks = {}): SlaidsRepository {
  const invisible = new Set(quirks.invisibleIds ?? [])
  const invisibleTemplates = new Set(quirks.invisibleTemplateIds ?? [])
  return {
    listPresentations: () => inner.listPresentations(),
    listTrashedPresentations: () => inner.listTrashedPresentations(),
    loadPresentation: (id) => inner.loadPresentation(id),
    savePresentation: async (presentation) => {
      if (invisible.has(presentation.id)) {
        throw new RepositoryConflictError(`«${presentation.title}» finnes allerede.`)
      }
      if (presentation.folderId) {
        const folders = await inner.listFolders()
        if (!folders.some((folder) => folder.id === presentation.folderId)) {
          throw new RepositoryError(`Ingen mappe «${presentation.folderId}» å legge den i.`)
        }
      }
      await inner.savePresentation(presentation)
    },
    deletePresentation: (id) => inner.deletePresentation(id),
    trashPresentation: (id, guard) => inner.trashPresentation(id, guard),
    restorePresentation: (id) => inner.restorePresentation(id),
    purgePresentation: (id, deletedAt) => inner.purgePresentation(id, deletedAt),
    listFolders: () => inner.listFolders(),
    saveFolder: (folder) => inner.saveFolder(folder),
    renameFolder: (id, name) => inner.renameFolder(id, name),
    deleteFolder: (id) => inner.deleteFolder(id),
    listTemplates: () => inner.listTemplates(),
    saveTemplate: async (template) => {
      if (quirks.failTemplates) throw new RepositoryError('Malen ble avvist.')
      if (invisibleTemplates.has(template.id)) {
        throw new RepositoryConflictError(`Malen «${template.name}» har en id som er i bruk.`)
      }
      await inner.saveTemplate(template)
    },
    deleteTemplate: (id) => inner.deleteTemplate(id),
    getUserSettings: (ownerId) => inner.getUserSettings(ownerId),
    updateUserSettings: (ownerId, patch) => inner.updateUserSettings(ownerId, patch),
    loadAutocorrectRules: () => inner.loadAutocorrectRules(),
    saveAutocorrectRules: (rules) => inner.saveAutocorrectRules(rules),
    putAsset: async (presentationId, ref, blob) => {
      if (quirks.failAssets) throw new RepositoryError('Filen ble avvist.')
      const owners = await inner.listPresentations()
      if (!owners.some((summary) => summary.id === presentationId)) {
        throw new RepositoryError(`Ingen presentasjon «${presentationId}» å henge filen på.`)
      }
      await inner.putAsset(presentationId, ref, blob)
    },
    getAsset: (id) => inner.getAsset(id),
    listAssets: (presentationId) => inner.listAssets(presentationId),
    existingAssetIds: (ids) => inner.existingAssetIds(ids),
    deleteAsset: (id) => inner.deleteAsset(id),
    deleteAssetsForPresentation: (id) => inner.deleteAssetsForPresentation(id),
    deleteOrphanAssets: () => inner.deleteOrphanAssets(),
  }
}

function sampleTemplate(): LayoutTemplate {
  return {
    id: newTemplateId(),
    name: 'Todelt',
    hasTitle: true,
    root: stripContent(createSplit('x', [1, 1], [createLeaf(), createLeaf()])),
    createdAt: new Date().toISOString(),
  }
}

/** A presentation whose single zone shows `assetRef`. */
function presentationWithAsset(base: Presentation): Presentation {
  return {
    ...base,
    assets: [assetRef],
    slides: [
      sectionAt(base, 0),
      {
        ...contentAt(base, 1),
        root: createLeaf(createImage(assetRef.id)),
      },
    ],
  }
}

describe('DexieSlaidsRepository', () => {
  it('keeps the autoerstatt rules: defaults until a list is saved, and an empty list as a choice', async () => {
    const database = freshDatabase()
    const repository = new DexieSlaidsRepository(database)
    expect(await repository.loadAutocorrectRules()).toEqual(DEFAULT_AUTOCORRECT_RULES)

    await repository.saveAutocorrectRules([{ from: '(c)', to: '©' }, { from: '', to: 'x' }])
    expect(await new DexieSlaidsRepository(database).loadAutocorrectRules()).toEqual([
      { from: '(c)', to: '©' },
    ])

    await repository.saveAutocorrectRules([])
    expect(await repository.loadAutocorrectRules()).toEqual([])
  })

  it('refuses a save from a reader whose copy is older than what is stored', async () => {
    // Two repositories over one database: two tabs, or two devices. Neither
    // owns the deck more than the other, and IndexedDB has no version column,
    // so each reader remembers what it last saw — the same compare-and-swap
    // the Supabase repository does with its version.
    const database = freshDatabase()
    const first = new DexieSlaidsRepository(database)
    const second = new DexieSlaidsRepository(database)
    const presentation = createPresentation({ title: 'Delt' })
    await first.savePresentation(presentation)

    const readByFirst = await first.loadPresentation(presentation.id)
    const readBySecond = await second.loadPresentation(presentation.id)

    // One editor saving over and over is what autosave does; every write moves
    // that reader's own precondition along, so it never fights itself.
    await first.savePresentation({ ...readByFirst, title: 'Første' })
    await first.savePresentation({ ...readByFirst, title: 'Andre' })
    expect((await first.loadPresentation(presentation.id)).title).toBe('Andre')

    // The other reader is holding a copy from before that, and writing it back
    // would undo the work — and, after an image optimisation, put files that
    // have been deleted back into the stored document.
    await expect(second.savePresentation({ ...readBySecond, title: 'Utdatert' })).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )
    expect((await first.loadPresentation(presentation.id)).title).toBe('Andre')

    // Reading again is all it takes.
    const reread = await second.loadPresentation(presentation.id)
    await second.savePresentation({ ...reread, title: 'Etter ny lesing' })
    expect((await first.loadPresentation(presentation.id)).title).toBe('Etter ny lesing')
  })

  it('still stores a presentation this reader has never seen', async () => {
    // Nothing to compare against is not a conflict: an import or a copy writes
    // a deck this repository never read, and that is an insert.
    const repository = freshRepository()
    const presentation = createPresentation({ title: 'Importert' })
    await repository.savePresentation(presentation)
    expect((await repository.loadPresentation(presentation.id)).title).toBe('Importert')
  })

  it('saves and loads a presentation unchanged', async () => {
    const repository = freshRepository()
    const presentation = samplePresentation()
    await repository.savePresentation(presentation)
    const loaded = await repository.loadPresentation(presentation.id)
    expect(loaded).toEqual(presentation)
  })

  it('lists presentations newest first', async () => {
    const repository = freshRepository()
    const older = { ...samplePresentation(), title: 'Eldre', updatedAt: '2020-01-01T00:00:00.000Z' }
    const newer = { ...samplePresentation(), title: 'Nyere', updatedAt: '2026-01-01T00:00:00.000Z' }
    await repository.savePresentation(older)
    await repository.savePresentation(newer)
    const summaries = await repository.listPresentations()
    expect(summaries.map((summary) => summary.title)).toEqual(['Nyere', 'Eldre'])
    // The front section counts: it is a slide like any other.
    expect(summaries[0].slideCount).toBe(2)
  })

  it('rejects loading a presentation that does not exist', async () => {
    const repository = freshRepository()
    await expect(repository.loadPresentation('missing')).rejects.toThrow(/Fant ikke/)
  })

  it('migrates a legacy record on load', async () => {
    const repository = freshRepository()
    const presentation = samplePresentation()
    // A record from before sections: no `kind`, and no front page among the
    // slides — the migration chain builds one from the deck's own title.
    const legacy = JSON.parse(JSON.stringify(presentation)) as Record<string, unknown>
    delete legacy.schemaVersion
    delete legacy.sandbox
    legacy.slides = (legacy.slides as Record<string, unknown>[])
      .slice(1)
      .map(({ kind: _kind, ...rest }) => rest)
    await repository.savePresentation(legacy as unknown as Presentation)
    const loaded = await repository.loadPresentation(presentation.id)
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(loaded.sandbox).toEqual([])
  })

  it('surfaces an unreadable record as an error', async () => {
    const repository = freshRepository()
    const presentation = samplePresentation()
    // A first slide that is not a section: the schema refuses it, and no
    // repair can invent the layout tree it would need to be one.
    await repository.savePresentation({
      ...presentation,
      slides: [{ ...presentation.slides[0], kind: 'content' }],
    } as unknown as Presentation)
    await expect(repository.loadPresentation(presentation.id)).rejects.toThrow(/ugyldig/i)
  })

  it('deletes a presentation together with its assets', async () => {
    const repository = freshRepository()
    const presentation = samplePresentation()
    await repository.savePresentation(presentation)
    await repository.putAsset(presentation.id, assetRef, new Blob(['<svg />']))
    expect(await repository.listAssets(presentation.id)).toHaveLength(1)
    await repository.deletePresentation(presentation.id)
    expect(await repository.getAsset(assetRef.id)).toBeNull()
    expect(await repository.listPresentations()).toHaveLength(0)
  })

  it('sletter mot en revisjon, og nekter når den lagrede har flyttet seg', async () => {
    // The same precondition `savePresentation` takes, and it matters more here:
    // an overwrite can be argued about afterwards, a deletion cannot.
    const repository = freshRepository()
    const presentation = samplePresentation()
    await repository.savePresentation(presentation)
    const stale = presentationRevision(presentation)
    await repository.savePresentation({ ...presentation, title: 'Skrevet av en annen' })

    await expect(
      repository.deletePresentation(presentation.id, { expectedRevision: stale }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)
    expect(await repository.listPresentations()).toHaveLength(1)

    const current = await repository.loadPresentation(presentation.id)
    await repository.deletePresentation(presentation.id, {
      expectedRevision: presentationRevision(current),
    })
    expect(await repository.listPresentations()).toHaveLength(0)
  })

  it('avviser en vaktet sletting av en rad som ikke er der, og lar en uvaktet gå', async () => {
    // The two guards differ here on purpose. A guarded delete names a document —
    // remove the one I read — and a row somebody else already removed is not it.
    // Unguarded, a delete is idempotent: that is what the duplication rollback
    // and the library's own delete rely on.
    const repository = freshRepository()
    await expect(
      repository.deletePresentation('p_finnes_ikke', { expectedRevision: 'hva-som-helst' }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)
    await expect(repository.deletePresentation('p_finnes_ikke')).resolves.toBeUndefined()
  })

  it('round-trips asset blobs', async () => {
    const repository = freshRepository()
    await repository.putAsset('p1', assetRef, svgFixture('x'))
    const stored = await repository.getAsset(assetRef.id)
    expect(stored?.ref.name).toBe('figur.svg')
    expect(await stored?.blob.text()).toContain('<svg')
  })

  it('moves presentations to the root when their folder is deleted', async () => {
    // The contract on `SlaidsRepository.deleteFolder`, and the sentence the
    // library shows the user: the folder goes, everything in it stays. Several
    // presentations, so "the folder is emptied" cannot pass by emptying one.
    const repository = freshRepository()
    await repository.saveFolder({ id: 'f1', name: 'Mappe', createdAt: '2026-01-01T00:00:00.000Z' })
    await repository.saveFolder({ id: 'f2', name: 'Annen', createdAt: '2026-01-01T00:00:00.000Z' })

    const inside = [
      { ...samplePresentation(), folderId: 'f1' },
      { ...samplePresentation(), id: 'p_også_i_f1', folderId: 'f1' },
    ]
    const elsewhere = { ...samplePresentation(), id: 'p_i_f2', folderId: 'f2' }
    const root = { ...samplePresentation(), id: 'p_rot', folderId: null }
    for (const presentation of [...inside, elsewhere, root]) {
      await repository.savePresentation(presentation)
    }

    await repository.deleteFolder('f1')

    expect((await repository.listFolders()).map((folder) => folder.id)).toEqual(['f2'])
    // Nothing lost, and nothing left naming a folder that is gone — in the
    // document *and* in the column the library filters on, because a deck that
    // says one thing in one place and another in the other is shown nowhere.
    const summaries = await repository.listPresentations()
    expect(summaries).toHaveLength(4)
    for (const presentation of inside) {
      expect((await repository.loadPresentation(presentation.id)).folderId).toBeNull()
      expect(summaries.find((summary) => summary.id === presentation.id)?.folderId).toBeNull()
    }
    // The other folder and what is in it are untouched.
    expect((await repository.loadPresentation(elsewhere.id)).folderId).toBe('f2')
    expect(summaries.find((summary) => summary.id === elsewhere.id)?.folderId).toBe('f2')
    expect((await repository.loadPresentation(root.id)).folderId).toBeNull()
  })

  it('treats deleting a folder that is not there as nothing to do', async () => {
    // Idempotent by contract, and the reason the agent surface looks the folder
    // up before calling: a store that shrugs cannot answer "no such folder".
    const repository = freshRepository()
    await expect(repository.deleteFolder('f_finnes_ikke')).resolves.toBeUndefined()
  })

  it('stores and rejects templates by validity', async () => {
    const repository = freshRepository()
    const template = {
      id: newTemplateId(),
      name: 'To kolonner',
      hasTitle: true,
      root: stripContent(createSplit('x', [1, 1], [createLeaf(), createLeaf()])),
      createdAt: new Date().toISOString(),
    }
    await repository.saveTemplate(template)
    expect(await repository.listTemplates()).toHaveLength(1)
    await expect(
      repository.saveTemplate({ ...template, id: 'bad', root: { ...template.root, weights: [1] } as never }),
    ).rejects.toThrow()
  })
})

describe('.slaids backup', () => {
  it('round-trips a presentation and its assets', async () => {
    const source = freshRepository()
    const presentation: Presentation = {
      ...samplePresentation(),
      assets: [assetRef],
      slides: [
        sectionAt(samplePresentation(), 0),
        {
          ...contentAt(samplePresentation(), 1),
          root: createLeaf(createImage(assetRef.id)),
        },
      ],
    }
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, svgFixture('figur'))

    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })
    expect(archive.size).toBeGreaterThan(0)

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.errors).toEqual([])
    expect(report.importedPresentations).toEqual([presentation.id])
    expect(report.importedAssets).toBe(1)

    const restored = await target.loadPresentation(presentation.id)
    expect(restored.title).toBe(presentation.title)
    expect(await target.getAsset(assetRef.id)).not.toBeNull()
  })

  it('carries editorial text nobody presents: the image context and the image plan', async () => {
    // Both live outside the visible deck — beside the slides rather than inside
    // them — so neither is covered by "the slides came through". A `.slaids`
    // archive is how a deck moves between libraries, and an author who exported
    // their work expects the picture planning to move with it.
    const source = freshRepository()
    const base = samplePresentation()
    const slide = contentAt(base, 1)
    const zone = createLeaf(createImage())
    const presentation: Presentation = {
      ...base,
      imageContext: 'Dempet jordfargepalett, naturlig dagslys, ingen tekst i bildene.',
      imagePlan: [
        {
          slideId: slide.id,
          nodeId: zone.id,
          subject: 'Halvfigur av en voksen Homo erectus i et åpent landskap.',
          composition: 'Motivet i venstre tredjedel, blikket mot høyre.',
          requirements: 'Riktige kroppsproporsjoner for arten.',
          avoid: 'Moderne klær og redskaper.',
        },
      ],
      slides: [sectionAt(base, 0), { ...slide, root: zone }],
    }
    await source.savePresentation(presentation)

    const target = freshRepository()
    const report = await importSlaidsArchive(
      target,
      await exportSlaidsArchive(source, { presentationIds: [presentation.id] }),
    )
    expect(report.errors).toEqual([])

    const restored = await target.loadPresentation(presentation.id)
    expect(restored.imageContext).toBe(presentation.imageContext)
    expect(restored.imagePlan).toEqual(presentation.imagePlan)
  })

  it('beholder en parkert slide og bildefilen som bare brukes der', async () => {
    const source = freshRepository()
    const base = samplePresentation()
    const slide = { ...contentAt(base, 1), root: createLeaf(createImage(assetRef.id)) }
    const presentation: Presentation = {
      ...base,
      slides: [sectionAt(base, 0)],
      sandboxSlides: [slide],
      assets: [assetRef],
    }
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, svgFixture('parkert-figur'))

    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })
    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.errors).toEqual([])
    expect(report.importedAssets).toBe(1)

    const imported = await target.loadPresentation(presentation.id)
    expect(imported.slides).toEqual(presentation.slides)
    expect(imported.sandboxSlides).toEqual([slide])
    expect(await target.getAsset(assetRef.id)).not.toBeNull()
  })

  it('imports a clashing presentation as a copy instead of overwriting', async () => {
    const repository = freshRepository()
    const presentation = samplePresentation()
    await repository.savePresentation(presentation)
    const archive = await exportSlaidsArchive(repository, { presentationIds: [presentation.id] })

    const report = await importSlaidsArchive(repository, archive)
    expect(report.importedPresentations[0]).not.toBe(presentation.id)
    const summaries = await repository.listPresentations()
    expect(summaries).toHaveLength(2)
    expect(summaries.some((summary) => summary.title.includes('(importert)'))).toBe(true)
  })

  it('remaps asset ids when importing a copy', async () => {
    const repository = freshRepository()
    const presentation: Presentation = {
      ...samplePresentation(),
      assets: [assetRef],
      slides: [
        sectionAt(samplePresentation(), 0),
        {
          ...contentAt(samplePresentation(), 1),
          root: createLeaf(createImage(assetRef.id)),
        },
      ],
    }
    await repository.savePresentation(presentation)
    await repository.putAsset(presentation.id, assetRef, svgFixture('figur'))
    const archive = await exportSlaidsArchive(repository, { presentationIds: [presentation.id] })

    const report = await importSlaidsArchive(repository, archive)
    const copy = await repository.loadPresentation(report.importedPresentations[0])
    expect(copy.assets[0].id).not.toBe(assetRef.id)
    const payload = JSON.stringify(contentAt(copy, 1).root)
    expect(payload).toContain(copy.assets[0].id)
    expect(payload).not.toContain(assetRef.id)
    expect(await repository.getAsset(copy.assets[0].id)).not.toBeNull()
  })

  it('remaps an asset id that is already taken by another presentation', async () => {
    // Asset rows are keyed by asset id alone, so an archive from elsewhere that
    // happens to reuse an id must not overwrite the local file.
    const withAsset = (presentation: Presentation): Presentation => ({
      ...presentation,
      assets: [assetRef],
      slides: [
        sectionAt(presentation, 0),
        {
          ...contentAt(presentation, 1),
          root: createLeaf(createImage(assetRef.id)),
        },
      ],
    })

    const local = freshRepository()
    const mine = withAsset(samplePresentation())
    await local.savePresentation(mine)
    await local.putAsset(mine.id, assetRef, svgFixture('mine'))

    const other = freshRepository()
    const theirs = withAsset(createPresentation({ title: 'Fra en annen maskin' }))
    await other.savePresentation(theirs)
    await other.putAsset(theirs.id, assetRef, svgFixture('theirs'))
    const archive = await exportSlaidsArchive(other, { presentationIds: [theirs.id] })

    const report = await importSlaidsArchive(local, archive)
    expect(report.errors).toEqual([])
    expect(report.importedPresentations).toEqual([theirs.id])

    // The local file is untouched, and still owned by the local presentation.
    const kept = await local.getAsset(assetRef.id)
    expect(await kept?.blob.text()).toBe(svgMarkup('mine'))
    expect((await local.listAssets(mine.id)).map((ref) => ref.id)).toEqual([assetRef.id])

    // The imported one got a fresh id, with its own bytes.
    const imported = await local.loadPresentation(theirs.id)
    expect(imported.assets[0].id).not.toBe(assetRef.id)
    expect(JSON.stringify(contentAt(imported, 1).root)).not.toContain(assetRef.id)
    const copy = await local.getAsset(imported.assets[0].id)
    expect(await copy?.blob.text()).toBe(svgMarkup('theirs'))
  })

  it('lagrer presentasjonen før filene, slik en fremmednøkkel krever', async () => {
    const source = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, svgFixture('figur'))
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    const target = freshRepository()
    const report = await importSlaidsArchive(withRemoteQuirks(target), archive)

    expect(report.errors).toEqual([])
    expect(report.importedAssets).toBe(1)
    expect(await target.getAsset(assetRef.id)).not.toBeNull()
  })

  it('importerer som kopi når id-en er tatt av en konto vi ikke ser', async () => {
    const source = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, svgFixture('figur'))
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    // The target's own library is empty, so nothing looks taken — until the
    // write hits a row belonging to whoever the backup came from.
    const target = freshRepository()
    const report = await importSlaidsArchive(
      withRemoteQuirks(target, { invisibleIds: [presentation.id] }),
      archive,
    )

    expect(report.errors).toEqual([])
    expect(report.importedPresentations).toHaveLength(1)
    expect(report.importedPresentations[0]).not.toBe(presentation.id)

    const imported = await target.loadPresentation(report.importedPresentations[0])
    expect(imported.title).toBe(`${presentation.title} (importert)`)
    // Its files got fresh ids too: they would have clashed the same way.
    expect(imported.assets[0].id).not.toBe(assetRef.id)
    expect(JSON.stringify(contentAt(imported, 1).root)).toContain(imported.assets[0].id)
    expect(await target.getAsset(imported.assets[0].id)).not.toBeNull()
  })

  it('tar en halvimportert presentasjon ut igjen når en fil ikke kom fram', async () => {
    const source = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, svgFixture('figur'))
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    const target = freshRepository()
    await expect(
      importSlaidsArchive(withRemoteQuirks(target, { failAssets: true }), archive),
    ).rejects.toThrow(/avvist/)

    // A deck without its pictures must not turn up on the next refresh.
    expect(await target.listPresentations()).toEqual([])
  })

  it('legger en presentasjon i roten når mappen ikke finnes hos mottakeren', async () => {
    const source = freshRepository()
    await source.saveFolder({ id: 'fl_kilde', name: 'Kilde', createdAt: new Date().toISOString() })
    const presentation = { ...samplePresentation(), folderId: 'fl_kilde' }
    await source.savePresentation(presentation)
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    // The archive carries no folders, so the reference points at nothing here —
    // and remotely the foreign key would reject it outright.
    const target = freshRepository()
    const report = await importSlaidsArchive(withRemoteQuirks(target), archive)

    expect(report.errors).toEqual([])
    expect(report.importedPresentations).toEqual([presentation.id])
    expect((await target.loadPresentation(presentation.id)).folderId).toBeNull()
    // No folder is invented to satisfy the constraint.
    expect(await target.listFolders()).toEqual([])
  })

  it('beholder mappen når mottakeren faktisk har den', async () => {
    const source = freshRepository()
    await source.saveFolder({ id: 'fl_delt', name: 'Delt', createdAt: new Date().toISOString() })
    const presentation = { ...samplePresentation(), folderId: 'fl_delt' }
    await source.savePresentation(presentation)
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    const target = freshRepository()
    await target.saveFolder({ id: 'fl_delt', name: 'Delt', createdAt: new Date().toISOString() })
    const report = await importSlaidsArchive(withRemoteQuirks(target), archive)

    expect(report.errors).toEqual([])
    expect((await target.loadPresentation(presentation.id)).folderId).toBe('fl_delt')
  })

  it('importerer en mal som kopi når id-en er tatt av en konto vi ikke ser', async () => {
    const source = freshRepository()
    const template = sampleTemplate()
    await source.saveTemplate(template)
    const presentation = samplePresentation()
    await source.savePresentation(presentation)
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    // `listTemplates()` on the target says the id is free — RLS hides the row
    // that has it — so only the write can tell us otherwise.
    const target = freshRepository()
    const report = await importSlaidsArchive(
      withRemoteQuirks(target, { invisibleTemplateIds: [template.id] }),
      archive,
    )

    expect(report.errors).toEqual([])
    expect(report.importedTemplates).toBe(1)
    const stored = await target.listTemplates()
    expect(stored).toHaveLength(1)
    expect(stored[0].id).not.toBe(template.id)
    expect(stored[0].name).toBe(`${template.name} (importert)`)
  })

  it('lager ikke en ekstra kopi av malen når skrivingen feiler av andre grunner', async () => {
    const source = freshRepository()
    const template = sampleTemplate()
    await source.saveTemplate(template)
    const presentation = samplePresentation()
    await source.savePresentation(presentation)
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    const target = freshRepository()
    const report = await importSlaidsArchive(
      withRemoteQuirks(target, { failTemplates: true }),
      archive,
    )

    // A dropped connection is not a clash, and retrying it as a copy would
    // leave two of the same template behind.
    expect(report.importedTemplates).toBe(0)
    expect(report.errors.some((error) => error.includes('avvist'))).toBe(true)
    expect(await target.listTemplates()).toEqual([])
  })

  /*
   * A `.slaids` file is external input, whoever made it. The documents in it
   * are validated and migrated; these check that its *files* are too — an old
   * backup must not be the way around the SVG rule, since a `.slaids` handed to
   * somebody is exactly as trustworthy as an `.svg` handed to them.
   *
   * The archives here are built by storing bytes straight into a source
   * repository and exporting it, which is precisely the shape a hand-crafted
   * archive would have: the export copies what it is given.
   */
  async function archiveCarrying(blob: Blob): Promise<Blob> {
    const source = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, blob)
    return exportSlaidsArchive(source, { presentationIds: [presentation.id] })
  }

  it.each([
    ['<script>', `<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>`],
    ['onclick', `<svg viewBox="0 0 1 1"><rect onclick="alert(1)" width="1" height="1"/></svg>`],
    [
      'ekstern referanse',
      `<svg viewBox="0 0 1 1"><image href="https://evil.example/x.png" width="1" height="1"/></svg>`,
    ],
    [
      'CSS-omvei',
      `<svg viewBox="0 0 1 1"><rect style="fill:\\75 rl(https://evil.example/x)" width="1" height="1"/></svg>`,
    ],
  ])('lar ikke en backup smugle inn en SVG med %s', async (_label, markup) => {
    const archive = await archiveCarrying(new Blob([markup], { type: 'image/svg+xml' }))

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)

    // The deck still imports — the figure does not, and the report says which.
    expect(report.importedPresentations).toHaveLength(1)
    expect(report.importedAssets).toBe(0)
    expect(report.errors.join(' ')).toContain('figur.svg')
    expect(await target.getAsset(assetRef.id)).toBeNull()
    expect(await target.listAssets(report.importedPresentations[0])).toEqual([])

    /*
     * And the document does not point at it. A refused file that stayed in the
     * asset list — or in the zone that showed it — would be a deck importing
     * "successfully" with a picture that can never load, which is the state
     * `unknownAssetIds` exists to call broken.
     */
    const restored = await target.loadPresentation(report.importedPresentations[0])
    expect(restored.assets).toEqual([])
    expect(JSON.stringify(restored.slides)).not.toContain(assetRef.id)
    expect(unknownAssetIds(restored, [...usedAssetIds(restored)])).toEqual([])
  })

  it('tar den avviste figuren ut av teksten og sandkassen også', async () => {
    // Not only the asset list: an inline picture is a block in the text and a
    // sandbox item is content too, and either one left pointing at a file that
    // was never stored is the same broken deck.
    const source = freshRepository()
    const base = samplePresentation()
    const presentation: Presentation = {
      ...base,
      assets: [assetRef],
      slides: [
        sectionAt(base, 0),
        {
          ...contentAt(base, 1),
          root: createSplit('x', [1, 1], [
            createLeaf(createImage(assetRef.id)),
            createLeaf(
              containerWithDoc({
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Teksten blir stående.' }] },
                  { type: 'slaidsImage', attrs: { assetId: assetRef.id, alt: 'Figur' } },
                ],
              }),
            ),
          ]),
        },
      ],
      sandbox: [{ id: 'sb1', content: createImage(assetRef.id), createdAt: '', note: '' }],
    }
    await source.savePresentation(presentation)
    await source.putAsset(
      presentation.id,
      assetRef,
      new Blob([`<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>`], {
        type: 'image/svg+xml',
      }),
    )
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.importedPresentations).toHaveLength(1)

    const restored = await target.loadPresentation(report.importedPresentations[0])
    expect(restored.assets).toEqual([])
    expect(JSON.stringify(restored)).not.toContain(`"assetId":"${assetRef.id}"`)
    expect(unknownAssetIds(restored, [...usedAssetIds(restored)])).toEqual([])
    // Everything the archive did describe correctly is still there.
    expect(JSON.stringify(restored.slides)).toContain('Teksten blir stående.')
    expect(restored.sandbox).toHaveLength(1)
  })

  it('fjerner også en referanse arkivet ikke har bytes for', async () => {
    // Missing file data was already reported and skipped; now the reference
    // goes with it, so the rule is one rule and not one per reason.
    const source = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, svgFixture('figur'))
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    // Strip the bytes out of the zip, leaving the index entry behind.
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    const withoutBytes = Object.fromEntries(
      Object.entries(entries).filter(([path]) => !/^assets\/[^/]+\.svg$/.test(path)),
    )
    const damaged = new Blob([zipSync(withoutBytes) as unknown as BlobPart])

    const target = freshRepository()
    const report = await importSlaidsArchive(target, damaged)
    expect(report.errors.join(' ')).toContain('Mangler fildata')

    const restored = await target.loadPresentation(report.importedPresentations[0])
    expect(restored.assets).toEqual([])
    expect(unknownAssetIds(restored, [...usedAssetIds(restored)])).toEqual([])
  })

  it('saniterer en lovlig SVG på vei inn, og lagrer den reserialiserte', async () => {
    const archive = await archiveCarrying(
      new Blob([`<svg viewBox="0 0 100 80"><rect width="100" height="80"/><blink/></svg>`], {
        type: 'image/svg+xml',
      }),
    )

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.errors).toEqual([])
    expect(report.importedAssets).toBe(1)

    const stored = await target.getAsset(assetRef.id)
    const markup = await stored!.blob.text()
    expect(markup).not.toContain('blink')
    expect(markup).toContain('<rect')
    // The document describes the file that is actually there, not what the
    // archive claimed about it.
    const restored = await target.loadPresentation(report.importedPresentations[0])
    expect(restored.assets[0].byteSize).toBe(new TextEncoder().encode(markup).byteLength)
    expect(restored.assets[0]).toMatchObject({ mimeType: 'image/svg+xml', isVector: true })
  })

  it('leser formatet av bytene, ikke av det arkivet kaller filen', async () => {
    // An index entry claiming `image/svg+xml` for PNG bytes, and the other way
    // round: the type a file is served with is what makes it active content, so
    // it can never be the archive's word for it.
    const png = decodeBase64(realImageBase64.png)
    const archive = await archiveCarrying(bytesToBlob(png, 'image/svg+xml'))

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.errors).toEqual([])

    const restored = await target.loadPresentation(report.importedPresentations[0])
    expect(restored.assets[0]).toMatchObject({ mimeType: 'image/png', isVector: false })
    const stored = await target.getAsset(assetRef.id)
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(png)
  })

  it('lar et rasterbilde stå byte for byte, med størrelsen arkivet husket', async () => {
    const png = decodeBase64(realImageBase64.png)
    const source = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    const rasterRef: AssetRef = {
      ...assetRef,
      name: 'bilde.png',
      mimeType: 'image/png',
      isVector: false,
      byteSize: png.byteLength,
      width: 640,
      height: 480,
    }
    await source.savePresentation({ ...presentation, assets: [rasterRef] })
    await source.putAsset(presentation.id, rasterRef, bytesToBlob(png, 'image/png'))
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.errors).toEqual([])

    const stored = await target.getAsset(rasterRef.id)
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(png)
    // Not re-derived: the size the archive recorded is the size that was read
    // when the file first came through a door, and a backup is not the place to
    // start refusing decks over it.
    const restored = await target.loadPresentation(report.importedPresentations[0])
    expect(restored.assets[0]).toMatchObject({ width: 640, height: 480 })
  })

  it('reports a corrupt archive instead of throwing', async () => {
    const repository = freshRepository()
    const report = await importSlaidsArchive(repository, new Blob(['ikke en zip']))
    expect(report.errors.length).toBeGreaterThan(0)
    expect(report.importedPresentations).toEqual([])
  })

  it('suggests a safe file name', () => {
    expect(suggestedFileName('Min Presentasjon 2026')).toBe('min-presentasjon-2026.slaids')
    expect(suggestedFileName('   ')).toBe('slaids.slaids')
    expect(suggestedFileName('Æøå test')).toBe('æøå-test.slaids')
  })

  it('generates unique asset ids', () => {
    expect(newAssetId()).not.toBe(newAssetId())
  })
})

describe('en interaktiv slide i lageret', () => {
  const APP =
    '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body><p>Blåbær 🙂 日本</p><script>let n = 0; // </script</script></body></html>'

  function withApp(): Presentation {
    const presentation = samplePresentation()
    return {
      ...presentation,
      slides: [
        ...presentation.slides,
        createInteractiveSlide({ name: 'Teller', fileName: 'teller.html', html: APP }),
      ],
    }
  }

  it('lagres og leses tilbake byte for byte, som data', async () => {
    const repository = freshRepository()
    const presentation = withApp()
    await repository.savePresentation(presentation)
    const loaded = await repository.loadPresentation(presentation.id)
    expect(interactiveAt(loaded, 2)).toEqual(interactiveAt(presentation, 2))
  })

  /**
   * The door a hand-written archive comes through.
   *
   * Import runs `migratePresentation` and then saves; the repository does not
   * re-ask the domain's questions, so whatever the load gate accepts is what
   * gets stored. These two are the cases the commands could never have
   * produced — the whole reason the gate has to ask.
   */
  async function importedFromArchive(
    presentation: Presentation,
    rewrite: (document: Record<string, unknown>) => Record<string, unknown>,
  ) {
    const source = freshRepository()
    await source.savePresentation(presentation)
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    // Rewritten inside the zip, exactly as somebody editing an archive would.
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    const path = `presentations/${presentation.id}.json`
    const document = JSON.parse(new TextDecoder().decode(entries[path])) as Record<string, unknown>
    entries[path] = new TextEncoder().encode(JSON.stringify(rewrite(document)))

    const target = freshRepository()
    const report = await importSlaidsArchive(target, new Blob([zipSync(entries) as unknown as BlobPart]))
    return { report, target }
  }

  it('avviser en håndskrevet backup der miniappene til sammen sprenger budsjettet', async () => {
    const { report, target } = await importedFromArchive(withApp(), (document) => {
      const slides = document.slides as Record<string, unknown>[]
      const app = slides[slides.length - 1]
      const count = Math.floor(MAX_INTERACTIVE_HTML_TOTAL_BYTES / MAX_INTERACTIVE_HTML_BYTES) + 1
      return {
        ...document,
        slides: [
          ...slides.slice(0, -1),
          ...Array.from({ length: count }, (_, index) => ({
            ...app,
            id: `s-app-${index}`,
            fileName: `app-${index}.html`,
            html: htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES),
          })),
        ],
      }
    })

    expect(report.errors).toHaveLength(1)
    expect(report.importedPresentations).toEqual([])
    expect(await target.listPresentations()).toEqual([])
  })

  it('avviser en håndskrevet backup med et filnavn eller en kilde kommandoene ville avvist', async () => {
    for (const fields of [
      { fileName: 'teller.txt' },
      { name: '   ' },
      { html: 'bare tekst uten elementer' },
    ]) {
      const { report, target } = await importedFromArchive(withApp(), (document) => {
        const slides = document.slides as Record<string, unknown>[]
        return {
          ...document,
          slides: [...slides.slice(0, -1), { ...slides[slides.length - 1], ...fields }],
        }
      })
      expect(report.importedPresentations, JSON.stringify(fields)).toEqual([])
      expect(await target.listPresentations()).toEqual([])
    }
  })

  it('følger med i en .slaids-sikkerhetskopi uendret', async () => {
    const source = freshRepository()
    const presentation = withApp()
    await source.savePresentation(presentation)
    const archive = await exportSlaidsArchive(source, { presentationIds: [presentation.id] })

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.errors).toEqual([])
    const restored = await target.loadPresentation(presentation.id)
    expect(interactiveAt(restored, 2)).toEqual(interactiveAt(presentation, 2))
  })
})

/* ------------------------------------------------------------------ *
 * The trash, and what a presentation costs
 * ------------------------------------------------------------------ */

describe('DexieSlaidsRepository – søppelkassen', () => {
  it('flytter til søppelkassen uten å røre dokumentet eller filene', async () => {
    const repository = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await repository.savePresentation(presentation)
    await repository.putAsset(presentation.id, assetRef, svgFixture('a'))

    await repository.trashPresentation(presentation.id)

    expect(await repository.listPresentations()).toEqual([])
    const [trashed] = await repository.listTrashedPresentations()
    expect(trashed.id).toBe(presentation.id)
    expect(Date.parse(trashed.deletedAt ?? '')).not.toBeNaN()
    // Nothing was destroyed: the file is there, and a trashed deck still owns
    // it, so the sweep leaves it alone.
    expect(await repository.getAsset(assetRef.id)).not.toBeNull()
    expect(await repository.deleteOrphanAssets()).toBe(0)
    // And the document comes back exactly as it was.
    await repository.restorePresentation(presentation.id)
    expect(await repository.loadPresentation(presentation.id)).toEqual(presentation)
  })

  it('lar ikke en lagring fra en annen fane hente den ut av søppelkassen', async () => {
    // The editor saves the document it holds, and `deletedAt` is not in it. A
    // save must therefore carry the stored value over — otherwise a deck open
    // in another tab would climb back out of the trash on its next autosave.
    const repository = freshRepository()
    const presentation = samplePresentation()
    await repository.savePresentation(presentation)
    await repository.trashPresentation(presentation.id)
    const [before] = await repository.listTrashedPresentations()

    await repository.savePresentation({ ...presentation, title: 'Autolagret etterpå' })

    expect(await repository.listPresentations()).toEqual([])
    const [after] = await repository.listTrashedPresentations()
    expect(after.title).toBe('Autolagret etterpå')
    expect(after.deletedAt).toBe(before.deletedAt)
  })

  it('åpner ikke en presentasjon som ligger i søppelkassen, før den er gjenopprettet', async () => {
    // To everything but the trash view a trashed deck is gone: the editor does
    // not open it from a remembered id, an agent does not read or edit it, and
    // a copy cannot be made of it. Restoring it is what brings all of that back.
    const repository = freshRepository()
    const presentation = samplePresentation()
    await repository.savePresentation(presentation)
    await repository.trashPresentation(presentation.id)

    await expect(repository.loadPresentation(presentation.id)).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    )
    await expect(repository.loadPresentation(presentation.id)).rejects.toThrow(/søppelkassen/)

    await repository.restorePresentation(presentation.id)
    expect(await repository.loadPresentation(presentation.id)).toEqual(presentation)
  })

  it('importerer et arkiv med en id som ligger i søppelkassen som kopi, og lar søppelkassen være', async () => {
    // An id in the trash is as taken as one in the library. Writing over it
    // would land the import in the trash, since a save keeps `deletedAt`.
    const repository = freshRepository()
    const presentation = samplePresentation()
    await repository.savePresentation(presentation)
    const archive = await exportSlaidsArchive(repository, { presentationIds: [presentation.id] })
    await repository.trashPresentation(presentation.id)

    const report = await importSlaidsArchive(repository, archive)

    expect(report.errors).toEqual([])
    expect(report.importedPresentations).toHaveLength(1)
    expect(report.importedPresentations[0]).not.toBe(presentation.id)
    const [imported] = await repository.listPresentations()
    expect(imported.title).toBe(`${presentation.title} (importert)`)
    expect(imported.deletedAt).toBeNull()
    expect((await repository.listTrashedPresentations()).map((summary) => summary.id)).toEqual([
      presentation.id,
    ])
  })

  it('gjenoppretter til biblioteket, i mappen den lå i', async () => {
    const repository = freshRepository()
    await repository.saveFolder({ id: 'fl_1', name: 'Mappe', createdAt: new Date().toISOString() })
    const presentation = { ...samplePresentation(), folderId: 'fl_1' }
    await repository.savePresentation(presentation)
    await repository.trashPresentation(presentation.id)

    await repository.restorePresentation(presentation.id)

    const [summary] = await repository.listPresentations()
    expect(summary.id).toBe(presentation.id)
    expect(summary.folderId).toBe('fl_1')
    expect(summary.deletedAt).toBeNull()
    expect(await repository.listTrashedPresentations()).toEqual([])
    // Restoring what is already in the library changes nothing.
    await repository.restorePresentation(presentation.id)
    expect(await repository.listPresentations()).toHaveLength(1)
  })

  it('sier fra om en rad som ikke finnes, og vakter kastingen mot lesingen', async () => {
    const repository = freshRepository()
    await expect(repository.trashPresentation('borte')).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    )
    await expect(repository.restorePresentation('borte')).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    )

    const presentation = samplePresentation()
    await repository.savePresentation(presentation)
    const stale = presentationRevision(presentation)
    const edited = { ...presentation, title: 'Endret' }
    await repository.savePresentation(edited)

    // The reading moved on: the same refusal a guarded delete gives, and the
    // deck stays where it is.
    await expect(
      repository.trashPresentation(presentation.id, { expectedRevision: stale }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)
    expect(await repository.listPresentations()).toHaveLength(1)
    // A row that is not there fails a guard too — it is not the one that was read.
    await expect(
      repository.trashPresentation('borte', { expectedRevision: stale }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)

    await repository.trashPresentation(presentation.id, {
      expectedRevision: presentationRevision(edited),
    })
    expect(await repository.listTrashedPresentations()).toHaveLength(1)
  })

  it('sletter for godt bare den oppføringen som ble sett, aldri en gjenopprettet presentasjon', async () => {
    // The race the trash is built to lose safely: the trash is listed, and
    // before the entry is purged another tab restores the deck. A permanent
    // delete that did not look would take the live deck down, files and all.
    const repository = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await repository.savePresentation(presentation)
    await repository.putAsset(presentation.id, assetRef, svgFixture('a'))
    await repository.trashPresentation(presentation.id)
    const [seen] = await repository.listTrashedPresentations()
    if (!seen.deletedAt) throw new Error('forventet en kastet presentasjon')

    await repository.restorePresentation(presentation.id)

    expect(await repository.purgePresentation(presentation.id, seen.deletedAt)).toBe(false)
    // Live, whole, and with its file.
    expect(await repository.loadPresentation(presentation.id)).toEqual(presentation)
    expect(await repository.getAsset(assetRef.id)).not.toBeNull()

    // Trashed again since the listing: a new entry, with a new time, which the
    // old reading must not purge either. Only the clock is faked.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(Date.parse(seen.deletedAt) + 60_000))
      await repository.trashPresentation(presentation.id)
    } finally {
      vi.useRealTimers()
    }
    expect(await repository.purgePresentation(presentation.id, seen.deletedAt)).toBe(false)
    expect(await repository.listTrashedPresentations()).toHaveLength(1)

    // The entry that is actually there goes, and the files with it.
    const [again] = await repository.listTrashedPresentations()
    if (!again.deletedAt) throw new Error('forventet en kastet presentasjon')
    expect(await repository.purgePresentation(presentation.id, again.deletedAt)).toBe(true)
    expect(await repository.listTrashedPresentations()).toEqual([])
    await expect(repository.loadPresentation(presentation.id)).rejects.toThrow(/Fant ikke/)
    expect(await repository.getAsset(assetRef.id)).toBeNull()
    // And a second purge of what is gone is nothing to do, not an error.
    expect(await repository.purgePresentation(presentation.id, again.deletedAt)).toBe(false)
  })

  it('lar ikke en annen fane gjenopprette en presentasjon som er slettet for godt', async () => {
    // Two repositories on one database, as two tabs are. A has the deck open;
    // B trashes it and empties the trash; A autosaves its old copy. The row is
    // gone, and a save that treated "no row" as "new" would insert it again —
    // a deck back from the dead, pointing at files the purge took.
    counter += 1
    const database = new SlaidsDatabase(`slaids-test-${counter}`)
    databases.push(database)
    const tabA = new DexieSlaidsRepository(database)
    const tabB = new DexieSlaidsRepository(database)
    const presentation = presentationWithAsset(samplePresentation())
    await tabA.savePresentation(presentation)
    await tabA.putAsset(presentation.id, assetRef, svgFixture('a'))
    const held = await tabA.loadPresentation(presentation.id)

    await tabB.trashPresentation(presentation.id)
    const [entry] = await tabB.listTrashedPresentations()
    expect(await tabB.purgePresentation(presentation.id, entry.deletedAt ?? '')).toBe(true)

    // The plain autosave, and the guarded save an agent makes: both refused.
    await expect(tabA.savePresentation({ ...held, title: 'Skrevet etterpå' })).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )
    await expect(
      tabA.savePresentation(held, { expectedRevision: presentationRevision(held) }),
    ).rejects.toBeInstanceOf(RepositoryConflictError)

    // Still gone, in every listing and for every reader, and no file came back.
    for (const tab of [tabA, tabB]) {
      expect(await tab.listPresentations()).toEqual([])
      expect(await tab.listTrashedPresentations()).toEqual([])
      await expect(tab.loadPresentation(presentation.id)).rejects.toBeInstanceOf(
        RepositoryNotFoundError,
      )
      expect(await tab.getAsset(assetRef.id)).toBeNull()
    }
    expect(await database.assets.count()).toBe(0)

    // A genuinely new presentation is still an insert, from either tab.
    const fresh = samplePresentation()
    await tabA.savePresentation(fresh)
    expect((await tabB.listPresentations()).map((summary) => summary.id)).toEqual([fresh.id])

    // And a deletion this tab made itself is its own to forget: the same id is
    // new again afterwards, which the duplication rollback relies on.
    await tabA.deletePresentation(fresh.id)
    await tabA.savePresentation(fresh)
    expect((await tabB.listPresentations()).map((summary) => summary.id)).toEqual([fresh.id])
  })

  it('husker en rad den listet, ikke bare en den leste', async () => {
    // The library lists, the editor loads; an id known from either is a row
    // that existed. A row purged elsewhere after a listing is therefore
    // refused too, and an import of an archive carrying that id lands as a copy
    // — the same path the Supabase conflict takes.
    counter += 1
    const database = new SlaidsDatabase(`slaids-test-${counter}`)
    databases.push(database)
    const here = new DexieSlaidsRepository(database)
    const elsewhere = new DexieSlaidsRepository(database)
    const presentation = samplePresentation()
    await elsewhere.savePresentation(presentation)
    const archive = await exportSlaidsArchive(elsewhere, { presentationIds: [presentation.id] })

    expect(await here.listPresentations()).toHaveLength(1)
    await elsewhere.trashPresentation(presentation.id)
    const [entry] = await elsewhere.listTrashedPresentations()
    await elsewhere.purgePresentation(presentation.id, entry.deletedAt ?? '')

    await expect(here.savePresentation(presentation)).rejects.toBeInstanceOf(
      RepositoryConflictError,
    )
    const report = await importSlaidsArchive(here, archive)
    expect(report.errors).toEqual([])
    const [imported] = await here.listPresentations()
    expect(imported.id).not.toBe(presentation.id)
    expect(imported.title).toBe(`${presentation.title} (importert)`)
  })

  it('lister søppelkassen med den sist kastede først', async () => {
    const repository = freshRepository()
    const first = { ...samplePresentation(), title: 'Først kastet' }
    const second = { ...samplePresentation(), title: 'Sist kastet' }
    await repository.savePresentation(first)
    await repository.savePresentation(second)

    // Only the clock is faked: IndexedDB schedules its work on real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-01T10:00:00.000Z'))
      await repository.trashPresentation(first.id)
      vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'))
      await repository.trashPresentation(second.id)
    } finally {
      vi.useRealTimers()
    }

    const trashed = await repository.listTrashedPresentations()
    expect(trashed.map((summary) => summary.title)).toEqual(['Sist kastet', 'Først kastet'])
    expect(trashed.map((summary) => summary.deletedAt)).toEqual([
      '2026-09-05T10:00:00.000Z',
      '2026-09-01T10:00:00.000Z',
    ])
  })

  it('sier hvor mye plass en presentasjon tar: dokumentet pluss filene det lister', async () => {
    const repository = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await repository.savePresentation(presentation)

    const [summary] = await repository.listPresentations()

    expect(summary.byteSize).toBe(documentByteSize(presentation) + assetRef.byteSize)
    expect(summary.byteSize).toBe(presentationByteSize(presentation))
    // Bytes, not characters: the title's three of «åæø» weigh two bytes each.
    const accented = { ...samplePresentation(), title: 'Blåbærsyltetøy' }
    expect(documentByteSize(accented)).toBe(JSON.stringify(accented).length + 3)
  })
})

describe('DexieSlaidsRepository – temamaler', () => {
  function sample(id: string, withLogo: boolean) {
    const logoRef: AssetRef = {
      id: 'a_logo',
      name: 'logo.png',
      mimeType: 'image/png',
      byteSize: 4,
      width: 200,
      height: 100,
      isVector: false,
    }
    let deck = samplePresentation()
    if (withLogo) {
      const registered = registerAsset(deck, logoRef)
      if (!registered.ok) throw new Error('registerAsset')
      const set = setThemeLogo(registered.value, logoRef.id)
      if (!set.ok) throw new Error('setThemeLogo')
      deck = set.value
    }
    return {
      id,
      name: `Mal ${id}`,
      visibility: 'private' as const,
      content: themeTemplateContent(deck).content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  it('lagrer en mal med logo, og gir tilbake både malen og filen', async () => {
    const repository = freshRepository()
    const template = sample('tt_1', true)
    await repository.createThemeTemplate(template, new Blob(['png!'], { type: 'image/png' }))
    expect(await repository.listThemeTemplates()).toEqual([{ ...template, own: true }])
    const logo = await repository.getThemeTemplateLogo('tt_1')
    expect(await logo?.text()).toBe('png!')
  })

  it('avviser en mal uten den logoen innholdet sier den har, og en id som er tatt', async () => {
    const repository = freshRepository()
    await expect(repository.createThemeTemplate(sample('tt_1', true), null)).rejects.toThrow(/ugyldig/)
    await repository.createThemeTemplate(sample('tt_2', false), null)
    await expect(repository.createThemeTemplate(sample('tt_2', false), null)).rejects.toThrow(/i bruk/)
    expect(await repository.listThemeTemplates()).toHaveLength(1)
  })

  it('endrer navn, synlighet, innhold og logo, og beholder når malen ble laget', async () => {
    const repository = freshRepository()
    const template = sample('tt_1', true)
    await repository.createThemeTemplate(template, new Blob(['png!']))
    const { createdAt: _createdAt, ...rest } = sample('tt_1', false)
    const changed = { ...rest, name: 'Nytt navn', visibility: 'shared' as const, updatedAt: '2030-01-01T00:00:00.000Z' }

    await repository.updateThemeTemplate(changed, null)
    expect(await repository.listThemeTemplates()).toEqual([{ ...changed, createdAt: template.createdAt, own: true }])
    expect(await repository.getThemeTemplateLogo('tt_1')).toBeNull()

    const withLogo = { ...changed, content: sample('tt_1', true).content }
    await repository.updateThemeTemplate(withLogo, new Blob(['ny!']))
    expect(await (await repository.getThemeTemplateLogo('tt_1'))?.text()).toBe('ny!')
  })

  it('endrer ingenting i en mal som ikke finnes, eller med en logo som ikke stemmer', async () => {
    const repository = freshRepository()
    const { createdAt: _createdAt, ...missing } = sample('tt_9', false)
    await expect(repository.updateThemeTemplate(missing, null)).rejects.toThrow(/finnes ikke/)
    await repository.createThemeTemplate(sample('tt_1', false), null)
    const { createdAt: _c, ...withLogo } = sample('tt_1', true)
    await expect(repository.updateThemeTemplate(withLogo, null)).rejects.toThrow(/ugyldig/)
    expect(await repository.listThemeTemplates()).toEqual([expect.objectContaining({ content: sample('tt_1', false).content })])
  })

  it('sletter malen og logoen, og tømmer standardvalget som pekte på den', async () => {
    const repository = freshRepository()
    await repository.createThemeTemplate(sample('tt_1', true), new Blob(['png!']))
    await repository.updateUserSettings(null, { defaultThemeTemplateId: 'tt_1' })
    expect((await repository.getUserSettings(null)).defaultThemeTemplateId).toBe('tt_1')

    await repository.deleteThemeTemplate('tt_1')
    expect(await repository.listThemeTemplates()).toEqual([])
    expect(await repository.getThemeTemplateLogo('tt_1')).toBeNull()
    expect((await repository.getUserSettings(null)).defaultThemeTemplateId).toBeNull()
  })
})
