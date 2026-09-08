/**
 * Optimising the pictures in a presentation, from analysis to stored files.
 *
 * Two halves, and the seam between them is the user's decision:
 *
 *  1. **`analyzeImages`** reads every file the scope covers, works out what
 *     each one would become — merged into an identical twin, cropped to what
 *     its frame shows, downscaled to what its uses need, re-encoded into a
 *     tighter container, stripped of its metadata — and *produces the result*,
 *     in memory. It writes nothing: not a file, not the document. What it
 *     hands back is exact — the bytes that would be stored and their size —
 *     because an estimate of a photograph's compressed size is a guess and the
 *     dialog should not present a guess as a saving.
 *  2. **`applyImageOptimization`** takes that analysis and makes it so, in an
 *     order that can be interrupted at any point without harm: the new files
 *     are stored first, under new ids; then the document is rewritten to point
 *     at them and committed; then, only once that document has been *saved*,
 *     the files nothing points at any more are deleted. A failure before the
 *     save leaves the stored document and its files exactly as they were. A
 *     failure after it leaves at worst a file nothing references, never a
 *     reference to a file that is gone.
 *
 * One file failing — a decoder that refuses it, a store that will not take the
 * result — fails that file alone. Every other file in the run is still
 * optimised, and the failure is reported by name.
 *
 * The pixel work happens in `imagePipeline.ts`, in a worker when the browser
 * has one, so a run over a deck of large photographs never freezes the editor.
 * The tests inject a `RasterProcessor` of their own instead, which is what keeps
 * this file testable in a runtime with no canvas.
 */

import { acceptAsset } from '../domain/assetIngress'
import { hashBytes } from '../domain/assetHash'
import { mergeDuplicateAssets, replaceAssetUses } from '../domain/commands'
import { newAssetId } from '../domain/ids'
import { rasterFacts, stripRasterMetadata } from '../domain/imageMetadata'
import {
  identityPlan,
  isWorthKeeping,
  planOptimization,
  renameForMimeType,
  type AssetPlan,
  type OptimizationScope,
  type RasterPlan,
} from '../domain/imageOptimization'
import { presentationRevision } from '../domain/revision'
import type { AssetRef, Presentation } from '../domain/types'
import { blobToBytes, bytesToBlob } from '../persistence/blob'
import type { SlaidsRepository, StoredAsset } from '../persistence/repository'
import { forgetCachedAsset, primeAssetCache } from './assets'
import type { RasterJob, RasterResult } from './imagePipeline'

/* ------------------------------------------------------------------ *
 * The processor
 * ------------------------------------------------------------------ */

/** Whatever turns a job into pixels: the worker, the main thread, or a test's stand-in. */
export interface RasterProcessor {
  process(job: RasterJob): Promise<RasterResult>
  /** Let go of whatever the processor holds — a worker, most likely. */
  dispose(): void
}

/**
 * The browser's processor: a worker when one can be started, the main thread
 * otherwise. Falling back is what keeps the feature working in a browser that
 * has canvases but no module workers; freezing for a moment beats refusing.
 */
export function createRasterProcessor(): RasterProcessor {
  if (typeof Worker !== 'undefined') {
    try {
      return workerProcessor(
        new Worker(new URL('./imageWorker.ts', import.meta.url), { type: 'module' }),
      )
    } catch {
      // No module workers here; the same code runs in the page instead.
    }
  }
  return inlineProcessor()
}

function inlineProcessor(): RasterProcessor {
  return {
    process: async (job) => (await import('./imagePipeline')).processRaster(job),
    dispose: () => undefined,
  }
}

function workerProcessor(worker: Worker): RasterProcessor {
  let next = 1
  const pending = new Map<
    number,
    { resolve: (result: RasterResult) => void; reject: (error: Error) => void }
  >()
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as
      | { id: number; ok: true; result: RasterResult }
      | { id: number; ok: false; message: string }
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.ok) waiting.resolve(message.result)
    else waiting.reject(new Error(message.message))
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Bildebehandlingen stoppet.')
    for (const waiting of pending.values()) waiting.reject(error)
    pending.clear()
  }
  return {
    process: (job) =>
      new Promise((resolve, reject) => {
        const id = next++
        pending.set(id, { resolve, reject })
        // The file's bytes move to the worker rather than being copied; the
        // caller has no further use for this copy of them.
        worker.postMessage({ id, job }, [job.bytes.buffer as ArrayBuffer])
      }),
    dispose: () => {
      worker.terminate()
      const error = new Error('Bildebehandlingen ble avbrutt.')
      for (const waiting of pending.values()) waiting.reject(error)
      pending.clear()
    },
  }
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

