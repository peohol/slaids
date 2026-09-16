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

/**
 * The names the formats above go by, keyed by the type the sniffer reports.
 *
 * File names decide nothing about what a file *is* — that is the whole point of
 * this module — but they are still what a person types, drags and sorts by, so
 * the two places that have to talk about them (the picker's `accept` hint and
 * the image deposit's `1.png`, `2.jpg`, … rule) read one list rather than each
 * keeping their own. The first extension of each is the canonical one.
 */
export const IMAGE_FILE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  [SVG_MIME_TYPE]: ['svg'],
}

/** Every extension a picture may arrive under, lowercase, without the dot. */
export const IMAGE_FILE_EXTENSION_LIST: readonly string[] = Object.values(
  IMAGE_FILE_EXTENSIONS,
).flat()

/**
 * What a file input may say it accepts.
 *
 * The MIME types plus `.svg`, because a browser that cannot guess a type from
 * the extension would otherwise grey out the one format Slaids stores as text.
 */
export const IMAGE_FILE_ACCEPT: string = [...Object.keys(IMAGE_FILE_EXTENSIONS), '.svg'].join(',')

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
 *
 * The head is read the way the file says it is written, not as bytes that
 * happen to look like ASCII: a UTF-16 document has a zero between every letter
 * and does not look like anything at all, so an SVG that plainly is one would
 * be answered with "not an image format".
 */
function isSvgText(bytes: Uint8Array): boolean {
  const head = decodeHead(bytes).trimStart()
  return head.startsWith('<') && /<svg[\s>/]/i.test(head)
}

/** Enough of a text file to recognise it by, in its own encoding. */
function decodeHead(bytes: Uint8Array): string {
  const head = bytes.subarray(0, Math.min(bytes.length, 1024))
  try {
    // A byte order mark is bytes and not a character, and `TextDecoder` drops
    // it, so nothing is left in front of the root element.
    return new TextDecoder(declaredTextEncoding(bytes)).decode(head)
  } catch {
    // A label nothing can decode is still a document that may say `<svg` in
    // ASCII. Recognising it here is what lets `assetIngress.ts` answer with the
    // encoding that is the problem instead of "unknown file type".
    return new TextDecoder().decode(head)
  }
}

/**
 * Which encoding a text file says it is in: a byte order mark, or the
 * `encoding="…"` of an XML declaration. Anything else is UTF-8, which is what
 * XML means by no declaration at all.
 *
 * Exported because two places must get the same answer — the sniffer above, and
 * `domain/assetIngress.ts`, which decodes the whole document before handing it
 * to the sanitiser. Reading a Windows-1252 export as UTF-8 turns every accented
 * letter into U+FFFD, and what gets stored is then a figure with mangled text
 * in it. The label is returned rather than the decoded text: only the caller
 * knows how much of the file it needs, and only it can say what a label
 * `TextDecoder` refuses should mean.
 */
export function declaredTextEncoding(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return 'utf-8'
  if (startsWith(bytes, [0xff, 0xfe])) return 'utf-16le'
  if (startsWith(bytes, [0xfe, 0xff])) return 'utf-16be'
  // A mark wins over a declaration, as XML says it does. Without one, the
  // declaration is read as ASCII — it is ASCII in every encoding it can be
  // written in — with the zero bytes of an unmarked UTF-16 document dropped, so
  // a label that is only ever letters, digits and dashes still comes through.
  const head = ascii(bytes, 0, Math.min(bytes.length, 256)).replaceAll('\u0000', '')
  const declared = /^\s*<\?xml\s[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head)
  return declared ? declared[1] : 'utf-8'
}
