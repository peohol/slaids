/**
 * One door into the asset store.
 *
 * A file becomes an asset through several routes — the editor's upload dialog,
 * `upload_asset`, `create_svg_asset`, a `.slaids` backup — and every one of
 * them ends with the same bytes in the same store, shown by the same renderer.
 * So which route a file took must not decide what Slaids accepts or what it
 * stores. This module is where that is decided, once, for all of them.
 *
 * It answers two questions and nothing else:
 *
 *  1. **What is this, really?** The format comes from the bytes
 *     (`imageBytes.ts`), never from a file name, a `File.type` or a caller's
 *     word. A `.png` holding `<svg>` markup is an SVG, and a `.svg` holding PNG
 *     bytes is a PNG — and the second one matters just as much as the first:
 *     what makes a stored file active content is the MIME type it is served
 *     with, so that type is always the sniffer's answer.
 *  2. **What may be stored?** Two validators, one per kind of content, and the
 *     split is the point rather than an accident:
 *       - **raster** → `imageFile.ts`, which walks the file end to end and
 *         reads its size out of the bitstream;
 *       - **SVG** → `domain/svg.ts`, which parses it against an allowlist and
 *         hands back re-serialised markup.
 *     What comes back in `bytes` is what must be stored. For an SVG that is the
 *     sanitised re-serialisation and never the input, which is the whole reason
 *     this is a function that returns bytes rather than a predicate that
 *     returns a verdict: a caller cannot forget to use the clean version if the
 *     clean version is the only one it is handed.
 *
 * The invariant, stated plainly: **an SVG from outside Slaids can never reach
 * the asset store without having been parsed and sanitised by
 * `src/domain/svg.ts`.** Nothing may carry `image/svg+xml` that did not come
 * out of `sanitizeSvg`.
 *
 * Internal copies are the deliberate exception, and they are not a hole: paste
 * across presentations (`state/pasteAssets.ts`) and duplication
 * (`persistence/library.ts`) move bytes that already came through here, from
 * one Slaids store to another. Re-validating them would buy nothing and would
 * mean a file that was legal when it was stored could become unopenable later.
 */

import { MAX_ASSET_BYTES } from './constants'
import { probeImageFormat } from './imageBytes'
import { readRasterImage } from './imageFile'
import { err, ok, type Result } from './result'
import { sanitizeSvg, SVG_MIME_TYPE, type SvgSanitizeReport } from './svg'

export interface AssetSize {
  width: number
  height: number
}

export interface AcceptedAsset {
  /** Exactly what must be stored: sanitised markup for SVG, the file itself otherwise. */
  bytes: Uint8Array
  /** From the bytes. The type the blob is stored and served under. */
  mimeType: string
  isVector: boolean
  /**
   * The size the picture is drawn at, out of the file itself.
   *
   * `null` only under `raster: 'caller'`, and only for raster — a door that
   * already has the size from a source of its own. An SVG always carries one,
   * because a document with no intrinsic ratio is refused outright.
   */
  size: AssetSize | null
  /** What the SVG sanitiser dropped. Present exactly when `isVector`. */
  report?: SvgSanitizeReport
}

/**
 * What a headless door gets back: the size is always there.
 *
 * `'bitstream'` reads it out of the file for a raster and out of the document
 * for an SVG, and refuses anything it cannot read one from — so the caller has
 * no unmeasured case to handle, and no reason to invent a size for one.
 */
export type MeasuredAsset = AcceptedAsset & { size: AssetSize }

/**
 * How a door validates the *raster* half. The SVG half never varies.
 *
 *  - `'bitstream'` — `imageFile.ts` walks the whole file and the size comes out
 *    of it. Any door with nothing but the bytes: `upload_asset`,
 *    `create_svg_asset`, and anything else headless.
 *  - `'caller'` — the bytes are kept as they are and the size comes from a
 *    source the door already has. Two doors qualify, for the same reason:
 *    somebody else has already decoded this picture. The editor has the
 *    browser, which is the one runtime that can read an AVIF's size — that is
 *    why the editor takes AVIF and the agent path does not — and a `.slaids`
 *    backup carries the size that was read when the file was first stored, at
 *    whichever of these doors it came through.
 *
 * The distinction is only ever about measuring. Neither mode lets a byte of
 * unsanitised SVG past, and both use the same list of formats.
 */