/** What was done to a file — the list the dialog shows. */
export type Operation = 'crop' | 'downscale' | 'recompress' | 'metadata'

export type ItemOutcome =
  /** A new file, ready to be stored, and what it saves. */
  | {
      kind: 'optimized'
      ref: AssetRef
      blob: Blob
      operations: Operation[]
      before: number
      after: number
    }
  /** Nothing to gain: the file is already what its uses need. */
  | { kind: 'optimal'; reason: 'vector' | 'animated' | 'no-gain' }
  /** This one file could not be processed. The rest of the run is unaffected. */
  | { kind: 'failed'; message: string }

export interface AnalysisItem {
  plan: AssetPlan
  outcome: ItemOutcome
}

export interface MergedDuplicate {
  /** The copy that goes. */
  ref: AssetRef
  /** The identical file that is kept. */
  keptId: string
}

export interface AnalysisSummary {
  /** Bytes of every file the scope covers, before and after. */
  before: number
  after: number
  cropped: number
  downscaled: number
  recompressed: number
  metadataStripped: number
  merged: number
  optimal: number
  failed: number
}

export interface ImageAnalysis {
  scope: OptimizationScope
  /** The document the analysis was made against — the one `apply` must find. */
  source: Presentation
  /** The document with duplicates merged and hashes recorded. In memory only. */
  presentation: Presentation
  duplicates: MergedDuplicate[]
  items: AnalysisItem[]
  summary: AnalysisSummary
}

export interface ProgressReport {
  phase: 'reading' | 'processing' | 'storing' | 'saving' | 'cleaning'
  done: number
  total: number
  /** The file being worked on, for the dialog to name. */
  name?: string
}

export interface AnalysisDependencies {
  repository: SlaidsRepository
  processor: RasterProcessor
  onProgress?: (progress: ProgressReport) => void
  signal?: AbortSignal
}

/**
 * Work out — and produce, in memory — everything the scope would become.
 *
 * Deduplication runs first and only over the whole deck: two files are the same
 * file when their bytes hash the same, whatever they were called, and merging
 * them before planning is what lets the plan see the merged file's *every* use
 * — a crop that was safe for a file shown once is not safe once its twin's
 * frame counts too.
 */
export async function analyzeImages(
  presentation: Presentation,
  scope: OptimizationScope,
  deps: AnalysisDependencies,
): Promise<ImageAnalysis> {
  const { repository, processor, signal } = deps
  const progress = deps.onProgress ?? (() => undefined)
  const stored = new Map<string, StoredAsset>()
  const read = async (ref: AssetRef): Promise<StoredAsset | null> => {
    const cached = stored.get(ref.id)
    if (cached) return cached
    const asset = await repository.getAsset(ref.id)
    if (asset) stored.set(ref.id, asset)
    return asset
  }

  // Step one: the files, and their identities.
  let working = presentation
  const duplicates: MergedDuplicate[] = []
  if (scope.kind === 'all') {
    const hashed = await hashAssets(presentation, read, (done, total, name) =>
      progress({ phase: 'reading', done, total, name }),
    )
    working = hashed.presentation
    const merged = mergeDuplicateAssets(working, hashed.replacements)
    if (merged.ok) {
      working = merged.value
      for (const [fromId, keptId] of hashed.replacements) {
        const ref = presentation.assets.find((asset) => asset.id === fromId)
        if (ref) duplicates.push({ ref, keptId })
      }
    }
  }

  // Step two: what each remaining file would become.
  const plans = planOptimization(working, scope)
  const items: AnalysisItem[] = []
  for (const [index, plan] of plans.entries()) {
    throwIfAborted(signal)
    progress({ phase: 'processing', done: index, total: plans.length, name: plan.ref.name })
    items.push({ plan, outcome: await analyzeAsset(plan, read, processor) })
  }
  progress({ phase: 'processing', done: plans.length, total: plans.length })

  return {
    scope,
    source: presentation,
    presentation: working,
    duplicates,
    items,
    summary: summarize(presentation, scope, duplicates, items),
  }
}

