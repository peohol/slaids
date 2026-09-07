/**
 * Is this actually a complete, decodable image?
 *
 * Sniffing a signature (`imageBytes.ts`) says what a file wants to be called.
 * It says nothing about whether the rest of it exists: a truncated download, a
 * half-written upload and eight bytes of PNG signature followed by anything at
 * all all sniff as pictures. Storing one of those gives a slide that renders as
 * a broken image at exactly the moment somebody is presenting, so the whole
 * file is walked before it may become an asset.
 *
 * What "walked" means, per format: every structure that declares a length has
 * to fit inside the file, the required parts have to be present, the file has
 * to end where it says it ends, and the size has to come out of the bitstream
 * rather than out of a caller's parameter. PNG additionally has a checksum per
 * chunk, and it is verified — that is the difference between "the header says
 * 1600 × 900" and "these bytes are that picture".
 *
 * Pure, headless and dependency-free, because this runs in the browser, in the
 * test runner and in whatever serves the agent transport later.
 */

import {
  ascii,
  be16,
  be32,
  le16,
  le24,
  le32,
  probeImageFormat,
  startsWith,
  PNG_SIGNATURE,
} from './imageBytes'
import { err, ok, type Result } from './result'
import { SVG_MIME_TYPE } from './svg'

export interface RasterImage {
  mimeType: string
  /**
   * Intrinsic size, always read from the bitstream and always > 0 — and always
   * the size the picture is *drawn* at: a JPEG that carries an EXIF orientation
   * turning it a quarter turn is reported transposed, because that is what
   * every renderer shows. See `readExifOrientation`.
   */
  width: number
  height: number
}

/**
 * Validate raster bytes and return what they really are.
 *
 * SVG is not handled here: it is text, and `sanitizeSvg` is its validator.
 */
export function readRasterImage(bytes: Uint8Array): Result<RasterImage> {
  const format = probeImageFormat(bytes)
  if (!format) {
    return err(
      'UNSUPPORTED_MEDIA_TYPE',
      'Innholdet er ikke et bildeformat Slaids kan vise. Bruk PNG, JPEG, GIF, WEBP eller SVG.',
    )
  }
  if (format.mimeType === SVG_MIME_TYPE) {
    return err('INVALID_ARGUMENT', 'SVG valideres av `sanitizeSvg`, ikke som et rasterbilde.')
  }
  if (format.mimeType === 'image/avif') {
    // Recognised, deliberately not stored: an AVIF's size lives in an `ispe`
    // box that belongs to one item among several, and picking the wrong item
    // gives the wrong aspect ratio. Until that is parsed properly, saying no is
    // better than storing a picture whose shape we guessed — and a caller's
    // `width`/`height` would be a claim, not a verification. The editor still
    // takes AVIF, because the browser decodes it there.
    return err(
      'UNSUPPORTED_MEDIA_TYPE',
      'AVIF støttes ikke i agentveien ennå. Send PNG, JPEG, GIF, WEBP eller SVG.',
    )
  }

  const size = validate(format.mimeType, bytes)
  if (!size.ok) return size
  if (size.value.width <= 0 || size.value.height <= 0) {
    return err('INVALID_IMAGE', 'Bildet oppgir ingen gyldig størrelse.')
  }
  return ok({ mimeType: format.mimeType, ...size.value })
}

interface Size {
  width: number
  height: number
}

function validate(mimeType: string, bytes: Uint8Array): Result<Size> {
  switch (mimeType) {
    case 'image/png':
      return validatePng(bytes)
    case 'image/gif':
      return validateGif(bytes)
    case 'image/jpeg':
      return validateJpeg(bytes)
    case 'image/webp':
      return validateWebp(bytes)
    default:
      return err('UNSUPPORTED_MEDIA_TYPE', 'Filtypen støttes ikke.')
  }
}

const broken = (what: string) => err('INVALID_IMAGE', `Bildefilen er ufullstendig eller ødelagt: ${what}.`)

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

/**
 * PNG is a chunk stream with a CRC per chunk, which makes it the one format
 * where "these bytes are intact" can be answered exactly rather than
 * structurally. It is answered.
 */
