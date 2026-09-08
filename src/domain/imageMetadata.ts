/**
 * What a raster file carries besides its pixels, and what to do about it.
 *
 * Two questions, both answered from the bytes and nothing else:
 *
 *  1. **Can this file be redrawn?** An animated GIF, APNG or WebP is many
 *    pictures; a canvas draws the first and forgets the rest, so a file that
 *    animates is never put through the pipeline. Whether a file came through a
 *    lossy codec is read here too — the container decision in
 *    `imageOptimization.ts` turns on it.
 *  2. **What can go without redrawing?** Camera data, GPS coordinates, embedded
 *    thumbnails, editing software's notes: none of it is drawn, and some of it
 *    is nobody's business but the photographer's. It is dropped *losslessly*,
 *    by copying the file without those segments, so a file that needs no
 *    resizing loses its metadata without losing a generation of compression.
 *    What is kept is exactly what changes how the picture looks: a colour
 *    profile, Adobe's colour-transform tag — and the orientation, rewritten as
 *    the one tag it is, because a phone photograph is stored sideways and the
 *    tag is what turns it upright. That holds for all three containers that can
 *    carry an Exif block: JPEG's APP1 segment, PNG's `eXIf` chunk and WebP's
 *    `EXIF` chunk. Optimising a picture never turns it.
 *
 * Every walk here is bounds-checked against the file, and a file the walk
 * cannot follow is answered with "leave it alone" rather than with a guess:
 * what is being parsed is whatever happened to be uploaded. Pure and headless,
 * like `imageFile.ts` beside it.
 */

import { ascii, be16, be32, le32, startsWith, PNG_SIGNATURE } from './imageBytes'
import {
  EXIF_ORIENTATION_TAG,
  crc32,
  readBlockOrientation,
  readExifOrientation,
  type BlockOrientation,
} from './imageFile'

/** What the bytes say about how a file may be handled. */
export interface RasterFacts {
  /** Several frames: redrawing it through a canvas would keep only the first. */
  animated: boolean
  /** The pixels came through a lossy codec, so their artefacts are already there. */
  lossy: boolean
}

export function rasterFacts(bytes: Uint8Array, mimeType: string): RasterFacts {
  switch (mimeType) {
    case 'image/gif':
      return { animated: gifFrameCount(bytes) > 1, lossy: false }
    case 'image/png':
      return { animated: pngHasChunk(bytes, 'acTL'), lossy: false }
    case 'image/webp': {
      const chunks = webpChunks(bytes)
      return {
        animated: chunks.some((chunk) => chunk.fourcc === 'ANIM' || chunk.fourcc === 'ANMF'),
        lossy: chunks.some((chunk) => chunk.fourcc === 'VP8 '),
      }
    }
    case 'image/jpeg':
      return { animated: false, lossy: true }
    case 'image/avif':
      // Lossless AVIF exists and is rare; assuming lossy costs nothing but a
      // container that is honest about pixels that were probably lossy anyway.
      return { animated: isoBrands(bytes).includes('avis'), lossy: true }
    default:
      return { animated: false, lossy: false }
  }
}

/**
 * The same file without the metadata nothing draws, or `null` when there is
 * none to drop — so a caller can tell "nothing to do" from "here is the file".
 *
 * Only the three formats that carry metadata in a form worth removing. A GIF's
 * comment blocks and an AVIF's boxes are left as they are: the first is rare
 * and tiny, the second is a container this module does not rewrite.
 */
export function stripRasterMetadata(bytes: Uint8Array, mimeType: string): Uint8Array | null {
  const stripped = stripByFormat(bytes, mimeType)
  // Dropping a segment and writing the orientation back can come out no
  // smaller than what went in — an Exif that was already only the orientation.
  // That is a file with nothing to gain, and «nothing to strip» is the answer.
  return stripped && stripped.byteLength < bytes.byteLength ? stripped : null
}

function stripByFormat(bytes: Uint8Array, mimeType: string): Uint8Array | null {
  switch (mimeType) {
    case 'image/jpeg':
      return stripJpeg(bytes)
    case 'image/png':
      return stripPng(bytes)
    case 'image/webp':
      return stripWebp(bytes)
    default:
      return null
  }
}

