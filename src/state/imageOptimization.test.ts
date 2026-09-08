/**
 * The optimiser against a real store, with the pixels faked.
 *
 * What is under test is the order things happen in and what is left behind at
 * every point where they can stop: a new file is stored before anything points
 * at it, the document is saved before anything is deleted, one file failing
 * fails that file alone, and an original is never gone while something still
 * shows it. The pixel work is a stand-in — a runtime without a canvas cannot
 * draw — that hands back a small real picture, which is all the rest needs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashBytes } from '../domain/assetHash'
import { containerWithDoc, createImage, imagePanelOf } from '../domain/content'
import { createLeaf, createSplit } from '../domain/layout'
import { createPresentation } from '../domain/presentation'
import { imageNode } from '../domain/richdoc'
import { contentAt, sectionAt } from '../domain/testDecks'
import { jpegWithExifOrientation, realImages } from '../domain/testImages'
import type { AssetRef, LayoutNode, Presentation, ZoneContent } from '../domain/types'
import { blobToBytes, bytesToBlob } from '../persistence/blob'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import type { SlaidsRepository } from '../persistence/repository'
import {
  StaleAnalysisError,
  analyzeImages,
  applyImageOptimization,
  hasChanges,
  reclaimReplacedAssets,
  type ImageAnalysis,
  type RasterProcessor,
} from './imageOptimization'
import type { RasterJob, RasterResult } from './imagePipeline'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshRepository(): DexieSlaidsRepository {
  counter += 1
  const database = new SlaidsDatabase(`slaids-optimize-${counter}`)
  databases.push(database)
  return new DexieSlaidsRepository(database)
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** A stand-in for a large photograph: bytes nothing decodes, sized like one. */
function bigFile(seed: number, size = 5000): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + seed) & 0xff
  return bytes
}

function ref(id: string, bytes: Uint8Array, extra: Partial<AssetRef> = {}): AssetRef {
  return {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    byteSize: bytes.byteLength,
    width: 4000,
    height: 3000,
    isVector: false,
    ...extra,
  }
}

function deckWith(root: LayoutNode, assets: AssetRef[], sandbox: ZoneContent[] = []): Presentation {
  const base = createPresentation({ title: 'Optimalisering' })
  return {
    ...base,
    assets,
    slides: [sectionAt(base, 0), { ...contentAt(base, 1), title: null, root }],
    sandbox: sandbox.map((content, index) => ({ id: `sb${index}`, content, createdAt: base.createdAt, note: '' })),
  }
}

/** A processor that answers every job with the small real PNG, and remembers the jobs. */
function fakeProcessor(answer: () => Uint8Array = () => realImages.png()): RasterProcessor & { jobs: RasterJob[] } {
  const jobs: RasterJob[] = []
  return {
    jobs,
    process: async (job): Promise<RasterResult> => {
      jobs.push(job)
      return {
        bytes: answer(),
        mimeType: 'image/png',
        width: 3,
        height: 2,
        traits: { hasAlpha: false, photographic: false, lossySource: job.lossySource },
      }
    },
    dispose: () => undefined,
  }
}

async function seed(
  repository: SlaidsRepository,
  presentation: Presentation,
  files: Record<string, Uint8Array>,
): Promise<void> {
  await repository.savePresentation(presentation)
  for (const asset of presentation.assets) {
    const bytes = files[asset.id]
    if (bytes) await repository.putAsset(presentation.id, asset, bytesToBlob(bytes, asset.mimeType))
  }
}

/**
 * Apply against a fake editor: the commit is remembered, the save succeeds
 * unless told otherwise, and `afterSave` behaves the way autosave's does —
 * queued work runs on the next write that lands, and is dropped if none ever
 * does. `saveWorks` lets a test end the outage and let the retry through.
 */
function editorFor(repository: SlaidsRepository, presentation: Presentation, saveResult = true) {
  let current: Presentation = presentation
  let works = saveResult
  const queued: (() => Promise<void>)[] = []

  const save = async (): Promise<boolean> => {
    if (!works) return false
    await repository.savePresentation(current)
    const tasks = queued.splice(0)
    for (const task of tasks) await task()
    return true
  }

  return {
    current: () => current,
    /** The store is well again; the next write lands, as autosave's retry would. */
    saveWorks: (value: boolean) => {
      works = value
    },
    /** What autosave does on a later change or flush. */
    retrySave: save,
    pending: () => queued.length,
    deps: {
      repository,
      current: () => current,
      commit: (next: Presentation) => {
        current = next
      },
      save,
      onceSaved: (task: () => Promise<void>) => {
        queued.push(task)
      },
    },
  }
}