function validatePng(bytes: Uint8Array): Result<Size> {
  if (!startsWith(bytes, PNG_SIGNATURE)) return broken('PNG-signaturen mangler')

  let offset = PNG_SIGNATURE.length
  let size: Size | null = null
  let dataChunks = 0
  let ended = false

  while (offset + 12 <= bytes.length) {
    const length = be32(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    if (!/^[A-Za-z]{4}$/.test(type)) return broken('ugyldig chunk-type')
    if (length > bytes.length - offset - 12) return broken('en chunk går utenfor filen')

    const end = offset + 8 + length
    if (crc32(bytes.subarray(offset + 4, end)) !== be32(bytes, end)) {
      return broken(`sjekksummen for «${type}» stemmer ikke`)
    }

    if (size === null && type !== 'IHDR') return broken('IHDR er ikke første chunk')
    if (type === 'IHDR') {
      if (length !== 13) return broken('IHDR har feil lengde')
      size = { width: be32(bytes, offset + 8), height: be32(bytes, offset + 12) }
    }
    if (type === 'IDAT') dataChunks += 1
    if (type === 'IEND') {
      ended = true
      offset = end + 4
      break
    }

    offset = end + 4
  }

  if (!size) return broken('IHDR mangler')
  if (dataChunks === 0) return broken('bildedata (IDAT) mangler')
  if (!ended) return broken('IEND mangler')
  if (offset !== bytes.length) return broken('det ligger data etter IEND')
  return ok(size)
}

let crcTable: Uint32Array | null = null

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i += 1) {
      let value = i
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      crcTable[i] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/* ------------------------------------------------------------------ *
 * GIF
 * ------------------------------------------------------------------ */

function validateGif(bytes: Uint8Array): Result<Size> {
  if (bytes.length < 13) return broken('for kort til å være en GIF')
  const size = { width: le16(bytes, 6), height: le16(bytes, 8) }

  const packed = bytes[10]
  let offset = 13
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1)
  // A screen descriptor and a trailer is a file that declares a size and
  // contains no picture. The size in the header is exactly what this module
  // refuses to take anyone's word for, so a frame has to be there.
  let frames = 0

  while (offset < bytes.length) {
    const marker = bytes[offset]
    if (marker === 0x3b) return frames > 0 ? ok(size) : broken('filen inneholder ingen bilderamme')

    if (marker === 0x21) {
      // Extension: a label, then sub-blocks.
      offset += 2
      const skipped = skipGifSubBlocks(bytes, offset)
      if (skipped === null) return broken('en utvidelsesblokk er avkortet')
      offset = skipped
      continue
    }

    if (marker === 0x2c) {
      // Image descriptor: 9 bytes, an optional local colour table, the LZW
      // minimum code size, then the image data as sub-blocks.
      if (offset + 10 > bytes.length) return broken('en bildeblokk er avkortet')
      frames += 1
      const local = bytes[offset + 9]
      offset += 10
      if (local & 0x80) offset += 3 * 2 ** ((local & 0x07) + 1)
      offset += 1
      if (offset > bytes.length) return broken('en bildeblokk er avkortet')
      const skipped = skipGifSubBlocks(bytes, offset)
      if (skipped === null) return broken('bildedataene er avkortet')
      offset = skipped
      continue
    }

    return broken('ukjent blokk')
  }

  return broken('avslutningsmerket mangler')
}

/** Walk one sub-block chain and return where it ends, or `null` if truncated. */
function skipGifSubBlocks(bytes: Uint8Array, start: number): number | null {
  let offset = start
  for (;;) {
    if (offset >= bytes.length) return null
    const length = bytes[offset]
    offset += 1
    if (length === 0) return offset
    offset += length
    if (offset > bytes.length) return null
  }
}

/* ------------------------------------------------------------------ *
 * JPEG
 * ------------------------------------------------------------------ */

/** Frame markers that carry the picture's size; C4/C8/CC are tables, not frames. */
function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
}

/**
 * The orientation an EXIF segment asks for, or `null` when it carries none that
 * can be read.
 *
 * A photograph from a phone is stored the way the sensor read it and turned by
 * a tag, so the frame header's width and height are not the picture's: a
 * browser draws it rotated, because `image-orientation: from-image` is the
 * default. Reading the tag is what makes "the size out of the bitstream" mean
 * the size it is drawn at — which is the only size worth recording, and the
 * only one a renderer that has to agree with a browser can use.
 *
 * Every step is bounds-checked against the segment: what is being parsed here
 * is whatever the file happened to contain.
 */
function readExifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (ascii(bytes, start, 6) !== 'Exif\u0000\u0000') return null
  const tiff = start + 6
  if (tiff + 8 > end) return null

  const order = ascii(bytes, tiff, 2)
  if (order !== 'II' && order !== 'MM') return null
  const little = order === 'II'
  const u16 = (at: number): number => (little ? le16(bytes, at) : be16(bytes, at))
  const u32 = (at: number): number => (little ? le32(bytes, at) : be32(bytes, at))
  if (u16(tiff + 2) !== 0x002a) return null

  // Offsets inside an EXIF block are relative to the TIFF header, not the file.
  const ifd = tiff + u32(tiff + 4)
  if (ifd < tiff || ifd + 2 > end) return null
  const entries = u16(ifd)
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > end) return null
    if (u16(entry) !== EXIF_ORIENTATION_TAG) continue
    const value = u16(entry + 8)
    return value >= 1 && value <= 8 ? value : null
  }
  return null
}