/* ------------------------------------------------------------------ *
 * JPEG
 * ------------------------------------------------------------------ */

/** Segments a JPEG keeps because a decoder reads them, by marker. */
const JPEG_APP0 = 0xe0
const JPEG_APP1 = 0xe1
const JPEG_APP2 = 0xe2
const JPEG_APP14 = 0xee
const JPEG_COM = 0xfe
const JPEG_SOS = 0xda

/**
 * Whether an application segment is drawn or merely remembered.
 *
 *  - APP0 `JFIF` says how the samples are laid out; `JFXX` is a thumbnail.
 *  - APP1 is Exif and XMP — the camera, the GPS fix, the thumbnail, the edits.
 *  - APP2 `ICC_PROFILE` is the colour profile, and dropping it would recolour
 *    the picture; any other APP2 is an extension nothing here draws.
 *  - APP14 is Adobe's colour-transform tag, which decides how the channels are
 *    read. Without it some files decode to the wrong colours entirely.
 *  - Everything else — APP3 to APP13, APP15, comments — is metadata.
 */
function keepsJpegSegment(marker: number, bytes: Uint8Array, dataStart: number): boolean {
  if (marker === JPEG_APP0) return ascii(bytes, dataStart, 4) !== 'JFXX'
  if (marker === JPEG_APP2) return ascii(bytes, dataStart, 12) === 'ICC_PROFILE\u0000'
  if (marker === JPEG_APP14) return true
  if (marker >= JPEG_APP0 && marker <= 0xef) return false
  return marker !== JPEG_COM
}

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (!startsWith(bytes, [0xff, 0xd8])) return null
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
  let orientation: number | null = null
  let dropped = false
  let offset = 2

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset + 3 > bytes.length) return null
    const marker = bytes[offset]
    const segmentStart = offset - 1
    const length = be16(bytes, offset + 1)
    if (length < 2 || offset + 1 + length > bytes.length) return null
    const end = offset + 1 + length

    if (marker === JPEG_APP1) {
      // The one thing in Exif that is drawn: which way is up.
      orientation = readExifOrientation(bytes, offset + 3, end) ?? orientation
    }
    if (keepsJpegSegment(marker, bytes, offset + 3)) {
      kept.push(bytes.subarray(segmentStart, end))
    } else {
      dropped = true
    }

    if (marker === JPEG_SOS) {
      // Entropy-coded data and everything after it — restart markers, the EOI
      // and any further scans of a progressive file — is the picture. Copied as
      // one piece; nothing in it is metadata.
      kept.push(bytes.subarray(end))
      break
    }
    offset = end
  }

  if (!dropped) return null
  if (orientation !== null && orientation !== 1) {
    // Right after SOI — or after APP0, which JFIF says comes first.
    const at = kept.length > 1 && kept[1][1] === JPEG_APP0 ? 2 : 1
    kept.splice(at, 0, orientationSegment(orientation))
  }
  return concat(kept)
}

/**
 * A minimal Exif APP1: one TIFF header, one IFD, one entry — the orientation.
 *
 * Big-endian throughout, as the TIFF header says. The entry's value is a SHORT
 * and sits in the first two bytes of the four-byte value field.
 */
export function orientationSegment(orientation: number): Uint8Array {
  const payload = [...EXIF_MARKER, ...orientationTiff(orientation)]
  const length = payload.length + 2
  return new Uint8Array([0xff, JPEG_APP1, length >> 8, length & 0xff, ...payload])
}

/** `Exif\0\0`, the marker a JPEG puts in front of the block. */
const EXIF_MARKER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]

/** One TIFF header, one IFD, one entry — the orientation. Big-endian, as "MM" says. */
function orientationTiff(orientation: number): number[] {
  return [
    0x4d, 0x4d, // "MM"
    0x00, 0x2a,
    0x00, 0x00, 0x00, 0x08, // IFD0 follows the header
    0x00, 0x01, // one entry
    EXIF_ORIENTATION_TAG >> 8, EXIF_ORIENTATION_TAG & 0xff,
    0x00, 0x03, // SHORT
    0x00, 0x00, 0x00, 0x01, // one value
    0x00, orientation & 0xff, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]
}

