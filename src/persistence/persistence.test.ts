import { afterEach, describe, expect, it } from 'vitest'
import { SlaidsDatabase } from './db'
import { DexieSlaidsRepository } from './dexieRepository'
import { RepositoryConflictError, RepositoryError, type SlaidsRepository } from './repository'
import { exportSlaidsArchive, importSlaidsArchive, suggestedFileName } from './backup'
import { createPresentation } from '../domain/presentation'
import { presentationRevision } from '../domain/revision'
import { CURRENT_SCHEMA_VERSION } from '../domain/schema'
import { createLeaf, createSplit, stripContent } from '../domain/layout'
import { createImage, createUntitledCard } from '../domain/content'
import { newAssetId, newTemplateId } from '../domain/ids'
import type { AssetRef, LayoutTemplate, Presentation } from '../domain/types'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshRepository(): DexieSlaidsRepository {
  counter += 1
  const database = new SlaidsDatabase(`slaids-test-${counter}`)
  databases.push(database)
  return new DexieSlaidsRepository(database)
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
      {
        ...presentation.slides[0],
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
    listFolders: () => inner.listFolders(),
    saveFolder: (folder) => inner.saveFolder(folder),
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
      {
        ...base.slides[0],
        root: createLeaf(createImage(assetRef.id)),
      },
    ],
  }
}

describe('DexieSlaidsRepository', () => {
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
    expect(summaries[0].slideCount).toBe(1)
  })

  it('rejects loading a presentation that does not exist', async () => {
    const repository = freshRepository()
    await expect(repository.loadPresentation('missing')).rejects.toThrow(/Fant ikke/)
  })

  it('migrates a legacy record on load', async () => {
    const repository = freshRepository()
    const presentation = samplePresentation()
    const legacy = { ...presentation } as Record<string, unknown>
    delete legacy.schemaVersion
    delete legacy.sandbox
    await repository.savePresentation(legacy as unknown as Presentation)
    const loaded = await repository.loadPresentation(presentation.id)
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(loaded.sandbox).toEqual([])
  })

  it('surfaces an unreadable record as an error', async () => {
    const repository = freshRepository()
    const presentation = samplePresentation()
    await repository.savePresentation({ ...presentation, slides: [] } as Presentation)
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
    await repository.putAsset('p1', assetRef, new Blob(['<svg id="x" />'], { type: 'image/svg+xml' }))
    const stored = await repository.getAsset(assetRef.id)
    expect(stored?.ref.name).toBe('figur.svg')
    expect(await stored?.blob.text()).toContain('<svg')
  })

  it('moves presentations to the root when their folder is deleted', async () => {
    const repository = freshRepository()
    await repository.saveFolder({ id: 'f1', name: 'Mappe', createdAt: '2026-01-01T00:00:00.000Z' })
    const presentation = { ...samplePresentation(), folderId: 'f1' }
    await repository.savePresentation(presentation)
    await repository.deleteFolder('f1')
    const loaded = await repository.loadPresentation(presentation.id)
    expect(loaded.folderId).toBeNull()
    expect(await repository.listFolders()).toHaveLength(0)
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
        {
          ...samplePresentation().slides[0],
          root: createLeaf(createImage(assetRef.id)),
        },
      ],
    }
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, new Blob(['<svg />'], { type: 'image/svg+xml' }))

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
        {
          ...samplePresentation().slides[0],
          root: createLeaf(createImage(assetRef.id)),
        },
      ],
    }
    await repository.savePresentation(presentation)
    await repository.putAsset(presentation.id, assetRef, new Blob(['<svg />'], { type: 'image/svg+xml' }))
    const archive = await exportSlaidsArchive(repository, { presentationIds: [presentation.id] })

    const report = await importSlaidsArchive(repository, archive)
    const copy = await repository.loadPresentation(report.importedPresentations[0])
    expect(copy.assets[0].id).not.toBe(assetRef.id)
    const payload = JSON.stringify(copy.slides[0].root)
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
        {
          ...presentation.slides[0],
          root: createLeaf(createImage(assetRef.id)),
        },
      ],
    })

    const local = freshRepository()
    const mine = withAsset(samplePresentation())
    await local.savePresentation(mine)
    await local.putAsset(mine.id, assetRef, new Blob(['<svg id="mine" />'], { type: 'image/svg+xml' }))

    const other = freshRepository()
    const theirs = withAsset(createPresentation({ title: 'Fra en annen maskin' }))
    await other.savePresentation(theirs)
    await other.putAsset(theirs.id, assetRef, new Blob(['<svg id="theirs" />'], { type: 'image/svg+xml' }))
    const archive = await exportSlaidsArchive(other, { presentationIds: [theirs.id] })

    const report = await importSlaidsArchive(local, archive)
    expect(report.errors).toEqual([])
    expect(report.importedPresentations).toEqual([theirs.id])

    // The local file is untouched, and still owned by the local presentation.
    const kept = await local.getAsset(assetRef.id)
    expect(await kept?.blob.text()).toBe('<svg id="mine" />')
    expect((await local.listAssets(mine.id)).map((ref) => ref.id)).toEqual([assetRef.id])

    // The imported one got a fresh id, with its own bytes.
    const imported = await local.loadPresentation(theirs.id)
    expect(imported.assets[0].id).not.toBe(assetRef.id)
    expect(JSON.stringify(imported.slides[0].root)).not.toContain(assetRef.id)
    const copy = await local.getAsset(imported.assets[0].id)
    expect(await copy?.blob.text()).toBe('<svg id="theirs" />')
  })

  it('lagrer presentasjonen før filene, slik en fremmednøkkel krever', async () => {
    const source = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, new Blob(['<svg />'], { type: 'image/svg+xml' }))
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
    await source.putAsset(presentation.id, assetRef, new Blob(['<svg />'], { type: 'image/svg+xml' }))
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
    expect(JSON.stringify(imported.slides[0].root)).toContain(imported.assets[0].id)
    expect(await target.getAsset(imported.assets[0].id)).not.toBeNull()
  })

  it('tar en halvimportert presentasjon ut igjen når en fil ikke kom fram', async () => {
    const source = freshRepository()
    const presentation = presentationWithAsset(samplePresentation())
    await source.savePresentation(presentation)
    await source.putAsset(presentation.id, assetRef, new Blob(['<svg />'], { type: 'image/svg+xml' }))
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
