/**
 * What is dropped from a file without redrawing it, and what is never dropped.
 *
 * Every fixture is a real encoder's output with something spliced in, and every
 * result is handed back to `readRasterImage` — the same validator the asset door
 * uses — so "stripped" always also means "still a complete picture".
 */

import { describe, expect, it } from 'vitest'
import { ascii, be32, le32 } from './imageBytes'
import { readExifOrientation, readRasterImage } from './imageFile'
import { orientationSegment, rasterFacts, stripRasterMetadata } from './imageMetadata'
import { IMAGE_HEIGHT, IMAGE_WIDTH, jpegWithExifOrientation, realImages } from './testImages'

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

let crcTable: Uint32Array | null = null
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i += 1) {
      let value = i
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      crcTable[i] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: number[]): Uint8Array {
  const body = new Uint8Array([...asciiBytes(type), ...data])
  const crc = crc32(body)
  const length = data.length
  return concat(
    [length >>> 24, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff],
    body,
    [crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff],
  )
}

/** The PNG fixture with these chunks spliced in after IHDR. */
function pngWith(...chunks: Uint8Array[]): Uint8Array {
  const source = realImages.png()
  const afterIhdr = 8 + 12 + 13
  return concat(source.subarray(0, afterIhdr), ...chunks, source.subarray(afterIhdr))
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

  it('is animated when it has an animation control chunk', () => {
    expect(rasterFacts(realImages.png(), 'image/png')).toEqual({ animated: false, lossy: false })
    const apng = pngWith(pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]))
    expect(rasterFacts(apng, 'image/png').animated).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * WEBP
 * ------------------------------------------------------------------ */

/** A RIFF chunk, padded to an even length as the container requires. */
function webpChunk(fourcc: string, data: number[]): Uint8Array {
  const length = data.length
  return concat(
    asciiBytes(fourcc),
    [length & 0xff, (length >>> 8) & 0xff, (length >>> 16) & 0xff, (length >>> 24) & 0xff],
    data,
    length & 1 ? [0] : [],
  )
}

/** The lossy fixture with `chunk` spliced in before the picture, and the RIFF size fixed. */
function webpWith(chunk: Uint8Array, flag = 0): Uint8Array {
  const source = realImages.webp()
  // VP8X (12 + 8 + 10 bytes) then ICCP; find where the picture chunk starts.
  let offset = 12
  while (ascii(source, offset, 4) !== 'VP8 ') offset += 8 + le32(source, offset + 4) + (le32(source, offset + 4) & 1)
  const out = concat(source.subarray(0, offset), chunk, source.subarray(offset))
  const size = out.length - 8
  out[4] = size & 0xff
  out[5] = (size >>> 8) & 0xff
  out[6] = (size >>> 16) & 0xff
  out[7] = (size >>> 24) & 0xff
  // The VP8X flags byte announces the extra chunk.
  out[20] |= flag
  return out
}

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