/**
 * The one thing an Exif block says about how the picture *looks*, when it says
 * anything: which way is up.
 *
 * Everything else in there describes the photograph — the camera, the place,
 * the moment, a thumbnail of it — and dropping it changes nothing on screen.
 * The orientation is an instruction, and a renderer follows it: drop it from a
 * file that carries one and the picture comes out lying on its side. So it is
 * read out before the block goes, and written back as the single tag it is.
 *
 * The block's own shape is carried over with it — see `BlockOrientation` — so
 * no decoder that could read the original can misread what replaces it.
 */
function turningOrientation(bytes: Uint8Array, start: number, end: number): BlockOrientation | null {
  const found = readBlockOrientation(bytes, start, end)
  // 1 is «as stored»: nothing to preserve, and nothing to lose by dropping it.
  return found && found.value !== 1 ? found : null
}

/** The smallest block that still says which way is up, shaped as the file shaped its own. */
function orientationOnly(found: BlockOrientation): number[] {
  const tiff = orientationTiff(found.value)
  return found.prefixed ? [...EXIF_MARKER, ...tiff] : tiff
}

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

/**
 * Chunks that describe the picture to a person or a program rather than to a
 * decoder. Everything else — palette, transparency, gamma, colour profile,
 * animation control, the pixels — is kept as it is.
 */
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME', 'eXIf'])

/** A chunk, with the checksum PNG requires over its type and data. */
function pngChunk(type: string, data: readonly number[]): Uint8Array {
  const body = new Uint8Array([...type].map((character) => character.charCodeAt(0)).concat(data))
  const crc = crc32(body)
  const length = data.length
  return new Uint8Array([
    length >>> 24, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff,
    ...body,
    crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff,
  ])
}

interface PngChunk {
  type: string
  start: number
  end: number
}

function pngChunks(bytes: Uint8Array): PngChunk[] | null {
  if (!startsWith(bytes, PNG_SIGNATURE)) return null
  const chunks: PngChunk[] = []
  let offset = PNG_SIGNATURE.length
  while (offset + 12 <= bytes.length) {
    const length = be32(bytes, offset)
    if (length > bytes.length - offset - 12) return null
    const end = offset + 12 + length
    chunks.push({ type: ascii(bytes, offset + 4, 4), start: offset, end })
    offset = end
    if (chunks[chunks.length - 1].type === 'IEND') break
  }
  return chunks
}

function pngHasChunk(bytes: Uint8Array, type: string): boolean {
  return pngChunks(bytes)?.some((chunk) => chunk.type === type) ?? false
}

function stripPng(bytes: Uint8Array): Uint8Array | null {
  const chunks = pngChunks(bytes)
  if (!chunks || !chunks.some((chunk) => PNG_METADATA_CHUNKS.has(chunk.type))) return null

  const kept: Uint8Array[] = []
  for (const chunk of chunks) {
    if (!PNG_METADATA_CHUNKS.has(chunk.type)) {
      // Each chunk carries its own CRC over its own bytes, so copying one whole
      // needs no recomputation.
      kept.push(bytes.subarray(chunk.start, chunk.end))
      continue
    }
    // The eight bytes before the data are the length and the type; the four
    // after it are the checksum.
    const turning =
      chunk.type === 'eXIf' ? turningOrientation(bytes, chunk.start + 8, chunk.end - 4) : null
    if (turning) kept.push(pngChunk('eXIf', orientationOnly(turning)))
  }
  // Whatever trailed the IEND is not part of the file and is not copied.
  return concat([bytes.subarray(0, PNG_SIGNATURE.length), ...kept])
}

/* ------------------------------------------------------------------ *
 * WEBP
 * ------------------------------------------------------------------ */

interface WebpChunk {
  fourcc: string
  start: number
  /** Past the padding byte an odd-sized chunk carries. */
  end: number
}

function webpChunks(bytes: Uint8Array): WebpChunk[] {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return []
  const chunks: WebpChunk[] = []
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = le32(bytes, offset + 4)
    if (length > bytes.length - offset - 8) return []
    const end = offset + 8 + length + (length & 1)
    chunks.push({ fourcc: ascii(bytes, offset, 4), start: offset, end: Math.min(end, bytes.length) })
    offset = end
  }
  return chunks
}

