/**
 * What a file actually is, read from its own bytes.
 *
 * Slaids stores pictures, so the bytes have to say they are a picture. A
 * declared MIME type is whatever the caller wrote in a field, and an agent that
 * uploads a JSON file labelled `image/png` should be told no — so the format is
 * taken from the content and the label is only ever a hint.
 *
 * Dimensions come along for the ride because they are in the same headers, and
 * because `AssetRef` needs them: the aspect ratio is what decides how a picture
 * is laid out in a zone. Formats whose size lives deeper in the container
 * (AVIF) are recognised without a size; the caller may supply one.
 *
 * Pure and headless on purpose: this has to work in the browser, in Node and in
 * whatever runs the REST/MCP transport later. The browser's own decoder
 * (`state/assets.ts`) stays as the fallback for what this cannot measure.
 */

import { SVG_MIME_TYPE } from './svg'

export interface ProbedImage {
  mimeType: string
  isVector: boolean
  /** `0` when the format is known but its size is not readable from the header. */
  width: number
  height: number
}

/** What the bytes are, or `null` when they are not a picture Slaids accepts. */
export function probeImage(bytes: Uint8Array): ProbedImage | null {
  return (
    probePng(bytes) ??
    probeGif(bytes) ??
    probeJpeg(bytes) ??
    probeRiff(bytes) ??
    probeIsoBmff(bytes) ??
    probeSvg(bytes) ??
    null
  )
}

/* ------------------------------------------------------------------ *
 * Byte helpers
 * ------------------------------------------------------------------ */

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  let out = ''
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i])
  return out
}

function be16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function be32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
  )
}

function le16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function le24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

/* ------------------------------------------------------------------ *
 * Formats
 * ------------------------------------------------------------------ */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function probePng(bytes: Uint8Array): ProbedImage | null {
  if (!startsWith(bytes, PNG_SIGNATURE)) return null
  // IHDR is required to be the first chunk, and it starts at byte 8.
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null
  return { mimeType: 'image/png', isVector: false, width: be32(bytes, 16), height: be32(bytes, 20) }
}

function probeGif(bytes: Uint8Array): ProbedImage | null {
  const header = ascii(bytes, 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  if (bytes.length < 10) return null
  return { mimeType: 'image/gif', isVector: false, width: le16(bytes, 6), height: le16(bytes, 8) }
}

/**
 * JPEG keeps its size in a start-of-frame marker somewhere after the header, so
 * the marker chain is walked until one turns up.
 */
function probeJpeg(bytes: Uint8Array): ProbedImage | null {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null
  const found = { mimeType: 'image/jpeg', isVector: false, width: 0, height: 0 }

  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    // Padding and standalone markers carry no length field.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }
    const length = be16(bytes, offset + 2)
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) {
      return { ...found, height: be16(bytes, offset + 5), width: be16(bytes, offset + 7) }
    }
    if (length < 2) return found
    offset += 2 + length
  }
  return found
}

/** WEBP: a RIFF container whose size lives in whichever VP8 chunk it uses. */
function probeRiff(bytes: Uint8Array): ProbedImage | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const found = { mimeType: 'image/webp', isVector: false, width: 0, height: 0 }
  const chunk = ascii(bytes, 12, 4)

  if (chunk === 'VP8X' && bytes.length >= 30) {
    return { ...found, width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 }
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { ...found, width: le16(bytes, 26) & 0x3fff, height: le16(bytes, 28) & 0x3fff }
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    return { ...found, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return found
}

/**
 * AVIF: an ISO base media file, recognised by the brands in its `ftyp` box.
 *
 * A file may declare `avif` as its major brand or list it among the compatible
 * ones, so both are read. Only AVIF is accepted here — HEIC and friends share
 * the container but no browser draws them, and storing a picture nothing can
 * show is worse than refusing it.
 *
 * The size sits in an `ispe` box several levels down; reading it would mean a
 * box parser for one format, so the size is left to the caller or to the
 * browser's decoder.
 */
const AVIF_BRANDS = new Set(['avif', 'avis'])

function probeIsoBmff(bytes: Uint8Array): ProbedImage | null {
  if (ascii(bytes, 4, 4) !== 'ftyp') return null
  const limit = Math.min(be32(bytes, 0), bytes.length)
  if (!AVIF_BRANDS.has(ascii(bytes, 8, 4))) {
    let offset = 16
    let found = false
    while (!found && offset + 4 <= limit) {
      found = AVIF_BRANDS.has(ascii(bytes, offset, 4))
      offset += 4
    }
    if (!found) return null
  }
  return { mimeType: 'image/avif', isVector: false, width: 0, height: 0 }
}

/**
 * SVG is text, so it is sniffed rather than pattern-matched on a signature.
 * The real validation is `sanitizeSvg`, which also reads the true size.
 */
function probeSvg(bytes: Uint8Array): ProbedImage | null {
  // A UTF-8 byte order mark is bytes, not a character, so it is skipped here
  // rather than trimmed off the decoded string.
  const start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0
  const head = ascii(bytes, start, Math.min(bytes.length - start, 1024)).trimStart()
  if (!head.startsWith('<')) return null
  if (!/<svg[\s>/]/i.test(head)) return null
  return { mimeType: SVG_MIME_TYPE, isVector: true, width: 0, height: 0 }
}
