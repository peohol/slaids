/**
 * Pixel assertions for the e2e suite.
 *
 * The decoder itself lives in `src/render/png.ts`, because the headless preview
 * needs the same one: a rendered PNG is read back there to prove it is not a
 * blank rectangle, and two decoders would be two chances for one of them to be
 * subtly wrong. What stays here is the question only a screenshot test asks.
 */

export { decodePng, distinctColours, type Bitmap } from '../src/render/png'
import type { Bitmap } from '../src/render/png'

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
