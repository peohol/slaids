import { describe, expect, it } from 'vitest'
import { probeImageFormat } from './imageBytes'
import { realImages } from './testImages'

/**
 * Sniffing only. Whether the rest of the file exists is `imageFile.test.ts`'s
 * question, and the split is the point: a signature says what something wants
 * to be called, never that it is complete.
 */
function bytes(...parts: (number | number[] | string)[]): Uint8Array {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') out.push(...[...part].map((char) => char.charCodeAt(0)))
    else if (Array.isArray(part)) out.push(...part)
    else out.push(part)
  }
  return new Uint8Array(out)
}

const be32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

describe('probeImageFormat', () => {
  it('kjenner igjen formatene på ekte filer', () => {
    expect(probeImageFormat(realImages.png())).toEqual({ mimeType: 'image/png', isVector: false })
    expect(probeImageFormat(realImages.jpeg())).toEqual({ mimeType: 'image/jpeg', isVector: false })
    expect(probeImageFormat(realImages.gif())).toEqual({ mimeType: 'image/gif', isVector: false })
    expect(probeImageFormat(realImages.webp())).toEqual({ mimeType: 'image/webp', isVector: false })
  })

  it('kjenner igjen AVIF, både som hovedmerke og blant de kompatible', () => {
    expect(probeImageFormat(bytes(be32(20), 'ftyp', 'avif', be32(0), 'mif1'))).toEqual({
      mimeType: 'image/avif',
      isVector: false,
    })
    expect(probeImageFormat(bytes(be32(24), 'ftyp', 'mif1', be32(0), 'mif1', 'avif'))).toMatchObject({
      mimeType: 'image/avif',
    })
  })

  it('kjenner igjen SVG som tekst, også med byte order mark', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>')
    expect(probeImageFormat(svg)).toEqual({ mimeType: 'image/svg+xml', isVector: true })
    expect(probeImageFormat(bytes([0xef, 0xbb, 0xbf], '<svg viewBox="0 0 1 1"/>'))).toMatchObject({
      mimeType: 'image/svg+xml',
    })
  })

  it('sier nei til alt som ikke ser ut som et bilde', () => {
    expect(probeImageFormat(new TextEncoder().encode('{"ikke":"et bilde"}'))).toBeNull()
    expect(probeImageFormat(new TextEncoder().encode('<html><body/></html>'))).toBeNull()
    expect(probeImageFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    expect(probeImageFormat(new Uint8Array())).toBeNull()
  })

  it('sier nei til HEIC, som ingen nettleser tegner', () => {
    expect(probeImageFormat(bytes(be32(20), 'ftyp', 'heic', be32(0), 'mif1'))).toBeNull()
  })

  it('kjenner bare igjen formatet – den lover ikke at filen er hel', () => {
    // A signature and nothing else still sniffs as PNG. That is exactly why
    // `readRasterImage` exists and why nothing stores an asset on this alone.
    const headerOnly = realImages.png().subarray(0, 16)
    expect(probeImageFormat(headerOnly)).toEqual({ mimeType: 'image/png', isVector: false })
  })
})