export type RasterPolicy = 'bitstream' | 'caller'

export interface AcceptAssetOptions {
  raster: RasterPolicy
  /**
   * The caller already said this is SVG.
   *
   * Changes nothing about what is stored — only what a caller is told when the
   * bytes turn out to be something else: `create_svg_asset` deserves "this is
   * not valid SVG", not "unknown file type".
   */
  expect?: 'vector'
}

/**
 * Take a file at the door: validate it, and hand back what to store.
 *
 * Fails with the domain's own codes, so every door reports the same rejection
 * for the same file: `UNSAFE_SVG` for markup that would run or fetch something,
 * `INVALID_SVG` for markup that is not a usable SVG, `INVALID_IMAGE` for a
 * raster file that is truncated or corrupt, `UNSUPPORTED_MEDIA_TYPE` for bytes
 * that are not a format Slaids stores, and `ASSET_TOO_LARGE` for a file over
 * the limit.
 */
export function acceptAsset(
  input: Uint8Array,
  options: AcceptAssetOptions & { raster: 'bitstream' },
): Result<MeasuredAsset>
export function acceptAsset(input: Uint8Array, options: AcceptAssetOptions): Result<AcceptedAsset>
export function acceptAsset(
  input: Uint8Array,
  options: AcceptAssetOptions,
): Result<AcceptedAsset> {
  if (input.byteLength === 0) return err('INVALID_ARGUMENT', 'Filen er tom.')

  const oversized = tooLarge(input)
  if (oversized) return oversized

  const wantsVector = options.expect === 'vector'
  const format = probeImageFormat(input)
  if (!format || (wantsVector && format.mimeType !== SVG_MIME_TYPE)) {
    return wantsVector
      ? err('INVALID_SVG', 'Innholdet er ikke SVG-markup med <svg> som rotelement.')
      : err(
          'UNSUPPORTED_MEDIA_TYPE',
          'Innholdet er ikke et bildeformat Slaids kan vise. Bruk PNG, JPEG, GIF, WEBP eller SVG.',
        )
  }

  if (format.mimeType === SVG_MIME_TYPE) return acceptSvg(input)

  if (options.raster === 'caller') {
    return ok({ bytes: input, mimeType: format.mimeType, isVector: false, size: null })
  }

  const raster = readRasterImage(input)
  if (!raster.ok) return raster
  return ok({
    bytes: input,
    mimeType: raster.value.mimeType,
    isVector: false,
    size: { width: raster.value.width, height: raster.value.height },
  })
}

function acceptSvg(input: Uint8Array): Result<AcceptedAsset> {
  // `TextDecoder` drops a UTF-8 byte order mark, which is a byte and not a
  // character, so the parser never sees one in front of the root element.
  const clean = sanitizeSvg(new TextDecoder().decode(input))
  if (!clean.ok) return clean

  const bytes = new TextEncoder().encode(clean.value.markup)
  // Re-serialising can grow the file — every `&` in the source comes back as
  // `&amp;` — so the limit is checked again on what is actually stored, not
  // only on what arrived.
  const grewTooLarge = tooLarge(bytes)
  if (grewTooLarge) return grewTooLarge

  return ok({
    bytes,
    mimeType: SVG_MIME_TYPE,
    isVector: true,
    size: { width: clean.value.width, height: clean.value.height },
    report: clean.value.report,
  })
}

/**
 * How big a picture may be is a property of the product, so it is checked here
 * rather than at each door — where one door would eventually have a different
 * number from the next.
 */
function tooLarge(bytes: Uint8Array): Result<AcceptedAsset> | null {
  if (bytes.byteLength <= MAX_ASSET_BYTES) return null
  return err('ASSET_TOO_LARGE', `Filen er for stor (maks ${MAX_ASSET_BYTES} byte).`, {
    byteSize: bytes.byteLength,
    maxByteSize: MAX_ASSET_BYTES,
  })
}