/** The VP8X flag bits that say a metadata chunk follows. */
const WEBP_FLAG_EXIF = 0x08
const WEBP_FLAG_XMP = 0x04

/** A RIFF chunk, padded to an even length as the container requires. */
function webpChunk(fourcc: string, data: readonly number[]): Uint8Array {
  const length = data.length
  return new Uint8Array([
    ...[...fourcc].map((character) => character.charCodeAt(0)),
    length & 0xff, (length >>> 8) & 0xff, (length >>> 16) & 0xff, (length >>> 24) & 0xff,
    ...data,
    ...(length & 1 ? [0] : []),
  ])
}

function stripWebp(bytes: Uint8Array): Uint8Array | null {
  const chunks = webpChunks(bytes)
  const metadata = (chunk: WebpChunk): boolean => chunk.fourcc === 'EXIF' || chunk.fourcc === 'XMP '
  if (!chunks.some(metadata)) return null

  // The eight bytes before an EXIF chunk's data are its fourcc and its length.
  const exif = chunks.find((chunk) => chunk.fourcc === 'EXIF')
  const turning = exif ? turningOrientation(bytes, exif.start + 8, exif.end) : null
  const replacement = turning ? webpChunk('EXIF', orientationOnly(turning)) : null

  const parts: Uint8Array[] = []
  for (const chunk of chunks) {
    if (metadata(chunk)) {
      if (chunk.fourcc === 'EXIF' && replacement) parts.push(replacement)
      continue
    }
    const copy = bytes.slice(chunk.start, chunk.end)
    // The extended header announces the chunks that follow it; a flag left set
    // for a chunk that is gone is a header that lies — and one cleared for a
    // chunk that is still there is a header that hides it.
    const dropped = WEBP_FLAG_XMP | (replacement ? 0 : WEBP_FLAG_EXIF)
    if (chunk.fourcc === 'VP8X' && copy.length >= 9) copy[8] &= ~dropped
    parts.push(copy)
  }
  const body = concat(parts)
  const out = new Uint8Array(12 + body.length)
  out.set(bytes.subarray(0, 12), 0)
  out.set(body, 12)
  // The RIFF size is everything after the eight-byte RIFF header.
  const size = out.length - 8
  out[4] = size & 0xff
  out[5] = (size >>> 8) & 0xff
  out[6] = (size >>> 16) & 0xff
  out[7] = (size >>> 24) & 0xff
  return out
}

/* ------------------------------------------------------------------ *
 * GIF and ISO BMFF
 * ------------------------------------------------------------------ */

/** How many image descriptors the file holds. Stops counting at two: that is all the answer needs. */
function gifFrameCount(bytes: Uint8Array): number {
  if (bytes.length < 13) return 0
  let offset = 13
  const packed = bytes[10]
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1)
  let frames = 0
  while (offset < bytes.length && frames < 2) {
    const marker = bytes[offset]
    if (marker === 0x3b) break
    if (marker === 0x21) {
      offset = skipSubBlocks(bytes, offset + 2)
      continue
    }
    if (marker !== 0x2c) break
    if (offset + 10 > bytes.length) break
    frames += 1
    const local = bytes[offset + 9]
    offset += 10
    if (local & 0x80) offset += 3 * 2 ** ((local & 0x07) + 1)
    offset = skipSubBlocks(bytes, offset + 1)
  }
  return frames
}

/** Past a chain of sub-blocks, or past the end of a truncated file. */
function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start
  while (offset < bytes.length) {
    const length = bytes[offset]
    offset += 1
    if (length === 0) return offset
    offset += length
  }
  return bytes.length
}

/** The brands an ISO base media file declares in its `ftyp` box. */
function isoBrands(bytes: Uint8Array): string[] {
  if (ascii(bytes, 4, 4) !== 'ftyp') return []
  const brands: string[] = []
  const limit = Math.min(be32(bytes, 0), bytes.length)
  brands.push(ascii(bytes, 8, 4))
  for (let offset = 16; offset + 4 <= limit; offset += 4) brands.push(ascii(bytes, offset, 4))
  return brands
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}
