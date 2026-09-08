/**
 * What is dropped from a file without redrawing it, and what is never dropped.
 *
 * Every fixture is a real encoder's output with something spliced in, and every
 * result is handed back to `readRasterImage` — the same validator the asset door
 * uses — so "stripped" always also means "still a complete picture".
 */

import { describe, expect, it } from 'vitest'
import { ascii, be32, le32 } from './imageBytes'
import { readExifOrientation, readRasterImage, readTiffOrientation } from './imageFile'
import { orientationSegment, rasterFacts, stripRasterMetadata } from './imageMetadata'
import {
  EXIF_MARKER,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  exifTiffBlock,
  jpegWithExifOrientation,
  pngChunk,
  pngWith,
  realImages,
  webpChunk,
  webpWith,
} from './testImages'

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)))
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of arrays) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function contains(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text, (char) => char.charCodeAt(0))
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

/* ------------------------------------------------------------------ *
 * JPEG
 * ------------------------------------------------------------------ */

/** The fixture with a segment spliced in right after SOI. */
function jpegWithSegment(marker: number, payload: number[]): Uint8Array {
  const source = realImages.jpeg()
  const length = payload.length + 2
  return concat(source.subarray(0, 2), [0xff, marker, length >> 8, length & 0xff, ...payload], source.subarray(2))
}

const asciiBytes = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0))

describe('a JPEG', () => {
  it('is left alone when it carries nothing but what a decoder reads', () => {
    // JFIF and an ICC profile: both stay, so there is nothing to strip.
    expect(stripRasterMetadata(realImages.jpeg(), 'image/jpeg')).toBeNull()
  })

  it('loses its Exif — camera, GPS, thumbnail and all — but keeps its colour profile', () => {
    const tagged = jpegWithExifOrientation(1)
    expect(contains(tagged, 'Exif')).toBe(true)

    const stripped = stripRasterMetadata(tagged, 'image/jpeg')
    expect(stripped).not.toBeNull()
    expect(contains(stripped!, 'Exif')).toBe(false)
    expect(contains(stripped!, 'ICC_PROFILE')).toBe(true)
    expect(stripped!.length).toBeLessThan(tagged.length)

    const read = readRasterImage(stripped!)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toEqual({ mimeType: 'image/jpeg', width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
  })

  it('keeps the one Exif tag that is drawn: which way is up', () => {
    // Turned a quarter turn by its tag, and carrying a comment worth dropping.
    const tagged = jpegWithExifOrientation(6)
    const comment = asciiBytes('Taken on holiday')
    const sideways = concat(
      tagged.subarray(0, 2),
      [0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff, ...comment],
      tagged.subarray(2),
    )
    const before = readRasterImage(sideways)
    const stripped = stripRasterMetadata(sideways, 'image/jpeg')!
    const after = readRasterImage(stripped)

    // The picture is still reported turned a quarter turn, because the
    // orientation was written back as the one-tag Exif it deserves.
    expect(before.ok && after.ok && after.value.width === before.value.width).toBe(true)
    if (after.ok) expect(after.value).toMatchObject({ width: IMAGE_HEIGHT, height: IMAGE_WIDTH })
    expect(stripped.length).toBeLessThan(sideways.length)
    expect(contains(stripped, 'Exif')).toBe(true)
    expect(contains(stripped, 'holiday')).toBe(false)
  })

  it('leaves a file alone when stripping it would gain nothing', () => {
    // The fixture's Exif is already nothing but the orientation.
    expect(stripRasterMetadata(jpegWithExifOrientation(6), 'image/jpeg')).toBeNull()
  })

  it('writes the orientation segment where a decoder looks for it', () => {
    const segment = orientationSegment(8)
    expect(segment[0]).toBe(0xff)
    expect(segment[1]).toBe(0xe1)
    expect(ascii(segment, 4, 4)).toBe('Exif')
    // Big-endian TIFF, one entry, tag 0x0112, SHORT, value 8 — and the same
    // reader the validator uses finds exactly that in it.
    expect(ascii(segment, 10, 2)).toBe('MM')
    expect(readExifOrientation(segment, 4, segment.length)).toBe(8)
  })

  it('drops comments and photo-editor blocks and keeps Adobe\'s colour tag', () => {
    const commented = jpegWithSegment(0xfe, asciiBytes('Created with something'))
    const withAdobe = concat(
      commented.subarray(0, 2),
      [0xff, 0xee, 0x00, 0x0e, ...asciiBytes('Adobe'), 0, 100, 0, 0, 0, 0, 1],
      commented.subarray(2),
    )
    const stripped = stripRasterMetadata(withAdobe, 'image/jpeg')!
    expect(contains(stripped, 'Created with')).toBe(false)
    expect(contains(stripped, 'Adobe')).toBe(true)
    expect(readRasterImage(stripped).ok).toBe(true)
  })

  it('is never animated and always lossy', () => {
    expect(rasterFacts(realImages.jpeg(), 'image/jpeg')).toEqual({ animated: false, lossy: true })
  })
})

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

/** Bytes nobody draws, standing in for the camera, the place and the thumbnail. */
const DESCRIPTIVE = [...'GPS-hemmelighet'].map((character) => character.charCodeAt(0))

/** The orientation an Exif block asks for, whichever way the file wrote it. */
function orientationOf(block: Uint8Array): number | null {
  return ascii(block, 0, 6) === 'Exif\u0000\u0000'
    ? readExifOrientation(block, 0, block.length)
    : readTiffOrientation(block, 0, block.length)
}

/** The data of the first chunk of this type, or `null` when there is none. */
function pngChunkData(bytes: Uint8Array, type: string): Uint8Array | null {
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = be32(bytes, offset)
    if (ascii(bytes, offset + 4, 4) === type) return bytes.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
  }
  return null
}

function webpChunkData(bytes: Uint8Array, fourcc: string): Uint8Array | null {
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const length = le32(bytes, offset + 4)
    if (ascii(bytes, offset, 4) === fourcc) return bytes.subarray(offset + 8, offset + 8 + length)
    offset += 8 + length + (length & 1)
  }
  return null
}

