import { describe, expect, it } from 'vitest'
import { probeImage } from './imageBytes'

/**
 * Headers built by hand rather than fixture files: what is being tested is the
 * reading of the bytes, and a hand-built header says exactly which bytes.
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

const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const le16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff]
const le24 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]
const be16 = (value: number) => [(value >>> 8) & 0xff, value & 0xff]

describe('probeImage', () => {
  it('leser PNG-størrelsen fra IHDR', () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      be32(13),
      'IHDR',
      be32(1600),
      be32(900),
      [8, 6, 0, 0, 0],
    )
    expect(probeImage(png)).toEqual({
      mimeType: 'image/png',
      isVector: false,
      width: 1600,
      height: 900,
    })
  })

  it('leser GIF-størrelsen fra skjermbeskrivelsen', () => {
    const gif = bytes('GIF89a', le16(320), le16(240), [0x00, 0x00])
    expect(probeImage(gif)).toMatchObject({ mimeType: 'image/gif', width: 320, height: 240 })
  })

  it('går gjennom JPEG-markørene til en start-of-frame', () => {
    const jpeg = bytes(
      [0xff, 0xd8, 0xff, 0xe0],
      be16(16),
      'JFIF',
      [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
      [0xff, 0xc0],
      be16(17),
      8,
      be16(480),
      be16(640),
      [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    )
    expect(probeImage(jpeg)).toMatchObject({ mimeType: 'image/jpeg', width: 640, height: 480 })
  })

  it('leser WEBP-størrelsen fra VP8X-chunken', () => {
    const webp = bytes('RIFF', be32(30), 'WEBP', 'VP8X', be32(10), [0, 0, 0, 0], le24(1023), le24(511))
    expect(probeImage(webp)).toMatchObject({ mimeType: 'image/webp', width: 1024, height: 512 })
  })

  it('kjenner igjen AVIF uten å kunne måle den', () => {
    const avif = bytes(be32(20), 'ftyp', 'avif', be32(0), 'mif1')
    expect(probeImage(avif)).toEqual({
      mimeType: 'image/avif',
      isVector: false,
      width: 0,
      height: 0,
    })
  })

  it('kjenner igjen AVIF som bare lister merket blant de kompatible', () => {
    const avif = bytes(be32(24), 'ftyp', 'mif1', be32(0), 'mif1', 'avif')
    expect(probeImage(avif)).toMatchObject({ mimeType: 'image/avif' })
  })

  it('kjenner igjen SVG som tekst, også med byte order mark', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>')
    expect(probeImage(svg)).toMatchObject({ mimeType: 'image/svg+xml', isVector: true })
    expect(probeImage(bytes([0xef, 0xbb, 0xbf], '<svg viewBox="0 0 1 1"/>'))).toMatchObject({
      mimeType: 'image/svg+xml',
    })
  })

  it('sier nei til alt som ikke er et bilde', () => {
    expect(probeImage(new TextEncoder().encode('{"ikke":"et bilde"}'))).toBeNull()
    expect(probeImage(new TextEncoder().encode('<html><body/></html>'))).toBeNull()
    expect(probeImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    expect(probeImage(new Uint8Array())).toBeNull()
  })

  it('sier nei til HEIC, som ingen nettleser tegner', () => {
    expect(probeImage(bytes(be32(20), 'ftyp', 'heic', be32(0), 'mif1'))).toBeNull()
  })
})
