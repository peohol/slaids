import { afterEach, describe, expect, it } from 'vitest'
import { SlaidsDatabase } from './db'
import { DexieSlaidsRepository } from './dexieRepository'
import { exportSlaidsArchive, importSlaidsArchive, suggestedFileName } from './backup'
import { createPresentation } from '../domain/presentation'
import { createLeaf, createSplit, stripContent } from '../domain/layout'
import { createContainer, createUntitledCard } from '../domain/content'
import { newAssetId, newTemplateId } from '../domain/ids'
import type { AssetRef, Presentation } from '../domain/types'

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
    expect(loaded.schemaVersion).toBe(1)
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
          root: createLeaf(createContainer({ type: 'asset', assetId: assetRef.id, fit: 'contain' })),
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
          root: createLeaf(createContainer({ type: 'asset', assetId: assetRef.id, fit: 'contain' })),
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