const EXIF_ORIENTATION_TAG = 0x0112

/** 5 through 8 turn the picture a quarter turn, so it is drawn transposed. */
function transposes(orientation: number | null): boolean {
  return orientation !== null && orientation >= 5 && orientation <= 8
}

function validateJpeg(bytes: Uint8Array): Result<Size> {
  let offset = 2
  let size: Size | null = null
  let orientation: number | null = null
  let scanned = false

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return broken('forventet en JPEG-markør')
    // Fill bytes are legal between markers.
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return broken('filen slutter midt i en markør')

    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd9) {
      if (!size) return broken('bildets størrelse mangler')
      if (!scanned) return broken('bildedataene mangler')
      return ok(
        transposes(orientation) ? { width: size.height, height: size.width } : size,
      )
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue

    if (offset + 2 > bytes.length) return broken('et segment er avkortet')
    const length = be16(bytes, offset)
    if (length < 2 || offset + length > bytes.length) return broken('et segment er avkortet')

    if (isFrameMarker(marker)) {
      if (length < 7) return broken('rammehodet er avkortet')
      size = { width: be16(bytes, offset + 5), height: be16(bytes, offset + 3) }
    }
    // APP1 normally comes before the frame, but nothing says it must, so the
    // turn is applied once at the end rather than to whichever came first.
    if (marker === 0xe1) {
      orientation = readExifOrientation(bytes, offset + 2, offset + length) ?? orientation
    }

    offset += length

    if (marker === 0xda) {
      // Entropy-coded data follows the scan header and is not length-prefixed:
      // it runs to the next real marker. `FF 00` is an escaped `FF`, and
      // `FF D0`–`FF D7` are restart markers inside the stream.
      scanned = true
      while (offset + 1 < bytes.length) {
        if (bytes[offset] === 0xff) {
          const next = bytes[offset + 1]
          if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break
        }
        offset += 1
      }
      if (offset + 1 >= bytes.length) return broken('bildedataene er avkortet')
    }
  }

  return broken('avslutningsmarkøren (EOI) mangler')
}

/* ------------------------------------------------------------------ *
 * WEBP
 * ------------------------------------------------------------------ */

/**
 * A RIFF container: the outer size has to match the file, and the picture's
 * size comes from whichever bitstream chunk is present. Chunks are walked
 * rather than assumed to be first, because a file with an embedded colour
 * profile puts `ICCP` between the header and the picture.
 */
function validateWebp(bytes: Uint8Array): Result<Size> {
  if (bytes.length < 20) return broken('for kort til å være en WEBP')
  if (le32(bytes, 4) + 8 !== bytes.length) return broken('RIFF-lengden stemmer ikke med filen')

  let offset = 12
  let size: Size | null = null
  // `VP8X` declares the canvas and carries no pixels: a file with nothing but
  // that chunk is a header claiming a size, which is the one thing this module
  // does not accept on faith. `ANMF` counts, since an animation's frames hold
  // their own bitstreams.
  let picture = false

  while (offset + 8 <= bytes.length) {
    const fourcc = ascii(bytes, offset, 4)
    const length = le32(bytes, offset + 4)
    const data = offset + 8
    if (length > bytes.length - data) return broken(`chunken «${fourcc}» går utenfor filen`)

    if (fourcc === 'VP8X' && length >= 10) {
      size = { width: le24(bytes, data + 4) + 1, height: le24(bytes, data + 7) + 1 }
    } else if (fourcc === 'VP8 ') {
      if (length < 10) return broken('VP8-rammen er avkortet')
      if (!startsWith(bytes, [0x9d, 0x01, 0x2a], data + 3)) return broken('VP8-synkronkoden mangler')
      picture = true
      size ??= { width: le16(bytes, data + 6) & 0x3fff, height: le16(bytes, data + 8) & 0x3fff }
    } else if (fourcc === 'VP8L') {
      if (length < 5 || bytes[data] !== 0x2f) return broken('VP8L-rammen er avkortet')
      picture = true
      const bits = le32(bytes, data + 1)
      size ??= { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    } else if (fourcc === 'ANMF') {
      picture = true
    }

    offset = data + length + (length & 1)
  }

  if (offset !== bytes.length) return broken('en chunk går utenfor filen')
  if (!size || !picture) return broken('bildedataene mangler')
  return ok(size)
}