function pngChunkTypes(bytes: Uint8Array): string[] {
  const types: string[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    types.push(ascii(bytes, offset + 4, 4))
    offset += 12 + be32(bytes, offset)
  }
  return types
}

describe('a PNG', () => {
  it('loses its text, its timestamp and its Exif but keeps every chunk a decoder reads', () => {
    const tagged = pngWith(
      pngChunk('tEXt', asciiBytes('Author\0Somebody')),
      pngChunk('eXIf', [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0]),
      pngChunk('tIME', [7, 0xea, 1, 1, 0, 0, 0]),
      pngChunk('gAMA', [0, 0, 0xb1, 0x8f]),
    )
    expect(readRasterImage(tagged).ok).toBe(true)

    const stripped = stripRasterMetadata(tagged, 'image/png')!
    const [ihdr, ...rest] = pngChunkTypes(realImages.png())
    expect(pngChunkTypes(stripped)).toEqual([ihdr, 'gAMA', ...rest])
    expect(contains(stripped, 'Somebody')).toBe(false)
    const read = readRasterImage(stripped)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toMatchObject({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
  })

  it('is left alone when it carries no metadata', () => {
    expect(stripRasterMetadata(realImages.png(), 'image/png')).toBeNull()
  })

  it('keeps which way is up, and drops everything else in the Exif block', () => {
    // An orientation that turns the picture a quarter turn, and a block that
    // also carries what nobody draws.
    const tagged = pngWith(
      pngChunk('tEXt', asciiBytes('Author\0Somebody')),
      pngChunk('eXIf', [...exifTiffBlock(6), ...DESCRIPTIVE]),
    )
    const stripped = stripRasterMetadata(tagged, 'image/png')!

    // Dropping it would show the photograph on its side.
    expect(orientationOf(pngChunkData(stripped, 'eXIf')!)).toBe(6)
    expect(pngChunkTypes(stripped)).not.toContain('tEXt')
    expect(contains(stripped, 'GPS-hemmelighet')).toBe(false)
    expect(contains(stripped, 'Somebody')).toBe(false)
    // Still a picture, and still the same one.
    const read = readRasterImage(stripped)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toMatchObject({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
  })

  it('answers in the shape the file used, so no decoder that read the original misreads it', () => {
    // PNG does not ask for the marker, but a file that copied a JPEG's segment
    // whole has one. What replaces it is written the same way.
    const tagged = pngWith(
      pngChunk('eXIf', [...EXIF_MARKER, ...exifTiffBlock(8), ...DESCRIPTIVE]),
    )
    const data = pngChunkData(stripRasterMetadata(tagged, 'image/png')!, 'eXIf')!
    expect(ascii(data, 0, 6)).toBe('Exif\u0000\u0000')
    expect(orientationOf(data)).toBe(8)
  })

  it('drops an Exif block that only says «as stored»', () => {
    // Orientation 1 changes nothing on screen, so nothing is worth keeping.
    const tagged = pngWith(pngChunk('eXIf', [...exifTiffBlock(1), ...DESCRIPTIVE]))
    const stripped = stripRasterMetadata(tagged, 'image/png')!
    expect(pngChunkTypes(stripped)).not.toContain('eXIf')
    expect(pngChunkTypes(stripped)).toEqual(pngChunkTypes(realImages.png()))
  })

  it('is animated when it has an animation control chunk', () => {
    expect(rasterFacts(realImages.png(), 'image/png')).toEqual({ animated: false, lossy: false })
    const apng = pngWith(pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]))
    expect(rasterFacts(apng, 'image/png').animated).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * WEBP
 * ------------------------------------------------------------------ */

function webpChunkTypes(bytes: Uint8Array): string[] {
  const types: string[] = []
  let offset = 12
  while (offset + 8 <= bytes.length) {
    types.push(ascii(bytes, offset, 4))
    const length = le32(bytes, offset + 4)
    offset += 8 + length + (length & 1)
  }
  return types
}

describe('a WEBP', () => {
  it('loses its Exif and XMP chunks, clears the flags that announced them and keeps its profile', () => {
    const tagged = webpWith(webpChunk('EXIF', [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0]), 0x08)
    expect(readRasterImage(tagged).ok).toBe(true)
    expect(tagged[20] & 0x08).toBe(0x08)

    const stripped = stripRasterMetadata(tagged, 'image/webp')!
    expect(webpChunkTypes(stripped)).toEqual(['VP8X', 'ICCP', 'VP8 '])
    expect(stripped[20] & 0x08).toBe(0)
    expect(le32(stripped, 4)).toBe(stripped.length - 8)
    const read = readRasterImage(stripped)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toMatchObject({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
  })

  it('keeps which way is up, and the flag that announces it', () => {
    const tagged = webpWith(webpChunk('EXIF', [...exifTiffBlock(8), ...DESCRIPTIVE]), 0x08)
    expect(readRasterImage(tagged).ok).toBe(true)

    const stripped = stripRasterMetadata(tagged, 'image/webp')!
    expect(orientationOf(webpChunkData(stripped, 'EXIF')!)).toBe(8)
    // A header that cleared the flag would hide the chunk that is still there.
    expect(stripped[20] & 0x08).toBe(0x08)
    expect(contains(stripped, 'GPS-hemmelighet')).toBe(false)
    expect(le32(stripped, 4)).toBe(stripped.length - 8)
    const read = readRasterImage(stripped)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toMatchObject({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
  })

  it('answers in the shape the file used', () => {
    const tagged = webpWith(
      webpChunk('EXIF', [...EXIF_MARKER, ...exifTiffBlock(3), ...DESCRIPTIVE]),
      0x08,
    )
    const data = webpChunkData(stripRasterMetadata(tagged, 'image/webp')!, 'EXIF')!
    expect(ascii(data, 0, 6)).toBe('Exif\u0000\u0000')
    expect(orientationOf(data)).toBe(3)
  })

  it('drops an Exif chunk that only says «as stored»', () => {
    const tagged = webpWith(webpChunk('EXIF', [...exifTiffBlock(1), ...DESCRIPTIVE]), 0x08)
    const stripped = stripRasterMetadata(tagged, 'image/webp')!
    expect(webpChunkTypes(stripped)).toEqual(['VP8X', 'ICCP', 'VP8 '])
    expect(stripped[20] & 0x08).toBe(0)
  })

  it('is left alone when it carries no metadata', () => {
    expect(stripRasterMetadata(realImages.webp(), 'image/webp')).toBeNull()
  })

  it('tells a lossy file from a lossless one, and an animation from a still', () => {
    expect(rasterFacts(realImages.webp(), 'image/webp')).toEqual({ animated: false, lossy: true })
    expect(rasterFacts(realImages.webpLossless(), 'image/webp')).toEqual({ animated: false, lossy: false })
    const animated = webpWith(webpChunk('ANMF', new Array(16).fill(0)), 0x02)
    expect(rasterFacts(animated, 'image/webp').animated).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * GIF and AVIF
 * ------------------------------------------------------------------ */

describe('other formats', () => {
  it('counts a GIF\'s frames', () => {
    const still = realImages.gif()
    expect(rasterFacts(still, 'image/gif')).toEqual({ animated: false, lossy: false })
    // The image block repeated: two frames.
    const header = still.subarray(0, 13 + 3 * 2)
    const image = still.subarray(header.length, still.length - 1)
    const animated = concat(header, image, image, [0x3b])
    expect(rasterFacts(animated, 'image/gif').animated).toBe(true)
    // Nothing is stripped from a GIF: it is left exactly as it is.
    expect(stripRasterMetadata(still, 'image/gif')).toBeNull()
  })

  it('reads an AVIF\'s brands for the animated one', () => {
    const ftyp = (brands: string[]): Uint8Array => {
      const size = 8 + brands.length * 4 + 4
      return concat(
        [size >>> 24, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff],
        asciiBytes('ftyp'),
        asciiBytes(brands[0]),
        [0, 0, 0, 0],
        ...brands.slice(1).map((brand) => asciiBytes(brand)),
      )
    }
    expect(rasterFacts(ftyp(['avif', 'mif1']), 'image/avif')).toEqual({ animated: false, lossy: true })
    expect(rasterFacts(ftyp(['avis', 'avif']), 'image/avif').animated).toBe(true)
    expect(rasterFacts(ftyp(['avif', 'avis']), 'image/avif').animated).toBe(true)
  })
})