/**
 * Which files are copies of which, and every candidate's hash recorded on its
 * reference.
 *
 * Only a file that *could* be a copy is read: a copy is exactly as long as its
 * original and served under the same type, so a file alone in its size-and-type
 * class is nobody's twin and costs no download. Among the candidates, a hash
 * already on the reference is trusted when the stored size still matches it;
 * anything else is computed from the bytes.
 */
async function hashAssets(
  presentation: Presentation,
  read: (ref: AssetRef) => Promise<StoredAsset | null>,
  report: (done: number, total: number, name: string) => void,
): Promise<{ presentation: Presentation; replacements: Map<string, string> }> {
  const classOf = (ref: AssetRef): string => `${ref.mimeType}:${ref.byteSize}`
  const classSizes = new Map<string, number>()
  for (const ref of presentation.assets) {
    classSizes.set(classOf(ref), (classSizes.get(classOf(ref)) ?? 0) + 1)
  }

  const firstByHash = new Map<string, string>()
  const replacements = new Map<string, string>()
  const assets: AssetRef[] = []
  for (const [index, ref] of presentation.assets.entries()) {
    if ((classSizes.get(classOf(ref)) ?? 0) < 2) {
      assets.push(ref)
      continue
    }
    report(index, presentation.assets.length, ref.name)
    const asset = await read(ref)
    if (!asset) {
      // A file the store no longer has cannot be a copy of anything, and its
      // reference is kept as it was: dropping it is not this run's business.
      assets.push(ref)
      continue
    }
    const hash =
      ref.contentHash && asset.blob.size === ref.byteSize
        ? ref.contentHash
        : await hashBytes(await blobToBytes(asset.blob))
    // Identity is the bytes, and only the bytes: a PNG and an SVG cannot hash
    // the same, and two files that do are one file.
    const kept = firstByHash.get(hash)
    if (kept) replacements.set(ref.id, kept)
    else firstByHash.set(hash, ref.id)
    assets.push(ref.contentHash === hash ? ref : { ...ref, contentHash: hash })
  }
  return { presentation: { ...presentation, assets }, replacements }
}

/** One file, taken through the pipeline and judged. Never throws. */
async function analyzeAsset(
  plan: AssetPlan,
  read: (ref: AssetRef) => Promise<StoredAsset | null>,
  processor: RasterProcessor,
): Promise<ItemOutcome> {
  if (!plan.raster) return { kind: 'optimal', reason: 'vector' }
  const { ref } = plan
  try {
    const asset = await read(ref)
    if (!asset) return { kind: 'failed', message: 'Filen finnes ikke i lagringen.' }
    const bytes = await blobToBytes(asset.blob)
    const original = bytes.byteLength
    const facts = rasterFacts(bytes, ref.mimeType)
    if (facts.animated) return { kind: 'optimal', reason: 'animated' }

    const pixelsChange = plan.raster.crop || plan.raster.downscale
    // A file that came through a lossy codec is only redrawn when its pixels
    // change anyway: re-encoding the same pixels lossily would cost a
    // generation of artefacts for bytes, and losslessly would gain none.
    if (pixelsChange || !facts.lossy) {
      const redrawn = await redraw(ref, bytes, plan.raster, facts.lossy, processor)
      if (redrawn && isWorthKeeping(original, redrawn.bytes.byteLength, pixelsChange)) {
        // «Compressed differently» is what the dialog says when the container
        // changed, when lossy pixels went through a lossy codec again, or when
        // the same pixels were re-encoded for the bytes alone.
        const recompressed = redrawn.mimeType !== ref.mimeType || facts.lossy || !pixelsChange
        return optimized(ref, redrawn, plan.raster, original, recompressed)
      }
      // A crop or a downscale that came back no smaller is a result nobody
      // asked for; the metadata alone may still be worth dropping.
    }

    const stripped = stripRasterMetadata(bytes, ref.mimeType)
    if (stripped) {
      const accepted = acceptAsset(stripped, { raster: 'bitstream' })
      if (accepted.ok) {
        return optimized(
          ref,
          { bytes: accepted.value.bytes, mimeType: accepted.value.mimeType, ...accepted.value.size },
          identityPlan(ref),
          original,
          false,
        )
      }
    }
    return { kind: 'optimal', reason: 'no-gain' }
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Bildet kunne ikke behandles.',
    }
  }
}

interface Redrawn {
  bytes: Uint8Array
  mimeType: string
  width: number
  height: number
}

