/**
 * A small PNG reader, so a test can assert on pixels.
 *
 * Some things are only true on screen: whether an edge has a pale fringe along
 * it is not visible from the DOM, and a golden-image comparison would answer a
 * different question («is this the same picture as last time?») and need a
 * baseline per environment. Reading the pixels lets a test state the property
 * directly — no pixel here is lighter than the two colours that meet here — and
 * that holds on any machine.
 *
 * Handles the 8-bit RGB and RGBA PNGs Playwright's screenshots produce.
 */

import { inflateSync } from 'node:zlib'

export interface Bitmap {
  width: number
  height: number
  /** `[r, g, b, a]` at a pixel, in device pixels. */
  at(x: number, y: number): [number, number, number, number]
}

export function decodePng(buffer: Buffer): Bitmap {
  let offset = 8 // signature
  let width = 0
  let height = 0
  let channels = 4
  const chunks: Buffer[] = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
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

  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)

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
 * How much lighter the lightest pixel in a region is than *both* reference
 * colours — the signature of a third colour bleeding through from underneath.
 *
 * Blending two colours can only produce something between them, so a positive
 * result means something else is being painted there.
 */
export function lightestBleed(
  bitmap: Bitmap,
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  const ceiling = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]
  let worst = Number.NEGATIVE_INFINITY
  for (let x = 0; x < bitmap.width; x += 1) {
    for (let y = 0; y < bitmap.height; y += 1) {
      const [r, g, blue] = bitmap.at(x, y)
      worst = Math.max(worst, Math.min(r - ceiling[0], g - ceiling[1], blue - ceiling[2]))
    }
  }
  return worst
}
