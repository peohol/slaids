/**
 * Real image files, for tests that must not be fooled by a header.
 *
 * Every one of these is a complete 3 × 2 picture produced by Chromium's own
 * encoders (a canvas, `toDataURL`), not bytes assembled by hand: the point of
 * `domain/imageFile.ts` is that a hand-built header is *not* an image, so a
 * test that proves the happy path with one would prove nothing. The WEBP files
 * carry an embedded colour profile, which is why the picture data is not the
 * first chunk — exactly the case a validator that assumes it is gets wrong.
 *
 * The GIF is assembled by hand, because a canvas cannot export one. Every
 * fixture here — that one included — was checked by loading it into an `<img>`
 * in Chromium and reading `naturalWidth`/`naturalHeight`: a real decoder says
 * they are pictures, and says they are the size these constants claim.
 *
 * Not a `.test.ts` file so both the domain and the agent tests can use it.
 */

export const IMAGE_WIDTH = 3
export const IMAGE_HEIGHT = 2

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAGUlEQVR4AWK6eWb/f9+0BjBmKpl1kAEGAAAAAP//6icauAAAAAZJREFUAwCuCgmboF5xCwAAAABJRU5ErkJggg=='

const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAZEAEBAQEBAQAAAAAAAAAAAAACAQARA1H/xAAUAQEAAAAAAAAAAAAAAAAAAAAE/8QAFhEAAwAAAAAAAAAAAAAAAAAAAAEx/9oADAMBAAIRAxEAPwCQ2vRptVJXqVvbb9zMzVAjp//Z'

/** Lossy: a `VP8X` header, an `ICCP` colour profile, then the `VP8 ` picture. */
const WEBP_BASE64 =
  'UklGRhwCAABXRUJQVlA4WAoAAAAgAAAAAgAAAQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggLgAAAJABAJ0BKgMAAgACQDglAE6AHj6LAAD+wP/HP7nVt1HTUDR3Z2ioEAcGyRTXYAA='

/** Lossless: the same, but the picture is a `VP8L` chunk. */
const WEBP_LOSSLESS_BASE64 =
  'UklGRgQCAABXRUJQVlA4WAoAAAAgAAAAAgAAAQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDhMFQAAAC8CQAAAD1CzNzH+B3D+w8EERPQ/AgA='

/** A 3 × 2 GIF87a: header, global colour table, one image, trailer. */
const GIF_BASE64 = 'R0lGODdhAwACAIAAAE1mgNnMvywAAAAAAwACAAACA4SPCgA7'

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const realImages = {
  png: () => decodeBase64(PNG_BASE64),
  jpeg: () => decodeBase64(JPEG_BASE64),
  gif: () => decodeBase64(GIF_BASE64),
  webp: () => decodeBase64(WEBP_BASE64),
  webpLossless: () => decodeBase64(WEBP_LOSSLESS_BASE64),
}

export const realImageBase64 = {
  png: PNG_BASE64,
  jpeg: JPEG_BASE64,
  gif: GIF_BASE64,
  webp: WEBP_BASE64,
}

/**
 * The JPEG fixture with an EXIF APP1 segment spliced in after the SOI marker,
 * asking for `orientation`.
 *
 * Built here rather than checked in as a second fixture, because the point is
 * the parse: a segment with a byte order, a TIFF header, an IFD offset and one
 * entry is exactly what `readExifOrientation` has to walk, and assembling it in
 * the open is what makes it obvious which byte the answer comes out of. The
 * picture data is a real encoder's, unchanged — only the tag is added.
 */
export function jpegWithExifOrientation(orientation: number, little = true): Uint8Array {
  const tiff: number[] = []
  const u16 = (value: number): void => {
    tiff.push(little ? value & 0xff : value >> 8, little ? value >> 8 : value & 0xff)
  }
  const u32 = (value: number): void => {
    const big = [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
    tiff.push(...(little ? big.reverse() : big))
  }
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d])) // "II" or "MM"
  u16(0x002a)
  u32(8) // IFD0 begins right after the eight-byte TIFF header
  u16(1) // one entry
  u16(0x0112) // Orientation
  u16(3) // SHORT
  u32(1) // one value…
  u16(orientation) // …in the first half of the four-byte value field
  u16(0)

  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff] // "Exif\0\0"
  const length = payload.length + 2
  const segment = [0xff, 0xe1, length >> 8, length & 0xff, ...payload]

  const source = realImages.jpeg()
  const out = new Uint8Array(source.length + segment.length)
  out.set(source.subarray(0, 2), 0) // SOI
  out.set(segment, 2)
  out.set(source.subarray(2), 2 + segment.length)
  return out
}
