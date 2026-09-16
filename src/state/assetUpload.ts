/**
 * The editor's door into the asset store.
 *
 * Lives here rather than in the upload dialog for two reasons. The first is
 * that storing a file is not a rendering concern and never was. The second is
 * the one that matters: this is a security boundary — the same one
 * `upload_asset` and `create_svg_asset` stand behind — and a boundary buried in
 * a component's event handler can only be tested by driving a component.
 *
 * The whole policy is `domain/assetIngress.ts`, so a file the editor accepts is
 * exactly a file the agent API accepts, and the bytes that end up in the store
 * are the same bytes either way. Nothing here decides what an SVG may contain;
 * it only carries the verdict.
 *
 * Order matters, and it is: **validate, then persist.** A rejected file must
 * leave nothing behind — no blob in IndexedDB or Supabase Storage, no
 * `AssetRef` in the document, no half-placed picture in a zone — and the
 * cheapest way to guarantee that is to have written nothing when the rejection
 * happens. Registering the `AssetRef` in the document is the caller's next step
 * and a separate, undoable command; this only puts the bytes somewhere.
 */

import { acceptAsset } from '../domain/assetIngress'
import { hashBytes } from '../domain/assetHash'
import { MAX_ASSET_BYTES } from '../domain/constants'
import { newAssetId } from '../domain/ids'
import { err, ok, type Result } from '../domain/result'
import type { SvgSanitizeReport } from '../domain/svg'
import type { AssetRef, Presentation } from '../domain/types'
import { findIdenticalAsset } from '../persistence/assetDedupe'
import { blobToBytes, bytesToBlob } from '../persistence/blob'
import { repository } from '../persistence/activeRepository'
import { readImageSize } from './assets'

export interface UploadedAsset {
  ref: AssetRef
  /**
   * The presentation already held these exact bytes, so nothing was written
   * and `ref` is the file it already had. The dialog mentions it; the picture
   * is placed exactly as a new one would be.
   */
  reused: boolean
  /**
   * What the SVG sanitiser dropped, when anything was. The dialog says so: a
   * figure that comes back without its `<style>` block is never a silent
   * surprise, exactly as an agent is told through `sanitized`.
   */
  report?: SvgSanitizeReport
}

/**
 * Validate a picked file and, if it passes, store its bytes.
 *
 * The returned `AssetRef` describes what was actually written — the sanitised
 * length for an SVG, the sniffed MIME type rather than whatever the browser
 * called the file, and a size that came out of the file or out of the browser's
 * decoder, never out of a caller's parameter.
 */
export async function storeUploadedFile(
  presentation: Presentation,
  file: File,
): Promise<Result<UploadedAsset>> {
  // Before reading it: a file over the limit is refused without pulling it into
  // memory first. `acceptAsset` checks the same limit against what would
  // actually be stored, which for an SVG is not the same number.
  if (file.size > MAX_ASSET_BYTES) {
    return err('ASSET_TOO_LARGE', `Filen er for stor (maks ${megabytes(MAX_ASSET_BYTES)} MB).`, {
      byteSize: file.size,
      maxByteSize: MAX_ASSET_BYTES,
    })
  }

  const accepted = acceptAsset(await blobToBytes(file), { raster: 'caller' })
  if (!accepted.ok) return accepted

  const { bytes, mimeType, isVector, size, report } = accepted.value
  const blob = bytesToBlob(bytes, mimeType)
  // A raster file is stored as it arrived and sized by the browser, which is
  // the one runtime that can read an AVIF — see `RasterPolicy`. An SVG carries
  // the size its own document declares, read while it was being sanitised.
  const measured = size ?? (await readImageSize(blob))
  if (measured.width <= 0 || measured.height <= 0) {
    return err('INVALID_IMAGE', 'Bildefilen kunne ikke leses, så størrelsen er ukjent.')
  }

  // The same bytes already in this presentation are the same file, whatever
  // it was called this time: nothing is written, and the file it has is used.
  const hash = await hashBytes(bytes)
  const identical = await findIdenticalAsset(repository, presentation, { bytes, mimeType, hash })
  if (identical) return ok({ ref: identical.ref, reused: true, ...(report ? { report } : {}) })

  const ref: AssetRef = {
    id: newAssetId(),
    name: file.name,
    mimeType,
    byteSize: bytes.byteLength,
    width: measured.width,
    height: measured.height,
    isVector,
    contentHash: hash,
  }
  await repository.putAsset(presentation.id, ref, blob)
  return ok({ ref, reused: false, ...(report ? { report } : {}) })
}

/**
 * Take back files this session stored for a write that never happened.
 *
 * `storeUploadedFile` writes the bytes before anything points at them, which is
 * right for the ordinary case — one file, placed the moment it is stored — and
 * wrong for a batch that can still be refused halfway. A file that was stored
 * and never registered in the document is reachable by nothing: the deck does
 * not list it, so it is neither shown, exported nor counted, and
 * `deleteOrphanAssets` will not reclaim it either, because that only clears
 * rows whose *presentation* is gone. So the caller that stored it takes it
 * back.
 *
 * Only ids for files this call actually wrote may be passed. A file that was
 * reused (`UploadedAsset.reused`) was already the deck's before the batch
 * started, and deleting it would take a picture off a slide.
 *
 * Best effort by design: the bytes are already unreachable, so a failure here
 * leaves storage slightly fuller and nothing else. Reporting it would be asking
 * the user to act on something they cannot see and did not do.
 */
export async function discardUploadedAssets(assetIds: readonly string[]): Promise<void> {
  for (const id of assetIds) {
    try {
      await repository.deleteAsset(id)
    } catch {
      // See above: unreachable bytes, nothing for the user to do.
    }
  }
}

/** What the sanitiser dropped, as one sentence, or `null` when it dropped nothing. */
export function describeSanitizing(report: SvgSanitizeReport | undefined): string | null {
  if (!report) return null
  const removed = [
    ...report.removedElements.map((name) => `<${name}>`),
    ...report.removedAttributes,
  ]
  if (removed.length === 0) return null
  return `SVG-en ble lagret, men dette ble fjernet: ${removed.join(', ')}.`
}

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}
