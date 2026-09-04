import { describe, expect, it } from 'vitest'
import { readRasterImage } from './imageFile'
import { IMAGE_HEIGHT, IMAGE_WIDTH, jpegWithExifOrientation, realImages } from './testImages'

const formats = Object.entries(realImages) as [keyof typeof realImages, () => Uint8Array][]

function accepted(bytes: Uint8Array) {
  const result = readRasterImage(bytes)
  if (!result.ok) throw new Error(`Forventet et gyldig bilde, fikk ${result.error.code}: ${result.error.message}`)
  return result.value
}

function rejected(bytes: Uint8Array) {
  const result = readRasterImage(bytes)
  if (result.ok) throw new Error('Forventet at filen ble avvist')
  return result.error
}

describe('readRasterImage – ekte filer', () => {
  it.each(formats)('godtar en komplett %s og leser størrelsen ut av bitstrømmen', (_name, load) => {
    expect(accepted(load())).toMatchObject({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
  })

  it('leser størrelsen fra bildedataene selv når en fargeprofil ligger foran dem', () => {
    // The WEBP fixtures put `ICCP` between the header and the picture, so a
    // reader that assumes the picture is the first chunk gets nothing here.
    expect(accepted(realImages.webp())).toMatchObject({ mimeType: 'image/webp', width: 3 })
    expect(accepted(realImages.webpLossless())).toMatchObject({ mimeType: 'image/webp', width: 3 })
  })
})

describe('readRasterImage – avkortede filer', () => {
  it.each(formats)('avviser en %s som er kuttet på midten', (_name, load) => {
    const bytes = load()
    expect(rejected(bytes.subarray(0, Math.floor(bytes.length / 2))).code).toBe('INVALID_IMAGE')
  })

  it.each(formats)('avviser en %s som mangler de siste bytene', (_name, load) => {
    const bytes = load()
    expect(rejected(bytes.subarray(0, bytes.length - 1)).code).toBe('INVALID_IMAGE')
  })

  it('avviser en fil som bare er et filhode', () => {
    // Exactly what a hand-built test fixture looks like: a real signature, a
    // real IHDR, and no picture. It sniffs as PNG and is not one.
    const png = realImages.png()
    expect(rejected(png.subarray(0, 33)).code).toBe('INVALID_IMAGE')
  })
})

describe('readRasterImage – ødelagte filer', () => {
  it('avviser en PNG der en byte er endret, fordi sjekksummen ikke stemmer', () => {
    const bytes = realImages.png()
    bytes[40] ^= 0xff
    expect(rejected(bytes).code).toBe('INVALID_IMAGE')
  })

  it('avviser en PNG med data etter IEND', () => {
    const bytes = realImages.png()
    const padded = new Uint8Array(bytes.length + 4)
    padded.set(bytes)
    expect(rejected(padded).code).toBe('INVALID_IMAGE')
  })

  it('avviser en WEBP der RIFF-lengden lyver', () => {
    const bytes = realImages.webp()
    bytes[4] = (bytes[4] + 1) & 0xff
    expect(rejected(bytes).code).toBe('INVALID_IMAGE')
  })

  it('avviser en GIF uten avslutningsmerke', () => {
    const bytes = realImages.gif()
    bytes[bytes.length - 1] = 0x00
    expect(rejected(bytes).code).toBe('INVALID_IMAGE')
  })

  it('avviser en JPEG uten EOI', () => {
    const bytes = realImages.jpeg()
    bytes[bytes.length - 1] = 0x00
    expect(rejected(bytes).code).toBe('INVALID_IMAGE')
  })
})

describe('readRasterImage – forfalskninger', () => {
  it('avviser et filhode med tilfeldig innhold bak', () => {
    const fake = new Uint8Array(64)
    fake.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    fake.fill(0x41, 8)
    expect(rejected(fake).code).toBe('INVALID_IMAGE')
  })

  it('avviser en GIF som bare er et hode og et avslutningsmerke', () => {
    // It declares 1024 × 768 and contains no picture at all. The declared size
    // is exactly what this module does not take anyone's word for.
    const header = [...'GIF89a'].map((char) => char.charCodeAt(0))
    const gif = new Uint8Array([...header, 0, 4, 0, 3, 0x00, 0, 0, 0x3b])
    expect(rejected(gif).code).toBe('INVALID_IMAGE')
  })

  it('avviser en WEBP som bare har VP8X-hodet og ingen bildedata', () => {
    const webp = new Uint8Array(30)
    const put = (text: string, at: number) =>
      [...text].forEach((char, index) => (webp[at + index] = char.charCodeAt(0)))
    put('RIFF', 0)
    webp[4] = 22
    put('WEBP', 8)
    put('VP8X', 12)
    webp[16] = 10
    webp[24] = 15
    webp[27] = 7
    expect(rejected(webp).code).toBe('INVALID_IMAGE')
  })

  it('avviser noe som ikke er et bilde i det hele tatt', () => {
    expect(rejected(new TextEncoder().encode('{"ikke":"et bilde"}')).code).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    )
    expect(rejected(new Uint8Array()).code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('avviser AVIF, som ikke kan verifiseres headless ennå', () => {
    const avif = new Uint8Array([
      0, 0, 0, 20, ...[...'ftyp'].map((c) => c.charCodeAt(0)),
      ...[...'avif'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0,
      ...[...'mif1'].map((c) => c.charCodeAt(0)),
    ])
    const error = rejected(avif)
    expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(error.message).toContain('AVIF')
  })

  it('sender SVG videre til sin egen validator i stedet for å gjette', () => {
    const svg = new TextEncoder().encode('<svg viewBox="0 0 1 1"/>')
    expect(rejected(svg).code).toBe('INVALID_ARGUMENT')
  })
})

/* ------------------------------------------------------------------ *
 * EXIF orientation
 * ------------------------------------------------------------------ */

describe('readRasterImage – EXIF-orientering', () => {
  it('rapporterer størrelsen slik bildet faktisk tegnes', () => {
    // A phone photograph is stored the way the sensor read it and turned by a
    // tag. Every renderer draws it turned, so the frame header's numbers are
    // not the picture's — and a preview that trusted them would frame the photo
    // in a box of the wrong shape while the editor framed it correctly.
    for (const orientation of [5, 6, 7, 8]) {
      expect(accepted(jpegWithExifOrientation(orientation))).toMatchObject({
        width: IMAGE_HEIGHT,
        height: IMAGE_WIDTH,
      })
    }
  })

  it('lar et bilde som ikke er snudd være i fred', () => {
    for (const orientation of [1, 2, 3, 4]) {
      expect(accepted(jpegWithExifOrientation(orientation))).toMatchObject({
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
      })
    }
  })

  it('leser begge byterekkefølgene EXIF tillater', () => {
    expect(accepted(jpegWithExifOrientation(6, false))).toMatchObject({
      width: IMAGE_HEIGHT,
      height: IMAGE_WIDTH,
    })
  })

  it('lar en uleselig orientering stå: en ødelagt tagg snur ingenting', () => {
    // Bounds and shape are checked at every step — what is parsed here is
    // whatever the file happened to contain, and it must never decide the size
    // on a guess.
    const broken = jpegWithExifOrientation(6)
    broken[2 + 4] = 0x41 // "Exif" becomes "Axif"
    expect(accepted(broken)).toMatchObject({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })

    const nonsense = jpegWithExifOrientation(99)
    expect(accepted(nonsense)).toMatchObject({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT })
  })
})
