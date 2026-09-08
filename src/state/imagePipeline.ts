/**
 * The pixel half of the optimiser: decode, crop, scale, look, encode.
 *
 * Everything that has to touch actual pixels lives here and nowhere else, and
 * it runs wherever a canvas exists — inside the worker `imageWorker.ts` starts,
 * and on the main thread when a browser has no worker to give us. The *plan*
 * it carries out comes from `domain/imageOptimization.ts`, and the decisions it
 * hands back to — which container, whether the result is worth keeping — are
 * that module's too. This file only does what it is told and reports what it
 * saw.
 *
 * Why the browser, and why a canvas: the browser already has a hardware-backed
 * decoder for every format Slaids stores — including AVIF, which nothing in the
 * Node bundle can read — and re-drawing through a canvas is what strips a file
 * of everything that is not its pixels: Exif and the GPS fix in it, the
 * embedded thumbnail, XMP, comments. What the decoder applies on the way in —
 * the Exif orientation, the colour profile — is applied to the pixels, so the
 * output needs no tag to look the same. Nothing is uploaded to be processed
 * and nothing is downloaded back; the bytes never leave the machine.
 */

import { rasterFacts } from '../domain/imageMetadata'
import { encodingChoices, isPhotographic, type PictureTraits } from '../domain/imageOptimization'
import type { Size } from '../domain/geometry'
import type { Rect } from '../domain/types'

/** One file, and what to draw of it. */
export interface RasterJob {
  bytes: Uint8Array
  mimeType: string
  /** The size the document believes the file is — the plan's coordinate space. */
  natural: Size
  /** The part to keep, in `natural` pixels. Fractional where the frame is. */
  source: Rect
  /** The size to draw it at. Never larger than `source`. */
  target: Size
  /** The pixels came through a lossy codec; see `PictureTraits`. */
  lossySource: boolean
}

export interface RasterResult {
  bytes: Uint8Array
  mimeType: string
  width: number
  height: number
  /** What was read off the pixels before the container was chosen. */
  traits: PictureTraits
}

/**
 * How many pixels a sample reads to decide whether a picture is a photograph.
 * Spread evenly over the picture; enough to be stable, few enough to be free.
 */
const SAMPLE_BUDGET = 50_000

/**
 * Below this ratio between what is drawn from and what is drawn to, one draw is
 * enough; above it the picture is halved in steps first. A single draw over a
 * large ratio skips most of the source pixels, and the result shimmers where a
 * halving chain would have averaged them.
 */
const MAX_SINGLE_STEP_RATIO = 2

type Canvas = OffscreenCanvas | HTMLCanvasElement
type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/**
 * Decode, draw and encode one file according to its job.
 *
 * Throws when the browser cannot decode the file or cannot encode the result at
 * all; the caller treats either as "this file could not be optimised" and
 * leaves the original exactly as it is.
 */
export async function processRaster(job: RasterJob): Promise<RasterResult> {
  const bitmap = await decode(job)
  try {
    const { canvas, context } = draw(bitmap, job)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    const traits: PictureTraits = {
      hasAlpha: hasTransparentPixel(pixels),
      photographic: isPhotographic(samplePixels(pixels)),
      lossySource: job.lossySource,
    }
    const encoded = await encodeSmallest(canvas, traits)
    return { ...encoded, width: canvas.width, height: canvas.height, traits }
  } finally {
    bitmap.close()
  }
}

/**
 * The file as the browser draws it: turned the way its orientation tag says,
 * converted to the colour space the screen is in.
 *
 * Both options are the defaults every renderer applies, spelled out so the
 * output is what the slide showed. A browser that does not know the options
 * gets asked without them, which is the same request with its own defaults.
 */
async function decode(job: RasterJob): Promise<ImageBitmap> {
  const blob = new Blob([job.bytes.slice().buffer as ArrayBuffer], { type: job.mimeType })
  try {
    return await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      colorSpaceConversion: 'default',
      premultiplyAlpha: 'default',
    })
  } catch {
    return createImageBitmap(blob)
  }
}

/**
 * The kept part of the file, at the target size, on a canvas.
 *
 * The plan was made against the size the document recorded for the file; if
 * the decoder disagrees — a stale record, a browser that reads the orientation
 * differently — the source rectangle is mapped into the decoder's space rather
 * than trusted blindly, so a crop lands on the same part of the picture.
 *
 * A large downscale is done in halvings: each step draws the previous one at
 * half its size until one more halving would undershoot the target, and the
 * final draw lands on the exact size. Every step averages the pixels it
 * leaves behind, which one draw over the whole ratio would simply skip.
 */
function draw(bitmap: ImageBitmap, job: RasterJob): { canvas: Canvas; context: Context } {
  const scaleX = bitmap.width / job.natural.width
  const scaleY = bitmap.height / job.natural.height
  let sx = job.source.x * scaleX
  let sy = job.source.y * scaleY
  let sw = job.source.width * scaleX
  let sh = job.source.height * scaleY
  let current: CanvasImageSource = bitmap
  let step: Canvas | null = null

  const { width, height } = job.target
  while (sw / width > MAX_SINGLE_STEP_RATIO && sh / height > MAX_SINGLE_STEP_RATIO) {
    const halfWidth = Math.max(width, Math.round(sw / 2))
    const halfHeight = Math.max(height, Math.round(sh / 2))
    const half = makeCanvas(halfWidth, halfHeight)
    half.context.drawImage(current, sx, sy, sw, sh, 0, 0, halfWidth, halfHeight)
    current = half.canvas
    step = half.canvas
    sx = 0
    sy = 0
    sw = halfWidth
    sh = halfHeight
  }

  const final = makeCanvas(width, height)
  final.context.drawImage(current, sx, sy, sw, sh, 0, 0, width, height)
  release(step)
  return final
}

