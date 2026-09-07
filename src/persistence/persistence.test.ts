import { afterEach, describe, expect, it } from 'vitest'
import { SlaidsDatabase } from './db'
import { DexieSlaidsRepository } from './dexieRepository'
import { RepositoryConflictError, RepositoryError, type SlaidsRepository } from './repository'
import { exportSlaidsArchive, importSlaidsArchive, suggestedFileName } from './backup'
import { createInteractiveSlide, createPresentation } from '../domain/presentation'
import { presentationRevision } from '../domain/revision'
import { CURRENT_SCHEMA_VERSION } from '../domain/schema'
import { createLeaf, createSplit, stripContent } from '../domain/layout'
import { containerWithDoc, createImage, createUntitledCard } from '../domain/content'
import { unknownAssetIds, usedAssetIds } from '../domain/commands'
import { newAssetId, newTemplateId } from '../domain/ids'
import { decodeBase64, realImageBase64 } from '../domain/testImages'
import { bytesToBlob } from './blob'
import { unzipSync, zipSync } from 'fflate'
import type { AssetRef, LayoutTemplate, Presentation } from '../domain/types'
import { contentAt, interactiveAt, sectionAt } from '../domain/testDecks'

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
      sectionAt(base, 0),
      {
        ...contentAt(base, 1),
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
