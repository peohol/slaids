/**
 * The pixel sample that decides «photograph or graphics».
 *
 * The rest of the pipeline needs a canvas and is exercised in Playwright; this
 * function needs only pixels, and the rule it implements — what counts as flat
 * — is what keeps a diagram out of a lossy container and a gradient out of a
 * lossless one, so it is pinned here.
 */

import { describe, expect, it } from 'vitest'
import { isPhotographic } from '../domain/imageOptimization'
import { samplePixels } from './imagePipeline'

/** An `ImageData` in all but constructor: jsdom has no canvas to make one. */
function picture(width: number, height: number, at: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = at(x, y)
      const index = (y * width + x) * 4
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
      data[index + 3] = 255
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as unknown as ImageData
}

describe('samplePixels', () => {
  it('reads a flat fill as flat and few-coloured', () => {
    const sample = samplePixels(picture(64, 64, () => [200, 30, 30]))
    expect(sample.flatFraction).toBe(1)
    expect(sample.distinctFraction).toBeLessThan(0.01)
    expect(isPhotographic(sample)).toBe(false)
  })

  it('does not read a gradient as flat, whichever way it runs', () => {
    // Identical along one axis, different along the other: a gradient is
    // exactly the area a lossy codec handles well, so it must not count as flat.
    const vertical = samplePixels(picture(64, 64, (_x, y) => [y * 4, y * 4, 255]))
    const horizontal = samplePixels(picture(64, 64, (x) => [x * 4, 255, x * 4]))
    expect(vertical.flatFraction).toBe(0)
    expect(horizontal.flatFraction).toBe(0)
  })

  it('reads noisy, many-coloured pixels as a photograph', () => {
    let seed = 3
    const random = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const sample = samplePixels(
      picture(64, 64, (x, y) => [x * 3 + Math.floor(random() * 8), y * 3, 120 + Math.floor(random() * 8)]),
    )
    expect(sample.flatFraction).toBeLessThan(0.05)
    expect(sample.distinctFraction).toBeGreaterThan(0.5)
    expect(isPhotographic(sample)).toBe(true)
  })

  it('reads text on a background as graphics, however many colours its edges have', () => {
    // A few dark strokes on white: the edges are many-coloured, but almost every
    // sampled pixel is white with white beside and below it.
    const sample = samplePixels(
      picture(96, 96, (x, y) => (x % 12 === 0 || y % 16 === 0 ? [(x * 7) % 80, (y * 5) % 80, 40] : [255, 255, 255])),
    )
    expect(sample.flatFraction).toBeGreaterThan(0.6)
    expect(isPhotographic(sample)).toBe(false)
  })
})
