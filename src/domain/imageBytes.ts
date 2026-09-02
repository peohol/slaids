/**
 * What a file claims to be, read from its own first bytes.
 *
 * This is *sniffing* and nothing more: it answers "which format is this
 * shaped like", so that a declared MIME type or file name is never what Slaids
 * believes. It deliberately does not answer "is this a complete, decodable
 * image" — a header is easy to fake and easy to truncate. That question belongs
 * to `imageFile.ts`, which walks the whole file, and every path that stores a
 * raster asset goes through there.
 *
 * Pure and headless on purpose: this has to work in the browser, in Node and in
 * whatever runs the REST/MCP transport later.
 */

import { SVG_MIME_TYPE } from './svg'

export interface ProbedFormat {
  mimeType: string
  isVector: boolean
}

/** Which format the bytes look like, or `null` for anything Slaids will not store. */
export function probeImageFormat(bytes: Uint8Array): ProbedFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return raster('image/png')
  if (isGif(bytes)) return raster('image/gif')
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return raster('image/jpeg')
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return raster('image/webp')
  if (isAvif(bytes)) return raster('image/avif')
  if (isSvgText(bytes)) return { mimeType: SVG_MIME_TYPE, isVector: true }
  return null
}

function raster(mimeType: string): ProbedFormat {
  return { mimeType, isVector: false }
}

/* ------------------------------------------------------------------ *
 * Byte helpers, shared with the structural validator
 * ------------------------------------------------------------------ */

export function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

export function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  let out = ''
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i])
  return out
}

export function be16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

export function be32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24 >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  )
}

export function le16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

export function le24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

export function le32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/* ------------------------------------------------------------------ *
 * Signatures
 * ------------------------------------------------------------------ */

function isGif(bytes: Uint8Array): boolean {
  const header = ascii(bytes, 0, 6)
  return header === 'GIF87a' || header === 'GIF89a'
}

/**
 * AVIF and its relatives share the ISO base media container, and the brand list
 * in `ftyp` is what tells them apart. Recognising it is not the same as
 * accepting it: see `imageFile.ts` for why the agent path does not store AVIF.
 */
const AVIF_BRANDS = new Set(['avif', 'avis'])

function isAvif(bytes: Uint8Array): boolean {
  if (ascii(bytes, 4, 4) !== 'ftyp') return false
  if (AVIF_BRANDS.has(ascii(bytes, 8, 4))) return true
  const limit = Math.min(be32(bytes, 0), bytes.length)
  for (let offset = 16; offset + 4 <= limit; offset += 4) {
    if (AVIF_BRANDS.has(ascii(bytes, offset, 4))) return true
  }
  return false
}

/**
 * SVG is text, so it is sniffed rather than matched against a signature. The
 * real validation is `sanitizeSvg`, which parses the whole document.
 */
function isSvgText(bytes: Uint8Array): boolean {
  // A UTF-8 byte order mark is bytes, not a character, so it is skipped here
  // rather than trimmed off the decoded string.
  const start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0
  const head = ascii(bytes, start, Math.min(bytes.length - start, 1024)).trimStart()
  return head.startsWith('<') && /<svg[\s>/]/i.test(head)
}