function panelAssetIds(presentation: Presentation): (string | null)[] {
  const root = contentAt(presentation, 1).root
  const leaves = root.kind === 'split' ? root.children : [root]
  return leaves.map((leaf) =>
    leaf.kind === 'leaf' && leaf.content ? (imagePanelOf(leaf.content)?.assetId ?? null) : null,
  )
}

function optimizedOf(analysis: ImageAnalysis, assetId: string) {
  const item = analysis.items.find((entry) => entry.plan.ref.id === assetId)
  if (!item || item.outcome.kind !== 'optimized') throw new Error(`${assetId} ble ikke optimalisert`)
  return item.outcome
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

describe('analysing', () => {
  it('produces the result without writing anything, and reports what it would save', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(createLeaf(createImage('a_big')), [ref('a_big', original)])
    await seed(repository, deck, { a_big: original })
    const processor = fakeProcessor()
    const progress = vi.fn()

    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor, onProgress: progress })

    // A 4:3 file behind a wider frame: cropped, and far larger than needed.
    const outcome = optimizedOf(analysis, 'a_big')
    expect(outcome.operations).toEqual(['crop', 'downscale', 'metadata'])
    expect(outcome.before).toBe(original.byteLength)
    expect(outcome.after).toBe(realImages.png().byteLength)
    // The new reference describes the bytes that would be stored — size from
    // the bitstream, not from the plan — and a fresh id.
    expect(outcome.ref).toMatchObject({ mimeType: 'image/png', width: 3, height: 2, byteSize: outcome.after })
    expect(outcome.ref.id).not.toBe('a_big')
    expect(outcome.ref.contentHash).toBe(await hashBytes(realImages.png()))
    expect(analysis.summary).toMatchObject({
      before: original.byteLength,
      after: realImages.png().byteLength,
      cropped: 1,
      downscaled: 1,
      merged: 0,
      failed: 0,
    })
    expect(hasChanges(analysis)).toBe(true)
    expect(progress).toHaveBeenCalled()

    // The job carried the plan: the visible part of the file, at the frame's
    // size, from the bytes that were stored.
    expect(processor.jobs).toHaveLength(1)
    expect(processor.jobs[0].natural).toEqual({ width: 4000, height: 3000 })
    const { source } = processor.jobs[0]
    expect(source.width * source.height).toBeLessThan(4000 * 3000)

    // Nothing was written: the store still holds exactly what it did.
    expect((await repository.listAssets(deck.id)).map((asset) => asset.id)).toEqual(['a_big'])
    expect(await repository.loadPresentation(deck.id)).toEqual(deck)
  })

  it('leaves a vector file and an animated file alone, and keeps a file the redraw could not shrink', async () => {
    const repository = freshRepository()
    const still = realImages.gif()
    const header = still.subarray(0, 13 + 3 * 2)
    const image = still.subarray(header.length, still.length - 1)
    const animated = new Uint8Array([...header, ...image, ...image, 0x3b])
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')
    const tiny = bigFile(3, 40)
    const deck = deckWith(
      createSplit('x', [1, 1, 1], [
        createLeaf(createImage('a_svg')),
        createLeaf(createImage('a_gif')),
        createLeaf(createImage('a_tiny')),
      ]),
      [
        ref('a_svg', svg, { mimeType: 'image/svg+xml', isVector: true, name: 'fig.svg', width: 1, height: 1 }),
        ref('a_gif', animated, { mimeType: 'image/gif', name: 'anim.gif', width: 3, height: 2 }),
        ref('a_tiny', tiny),
      ],
    )
    await seed(repository, deck, { a_svg: svg, a_gif: animated, a_tiny: tiny })
    const processor = fakeProcessor()

    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor })
    const outcomes = Object.fromEntries(analysis.items.map((item) => [item.plan.ref.id, item.outcome]))
    expect(outcomes.a_svg).toEqual({ kind: 'optimal', reason: 'vector' })
    expect(outcomes.a_gif).toEqual({ kind: 'optimal', reason: 'animated' })
    // The redraw came back larger than the 40-byte original: not kept.
    expect(outcomes.a_tiny).toEqual({ kind: 'optimal', reason: 'no-gain' })
    expect(processor.jobs.map((job) => job.mimeType)).toEqual(['image/png'])
    expect(hasChanges(analysis)).toBe(false)
    expect(analysis.summary.optimal).toBe(3)
  })

  it('strips a lossy file\'s metadata without redrawing it when its pixels need no change', async () => {
    const repository = freshRepository()
    // Turned by its tag and carrying a comment; small enough that no frame
    // needs fewer pixels, and inline so nothing can crop it.
    const tagged = jpegWithExifOrientation(6)
    const comment = Array.from('Taken on holiday', (char) => char.charCodeAt(0))
    const photo = new Uint8Array([
      ...tagged.subarray(0, 2),
      0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff, ...comment,
      ...tagged.subarray(2),
    ])
    const inline = containerWithDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [imageNode('a_jpg', { widthPercent: 50, aspect: 2 / 3 })] }],
    })
    const deck = deckWith(createLeaf(inline), [
      ref('a_jpg', photo, { mimeType: 'image/jpeg', name: 'ferie.jpg', width: 2, height: 3 }),
    ])
    await seed(repository, deck, { a_jpg: photo })
    const processor = fakeProcessor()

    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor })
    const outcome = optimizedOf(analysis, 'a_jpg')
    expect(processor.jobs).toEqual([])
    expect(outcome.operations).toEqual(['metadata'])
    expect(outcome.ref).toMatchObject({ mimeType: 'image/jpeg', name: 'ferie.jpg', width: 2, height: 3 })
    expect(outcome.after).toBeLessThan(outcome.before)
  })

  it('names a file it could not process and carries on with the rest', async () => {
    const repository = freshRepository()
    const one = bigFile(1)
    const two = bigFile(2)
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_one')), createLeaf(createImage('a_two'))]),
      [ref('a_one', one), ref('a_two', two)],
    )
    await seed(repository, deck, { a_one: one, a_two: two })
    const processor: RasterProcessor = {
      process: async (job) => {
        if (job.bytes.byteLength === one.byteLength && job.bytes[0] === one[0]) {
          throw new Error('Dekoderen nektet.')
        }
        return fakeProcessor().process(job)
      },
      dispose: () => undefined,
    }

    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor })
    const outcomes = Object.fromEntries(analysis.items.map((item) => [item.plan.ref.id, item.outcome]))
    expect(outcomes.a_one).toEqual({ kind: 'failed', message: 'Dekoderen nektet.' })
    expect(outcomes.a_two.kind).toBe('optimized')
    expect(analysis.summary.failed).toBe(1)
  })

  it('merges files with identical bytes before planning, and records every file\'s hash', async () => {
    const repository = freshRepository()
    const bytes = bigFile(7)
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_first')), createLeaf(createImage('a_copy'))]),
      [ref('a_first', bytes), ref('a_copy', bytes, { name: 'a_first (2).png' })],
    )
    await seed(repository, deck, { a_first: bytes, a_copy: bytes })

    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    expect(analysis.duplicates.map((duplicate) => [duplicate.ref.id, duplicate.keptId])).toEqual([
      ['a_copy', 'a_first'],
    ])
    // The merged document shows the kept file in both frames — and so the plan
    // sees a shared file and crops it for neither.
    expect(panelAssetIds(analysis.presentation)).toEqual(['a_first', 'a_first'])
    expect(analysis.presentation.assets.map((asset) => asset.id)).toEqual(['a_first'])
    expect(analysis.presentation.assets[0].contentHash).toBe(await hashBytes(bytes))
    const plan = analysis.items.find((item) => item.plan.ref.id === 'a_first')!.plan
    expect(plan.mode).toBe('shared')
    expect(plan.raster?.crop).toBe(false)
    expect(analysis.summary.merged).toBe(1)
    expect(analysis.summary.after).toBeLessThan(analysis.summary.before)
  })

  it('never merges on a stale hash: same size and recorded hash, other stored bytes, stay two files', async () => {
    const repository = freshRepository()
    const bytes = bigFile(7)
    const other = bigFile(8)
    const staleHash = await hashBytes(bytes)
    // Both references vouch for `bytes`, on every count the document can check;
    // the store holds `other` behind the second.
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_first')), createLeaf(createImage('a_second'))]),
      [ref('a_first', bytes, { contentHash: staleHash }), ref('a_second', other, { contentHash: staleHash })],
    )
    await seed(repository, deck, { a_first: bytes, a_second: other })

    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    expect(analysis.duplicates).toEqual([])
    expect(analysis.summary.merged).toBe(0)
    expect(panelAssetIds(analysis.presentation)).toEqual(['a_first', 'a_second'])
    // The record is corrected from the bytes, never the bytes judged by the record.
    expect(Object.fromEntries(analysis.presentation.assets.map((asset) => [asset.id, asset.contentHash]))).toEqual({
      a_first: staleHash,
      a_second: await hashBytes(other),
    })

    // Applied, each frame still shows a file of its own: nothing was merged away
    // and deleted on the document's word.
    const report = await applyImageOptimization(analysis, editorFor(repository, deck).deps)
    expect(report.failed).toEqual([])
    const shown = panelAssetIds(await repository.loadPresentation(deck.id))
    expect(shown).toEqual([expect.any(String), expect.any(String)])
    expect(shown[0]).not.toBe(shown[1])
    expect((await repository.listAssets(deck.id)).map((asset) => asset.id).sort()).toEqual([...shown].sort())
  })

  it('merges on the stored bytes even when the recorded hashes disagree', async () => {
    const repository = freshRepository()
    const bytes = bigFile(7)
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_first')), createLeaf(createImage('a_copy'))]),
      [ref('a_first', bytes, { contentHash: '0'.repeat(64) }), ref('a_copy', bytes, { contentHash: 'f'.repeat(64) })],
    )
    await seed(repository, deck, { a_first: bytes, a_copy: bytes })

    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    expect(analysis.duplicates.map((duplicate) => [duplicate.ref.id, duplicate.keptId])).toEqual([
      ['a_copy', 'a_first'],
    ])
    expect(analysis.presentation.assets.map((asset) => asset.contentHash)).toEqual([await hashBytes(bytes)])
  })
})

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