/**
 * The file through the pipeline, and the result validated at the same door
 * every stored file passes: a complete bitstream, with its size read out of
 * it rather than out of the plan. `null` when the browser could not encode
 * anything usable.
 */
async function redraw(
  ref: AssetRef,
  bytes: Uint8Array,
  raster: RasterPlan,
  lossySource: boolean,
  processor: RasterProcessor,
): Promise<Redrawn | null> {
  const result = await processor.process({
    // A copy: the processor may transfer the buffer away, and the original
    // bytes are still needed for the metadata fallback.
    bytes: bytes.slice(),
    mimeType: ref.mimeType,
    natural: { width: ref.width, height: ref.height },
    source: raster.source,
    target: raster.target,
    lossySource,
  })
  const accepted = acceptAsset(result.bytes, { raster: 'bitstream' })
  if (!accepted.ok) return null
  return {
    bytes: accepted.value.bytes,
    mimeType: accepted.value.mimeType,
    ...accepted.value.size,
  }
}

async function optimized(
  ref: AssetRef,
  result: Redrawn,
  raster: RasterPlan,
  before: number,
  recompressed: boolean,
): Promise<ItemOutcome> {
  const operations: Operation[] = []
  if (raster.crop) operations.push('crop')
  if (raster.downscale) operations.push('downscale')
  if (recompressed) operations.push('recompress')
  operations.push('metadata')
  const next: AssetRef = {
    id: newAssetId(),
    name: renameForMimeType(ref.name, result.mimeType),
    mimeType: result.mimeType,
    byteSize: result.bytes.byteLength,
    width: result.width,
    height: result.height,
    isVector: false,
    contentHash: await hashBytes(result.bytes),
  }
  return {
    kind: 'optimized',
    ref: next,
    blob: bytesToBlob(result.bytes, result.mimeType),
    operations,
    before,
    after: result.bytes.byteLength,
  }
}

function summarize(
  presentation: Presentation,
  scope: OptimizationScope,
  duplicates: MergedDuplicate[],
  items: AnalysisItem[],
): AnalysisSummary {
  const covered =
    scope.kind === 'all'
      ? presentation.assets
      : items.map((item) => item.plan.ref)
  const before = covered.reduce((sum, ref) => sum + ref.byteSize, 0)
  let saved = duplicates.reduce((sum, duplicate) => sum + duplicate.ref.byteSize, 0)
  const summary: AnalysisSummary = {
    before,
    after: before,
    cropped: 0,
    downscaled: 0,
    recompressed: 0,
    metadataStripped: 0,
    merged: duplicates.length,
    optimal: 0,
    failed: 0,
  }
  for (const { outcome } of items) {
    if (outcome.kind === 'optimal') summary.optimal += 1
    else if (outcome.kind === 'failed') summary.failed += 1
    else {
      saved += outcome.before - outcome.after
      if (outcome.operations.includes('crop')) summary.cropped += 1
      if (outcome.operations.includes('downscale')) summary.downscaled += 1
      if (outcome.operations.includes('recompress')) summary.recompressed += 1
      if (outcome.operations.includes('metadata')) summary.metadataStripped += 1
    }
  }
  summary.after = Math.max(0, before - saved)
  return summary
}

/** Whether applying the analysis would change anything at all. */
export function hasChanges(analysis: ImageAnalysis): boolean {
  return (
    analysis.duplicates.length > 0 ||
    analysis.items.some((item) => item.outcome.kind === 'optimized')
  )
}

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

export interface ApplyDependencies {
  repository: SlaidsRepository
  /**
   * The document as the editor holds it right now. The analysis was made
   * against a particular document, and is applied only to that one: a crop
   * moved since the analysis would otherwise be cut where it used to be.
   */
  current: () => Presentation | null
  /** Put the rewritten document in the editor. Irreversible; see the store. */
  commit: (presentation: Presentation) => void
  /** Store the committed document. Resolves `true` once it is stored. */
  save: () => Promise<boolean>
  onProgress?: (progress: ProgressReport) => void
}

export interface ApplyReport {
  /** Files that were replaced or merged away, and are gone from the store. */
  replaced: number
  /** Files whose new version could not be stored; their originals stand. */
  failed: { ref: AssetRef; message: string }[]
  /** Whether the rewritten document reached the store. */
  saved: boolean
  /** Old files that could not be deleted after the save. Orphans, never holes. */
  orphaned: string[]
  /** Bytes gone from the store, counting only what actually happened. */
  savedBytes: number
}

