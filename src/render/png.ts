/**
 * Reading a PNG back, so a test can assert on pixels.
 *
 * Some claims about a rendering are only true on screen. "The preview is not a
 * blank rectangle" is one of them: a slide's markup can be perfect, its
 * geometry correct and its stylesheet loaded, and the picture still come back
 * as one flat colour because the type never rendered. Nothing in the DOM says
 * so, and a golden-image comparison would answer a different question ("is this
 * the same picture as last time?") and need a baseline per environment.
 *
 * Reading the pixels lets a test state the property directly — this region
 * holds more than one colour; no pixel here is lighter than the two colours
 * that meet here — and that holds on any machine.
 *
 * Handles the 8-bit RGB and RGBA PNGs Chromium's screenshots produce. It lives
 * beside the rasterizer rather than in the e2e suite because both of them need
 * it, and a second decoder is a second thing to be subtly wrong.
 */

import { inflateSync } from 'node:zlib'

export interface Bitmap {
  width: number
  height: number
  /** `[r, g, b, a]` at a pixel, in device pixels. */
  at(x: number, y: number): [number, number, number, number]
}

export function decodePng(bytes: Uint8Array): Bitmap {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8 // signature
  let width = 0
  let height = 0
  let channels = 4
  const chunks: Uint8Array[] = []

  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      const depth = data[8]
      const colorType = data[9]
      if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG: depth ${depth}, colour type ${colorType}`)
      }
      channels = colorType === 6 ? 4 : 3
    } else if (type === 'IDAT') {
      chunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  const raw = new Uint8Array(inflateSync(concat(chunks)))
  const stride = width * channels
  const pixels = new Uint8Array(height * stride)

  // Undo the per-scanline filters. Each line starts with its filter byte.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      let value = line[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        const predicted = left + up - upLeft
        const dLeft = Math.abs(predicted - left)
        const dUp = Math.abs(predicted - up)
        const dUpLeft = Math.abs(predicted - upLeft)
        value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft
      }
      pixels[y * stride + x] = value & 0xff
    }
  }

  return {
    width,
    height,
    at(x, y) {
      const index = y * stride + x * channels
      return [
        pixels[index],
        pixels[index + 1],
        pixels[index + 2],
        channels === 4 ? pixels[index + 3] : 255,
      ]
    },
  }
}

/**
 * How many distinct colours a region holds.
 *
 * The cheapest honest way to say "something was drawn here": a flat rectangle
 * has one, and a rectangle with a glyph in it has several, whatever the glyph
 * happens to be. Capped, because the answer is only ever compared against a
 * small floor and counting every pixel of a full slide is wasted work.
 */
export function distinctColours(
  bitmap: Bitmap,
  region: { x: number; y: number; width: number; height: number },
  cap = 64,
): number {
  const seen = new Set<number>()
  for (let y = region.y; y < region.y + region.height && y < bitmap.height; y += 1) {
    for (let x = region.x; x < region.x + region.width && x < bitmap.width; x += 1) {
      const [r, g, b] = bitmap.at(x, y)
      seen.add((r << 16) | (g << 8) | b)
      if (seen.size >= cap) return seen.size
    }
  }
  return seen.size
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