describe('applying', () => {
  it('stores the new file, rewrites the document, saves it, and only then deletes the old file', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(createLeaf(createImage('a_big')), [ref('a_big', original)])
    await seed(repository, deck, { a_big: original })
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    const newId = optimizedOf(analysis, 'a_big').ref.id
    const editor = editorFor(repository, deck)

    const report = await applyImageOptimization(analysis, editor.deps)

    expect(report).toMatchObject({ replaced: 1, failed: [], saved: true, orphaned: [] })
    expect(report.savedBytes).toBe(original.byteLength - realImages.png().byteLength)

    const stored = await repository.loadPresentation(deck.id)
    expect(panelAssetIds(stored)).toEqual([newId])
    // A permanent crop leaves nothing to offset, so the crop is centred.
    const root = contentAt(stored, 1).root
    expect(root.kind === 'leaf' && root.content && imagePanelOf(root.content)?.focus).toEqual({ x: 0.5, y: 0.5 })
    expect(stored.assets.map((asset) => asset.id)).toEqual([newId])

    const newFile = await repository.getAsset(newId)
    expect(newFile).not.toBeNull()
    expect(await blobToBytes(newFile!.blob)).toEqual(realImages.png())
    expect(await repository.getAsset('a_big')).toBeNull()
  })

  it('keeps the original when the new file cannot be stored, and applies the rest', async () => {
    const repository = freshRepository()
    const one = bigFile(1)
    const two = bigFile(2)
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_one')), createLeaf(createImage('a_two'))]),
      [ref('a_one', one), ref('a_two', two)],
    )
    await seed(repository, deck, { a_one: one, a_two: two })
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    const refusedId = optimizedOf(analysis, 'a_one').ref.id
    const storedId = optimizedOf(analysis, 'a_two').ref.id

    const failing: SlaidsRepository = Object.create(repository, {
      putAsset: {
        value: async (presentationId: string, asset: AssetRef, blob: Blob) => {
          if (asset.id === refusedId) throw new Error('Lageret er fullt.')
          return repository.putAsset(presentationId, asset, blob)
        },
      },
    })
    const editor = editorFor(failing, deck)
    const report = await applyImageOptimization(analysis, editor.deps)

    expect(report.failed).toEqual([
      { ref: expect.objectContaining({ id: 'a_one' }), message: 'Lageret er fullt.' },
    ])
    expect(report.replaced).toBe(1)
    expect(report.saved).toBe(true)

    const stored = await repository.loadPresentation(deck.id)
    expect(panelAssetIds(stored)).toEqual(['a_one', storedId])
    expect(stored.assets.map((asset) => asset.id).sort()).toEqual(['a_one', storedId].sort())
    // The original that failed is exactly where it was; the one that succeeded is gone.
    expect(await repository.getAsset('a_one')).not.toBeNull()
    expect(await repository.getAsset('a_two')).toBeNull()
    expect(await repository.getAsset(refusedId)).toBeNull()
  })

  it('deletes nothing while the rewritten document has not been saved', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(createLeaf(createImage('a_big')), [ref('a_big', original)])
    await seed(repository, deck, { a_big: original })
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    const newId = optimizedOf(analysis, 'a_big').ref.id
    const editor = editorFor(repository, deck, false)

    const report = await applyImageOptimization(analysis, editor.deps)

    expect(report.saved).toBe(false)
    expect(report.savedBytes).toBe(0)
    // The editor holds the new document; the store still holds the old one and
    // every file either of them points at.
    expect(panelAssetIds(editor.current())).toEqual([newId])
    expect(panelAssetIds(await repository.loadPresentation(deck.id))).toEqual(['a_big'])
    expect(await repository.getAsset('a_big')).not.toBeNull()
    expect(await repository.getAsset(newId)).not.toBeNull()
  })

  it('deletes the replaced file when a later save lands, not only when the first one does', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(createLeaf(createImage('a_big')), [ref('a_big', original)])
    await seed(repository, deck, { a_big: original })
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    const newId = optimizedOf(analysis, 'a_big').ref.id
    const editor = editorFor(repository, deck, false)

    const report = await applyImageOptimization(analysis, editor.deps)
    expect(report.saved).toBe(false)
    // Not abandoned — waiting for the write that carries the rewrite.
    expect(report.deferred).toEqual(['a_big'])
    expect(await repository.getAsset('a_big')).not.toBeNull()

    // The trouble passes and autosave's retry gets through, exactly as it would
    // on the user's next keystroke.
    editor.saveWorks(true)
    expect(await editor.retrySave()).toBe(true)

    expect(panelAssetIds(await repository.loadPresentation(deck.id))).toEqual([newId])
    // The file the rewrite replaced does not outlive it.
    expect(await repository.getAsset('a_big')).toBeNull()
    expect(await repository.getAsset(newId)).not.toBeNull()
    expect((await repository.listAssets(deck.id)).map((asset) => asset.id)).toEqual([newId])
    expect(editor.pending()).toBe(0)
  })

  it('leaves the replaced file alone when the stored document still shows it', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(createLeaf(createImage('a_big')), [ref('a_big', original)])
    await seed(repository, deck, { a_big: original })
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    const editor = editorFor(repository, deck, false)
    await applyImageOptimization(analysis, editor.deps)

    // The editor was left with the write still pending, so the store never got
    // the rewrite. Running the deferred work anyway must not touch a file the
    // stored document is still showing.
    await reclaimReplacedAssets(repository, deck.id, ['a_big'])

    expect(panelAssetIds(await repository.loadPresentation(deck.id))).toEqual(['a_big'])
    expect(await repository.getAsset('a_big')).not.toBeNull()
  })

  it('keeps the files it cannot account for when the document cannot be read', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(createLeaf(createImage('a_big')), [ref('a_big', original)])
    await seed(repository, deck, { a_big: original })
    const unreadable: SlaidsRepository = Object.create(repository, {
      loadPresentation: {
        value: async () => {
          throw new Error('Ingen kontakt med lagringen.')
        },
      },
    })

    // Not knowing what the document says is a reason to keep a file, never to
    // delete one.
    expect(await reclaimReplacedAssets(unreadable, deck.id, ['a_big'])).toEqual(['a_big'])
    expect(await repository.getAsset('a_big')).not.toBeNull()
  })

  it('forks a shared file for one panel and leaves the original in place for the other', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_shared')), createLeaf(createImage('a_shared'))]),
      [ref('a_shared', original)],
    )
    await seed(repository, deck, { a_shared: original })
    const slide = contentAt(deck, 1)
    const left = (slide.root as { children: LayoutNode[] }).children[0]

    const analysis = await analyzeImages(
      deck,
      { kind: 'panel', slideId: slide.id, nodeId: left.id },
      { repository, processor: fakeProcessor() },
    )
    const forkId = optimizedOf(analysis, 'a_shared').ref.id
    const report = await applyImageOptimization(analysis, editorFor(repository, deck).deps)

    expect(report).toMatchObject({ replaced: 1, saved: true })
    const stored = await repository.loadPresentation(deck.id)
    expect(panelAssetIds(stored)).toEqual([forkId, 'a_shared'])
    expect(stored.assets.map((asset) => asset.id).sort()).toEqual([forkId, 'a_shared'].sort())
    expect(await repository.getAsset('a_shared')).not.toBeNull()
    expect(await repository.getAsset(forkId)).not.toBeNull()
  })

  it('replaces a shared file everywhere at once, sized by its largest use', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_shared')), createLeaf(createImage('a_shared'))]),
      [ref('a_shared', original)],
    )
    await seed(repository, deck, { a_shared: original })
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    const newId = optimizedOf(analysis, 'a_shared').ref.id
    expect(optimizedOf(analysis, 'a_shared').operations).toEqual(['downscale', 'metadata'])

    await applyImageOptimization(analysis, editorFor(repository, deck).deps)
    const stored = await repository.loadPresentation(deck.id)
    expect(panelAssetIds(stored)).toEqual([newId, newId])
    expect(stored.assets.map((asset) => asset.id)).toEqual([newId])
    expect(await repository.getAsset('a_shared')).toBeNull()
  })

  it('merges duplicates: one file kept, the copy\'s bytes gone once the document is saved', async () => {
    const repository = freshRepository()
    const bytes = bigFile(7, 60)
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_first')), createLeaf(createImage('a_copy'))]),
      [ref('a_first', bytes, { width: 3, height: 2 }), ref('a_copy', bytes, { width: 3, height: 2 })],
    )
    await seed(repository, deck, { a_first: bytes, a_copy: bytes })
    // Too small to be worth redrawing: the only change is the merge.
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    expect(hasChanges(analysis)).toBe(true)

    const report = await applyImageOptimization(analysis, editorFor(repository, deck).deps)
    expect(report).toMatchObject({ replaced: 1, saved: true, savedBytes: bytes.byteLength })
    const stored = await repository.loadPresentation(deck.id)
    expect(panelAssetIds(stored)).toEqual(['a_first', 'a_first'])
    expect(stored.assets.map((asset) => asset.id)).toEqual(['a_first'])
    expect(await repository.getAsset('a_copy')).toBeNull()
    expect(await repository.getAsset('a_first')).not.toBeNull()
  })

  it('refuses to apply an analysis to a document that has moved on', async () => {
    const repository = freshRepository()
    const original = bigFile(1)
    const deck = deckWith(createLeaf(createImage('a_big')), [ref('a_big', original)])
    await seed(repository, deck, { a_big: original })
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })

    const edited = { ...deck, title: 'Endret i mellomtiden' }
    const editor = editorFor(repository, edited)
    await expect(applyImageOptimization(analysis, editor.deps)).rejects.toBeInstanceOf(StaleAnalysisError)
    // And nothing happened: no new file, no deletion.
    expect((await repository.listAssets(deck.id)).map((asset) => asset.id)).toEqual(['a_big'])
  })

  it('applies nothing when there is nothing to apply', async () => {
    const repository = freshRepository()
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')
    const deck = deckWith(createLeaf(createImage('a_svg')), [
      ref('a_svg', svg, { mimeType: 'image/svg+xml', isVector: true, width: 1, height: 1 }),
    ])
    await seed(repository, deck, { a_svg: svg })
    const analysis = await analyzeImages(deck, { kind: 'all' }, { repository, processor: fakeProcessor() })
    const commit = vi.fn()
    const report = await applyImageOptimization(analysis, {
      repository,
      current: () => deck,
      commit,
      save: async () => true,
    })
    expect(report).toEqual({ replaced: 0, failed: [], saved: false, orphaned: [], deferred: [], savedBytes: 0 })
    expect(commit).not.toHaveBeenCalled()
  })
})