export class StaleAnalysisError extends Error {
  constructor() {
    super('Presentasjonen er endret siden analysen ble gjort. Analyser bildene på nytt.')
    this.name = 'StaleAnalysisError'
  }
}

/**
 * Make the analysis so. See the module comment for the order and why.
 *
 * Returns rather than throws for everything that can go wrong with one file;
 * throws only when nothing at all can be done — the document moved on, or the
 * commit itself was refused.
 */
export async function applyImageOptimization(
  analysis: ImageAnalysis,
  deps: ApplyDependencies,
): Promise<ApplyReport> {
  const { repository } = deps
  const progress = deps.onProgress ?? (() => undefined)
  const live = deps.current()
  if (!live || presentationRevision(live) !== presentationRevision(analysis.source)) {
    throw new StaleAnalysisError()
  }

  const report: ApplyReport = { replaced: 0, failed: [], saved: false, orphaned: [], savedBytes: 0 }
  const presentationId = analysis.source.id

  // 1. Store every new file, under a new id. Nothing references them yet, so a
  //    failure here has nothing to undo but the file itself.
  const stored: { item: AnalysisItem; ref: AssetRef; blob: Blob }[] = []
  const optimizedItems = analysis.items.filter((item) => item.outcome.kind === 'optimized')
  for (const [index, item] of optimizedItems.entries()) {
    if (item.outcome.kind !== 'optimized') continue
    progress({ phase: 'storing', done: index, total: optimizedItems.length, name: item.plan.ref.name })
    try {
      await repository.putAsset(presentationId, item.outcome.ref, item.outcome.blob)
      stored.push({ item, ref: item.outcome.ref, blob: item.outcome.blob })
    } catch (error) {
      report.failed.push({
        ref: item.plan.ref,
        message: error instanceof Error ? error.message : 'Kunne ikke lagre den nye filen.',
      })
    }
  }

  // 2. Rewrite the document: every stored file takes its original's place.
  let next = analysis.presentation
  const toDelete: string[] = analysis.duplicates.map((duplicate) => duplicate.ref.id)
  let savedBytes = analysis.duplicates.reduce((sum, duplicate) => sum + duplicate.ref.byteSize, 0)
  for (const entry of stored) {
    const { plan } = entry.item
    const replaced = replaceAssetUses(next, {
      fromId: plan.ref.id,
      to: entry.ref,
      only: plan.only ?? undefined,
      recentre: plan.raster?.crop ?? false,
    })
    if (!replaced.ok) {
      // The document would not take it: the stored file is unreferenced, so it
      // goes straight back out, and the original stands.
      await discard(repository, entry.ref.id)
      report.failed.push({ ref: plan.ref, message: replaced.error.message })
      continue
    }
    next = replaced.value
    primeAssetCache(entry.ref.id, { ref: entry.ref, blob: entry.blob })
    if (entry.item.outcome.kind === 'optimized') {
      savedBytes += entry.item.outcome.before - entry.item.outcome.after
    }
    report.replaced += 1
    // A fork leaves the original in use; a replacement leaves it referenced by
    // nothing, which is when — and only when — its bytes may go.
    if (!next.assets.some((asset) => asset.id === plan.ref.id)) toDelete.push(plan.ref.id)
  }
  report.replaced += analysis.duplicates.length

  if (next === analysis.presentation && analysis.duplicates.length === 0) {
    // Nothing landed. The document is untouched and there is nothing to save.
    return report
  }

  // 3. Commit and save. The old files are still there, so a save that does not
  //    land leaves the stored document consistent with the stored files.
  deps.commit(next)
  progress({ phase: 'saving', done: 0, total: 1 })
  report.saved = await deps.save()
  if (!report.saved) return report

  // 4. Only now are the old files unreferenced by anything stored anywhere.
  for (const [index, id] of toDelete.entries()) {
    progress({ phase: 'cleaning', done: index, total: toDelete.length })
    forgetCachedAsset(id)
    if (!(await discard(repository, id))) report.orphaned.push(id)
  }
  report.savedBytes = savedBytes
  return report
}

/** Remove a file's bytes, best effort. `true` when they are gone. */
async function discard(repository: SlaidsRepository, id: string): Promise<boolean> {
  try {
    return await repository.deleteAsset(id)
  } catch {
    return false
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Analysen ble avbrutt.')
}