function makeCanvas(width: number, height: number): { canvas: Canvas; context: Context } {
  const canvas: Canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
  const context = canvas.getContext('2d') as Context | null
  if (!context) throw new Error('Nettleseren kunne ikke lage en tegneflate for bildet.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

/** Let a canvas's memory go as soon as it has been drawn from. */
function release(canvas: Canvas | null): void {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}

/* ------------------------------------------------------------------ *
 * Looking at the pixels
 * ------------------------------------------------------------------ */

function hasTransparentPixel(pixels: ImageData): boolean {
  const { data } = pixels
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true
  return false
}

/**
 * The two numbers `isPhotographic` judges: how flat the picture is, and how
 * many colours it uses. Read on a grid so a large picture costs the same as a
 * small one.
 *
 * A pixel is flat when it is identical to the pixel on its right *and* the one
 * below it — the signature of a fill, a background, a run of the same colour.
 * Both neighbours, because a gradient is identical along one axis and not the
 * other, and a gradient is not flat: it is exactly the kind of area a lossy
 * codec handles well and a lossless one does not.
 */
export function samplePixels(pixels: ImageData): { flatFraction: number; distinctFraction: number } {
  const { width, height, data } = pixels
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / SAMPLE_BUDGET)))
  const colours = new Set<number>()
  let samples = 0
  let flat = 0
  const same = (a: number, b: number): boolean =>
    data[a] === data[b] &&
    data[a + 1] === data[b + 1] &&
    data[a + 2] === data[b + 2] &&
    data[a + 3] === data[b + 3]
  for (let y = 0; y + 1 < height; y += stride) {
    for (let x = 0; x + 1 < width; x += stride) {
      const at = (y * width + x) * 4
      colours.add((data[at] << 16) | (data[at + 1] << 8) | data[at + 2])
      samples += 1
      if (same(at, at + 4) && same(at, at + width * 4)) flat += 1
    }
  }
  const counted = Math.max(1, samples)
  return { flatFraction: flat / counted, distinctFraction: colours.size / counted }
}

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

let webpSupport: Promise<boolean> | null = null

/**
 * Whether this browser can *write* WebP. Every browser Slaids runs in reads it;
 * not every one encodes it, and one that cannot quietly hands back a PNG under
 * the type asked for. So it is asked once, with a one-pixel canvas, and the
 * answer is what the returned blob says it is.
 */
export function canEncodeWebp(): Promise<boolean> {
  webpSupport ??= (async () => {
    try {
      const { canvas } = makeCanvas(1, 1)
      const blob = await encode(canvas, 'image/webp', 0.8)
      return blob.type === 'image/webp'
    } catch {
      return false
    }
  })()
  return webpSupport
}

/**
 * Every container the traits allow, encoded, and the smallest kept.
 *
 * Two things a browser can do that are checked rather than trusted. It can
 * substitute a container — asked for WebP, given PNG — and that result is
 * dropped rather than stored under the wrong name, because the type a file is
 * stored under is what it is served as. And it can answer a lossless request
 * with a lossy file: WebP has both, under one type, and which one a canvas
 * writes depends on the quality it was given and on the browser. So a lossless
 * choice that comes back as WebP is read back (`rasterFacts`), and a lossy
 * bitstream is dropped — a diagram is never stored with rings around its edges
 * because an encoder took a liberty.
 */
async function encodeSmallest(
  canvas: Canvas,
  traits: PictureTraits,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const choices = encodingChoices(traits, await canEncodeWebp())
  let best: { bytes: Uint8Array; mimeType: string } | null = null
  for (const choice of choices) {
    let blob: Blob
    try {
      blob = await encode(canvas, choice.mimeType, choice.quality)
    } catch {
      continue
    }
    if (blob.type !== choice.mimeType) continue
    if (best && blob.size >= best.bytes.byteLength) continue
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (
      choice.quality === undefined &&
      choice.mimeType === 'image/webp' &&
      rasterFacts(bytes, choice.mimeType).lossy
    ) {
      continue
    }
    best = { bytes, mimeType: choice.mimeType }
  }
  if (!best) throw new Error('Nettleseren kunne ikke lagre bildet i noe format Slaids bruker.')
  return best
}

/**
 * One container, from the canvas.
 *
 * A lossless request carries no quality, and for WebP that has to become `1`:
 * Chromium writes the lossless bitstream at exactly that value and a lossy one
 * at every other, including the default it uses when none is given. PNG has no
 * quality to give.
 */
function encode(canvas: Canvas, type: string, quality?: number): Promise<Blob> {
  const level = quality ?? (type === 'image/webp' ? 1 : undefined)
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality: level })
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Kunne ikke kode bildet.'))),
      type,
      level,
    )
  })
}
