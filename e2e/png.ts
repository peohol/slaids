/**
 * Pixel assertions for the e2e suite.
 *
 * The decoder itself lives in `src/render/png.ts`, because the headless preview
 * needs the same one: a rendered PNG is read back there to prove it is not a
 * blank rectangle, and two decoders would be two chances for one of them to be
 * subtly wrong. What stays here is the question only a screenshot test asks.
 */

export { decodePng, distinctColours, type Bitmap } from '../src/render/png'
import { decodePng, type Bitmap } from '../src/render/png'

/**
 * The empty space to the left and right of all the ink in a screenshot.
 *
 * Takes the picture rather than the element, because the questions that need
 * this are about ink that has no node to measure: a placeholder and a list
 * marker are both pseudo-elements, and a `text-align` that computes to
 * `center` says nothing about where either one is actually painted. A marker
 * is also painted *outside* its item, so the crop that answers the question is
 * sometimes the surrounding block and one item's worth of rows — which is a
 * clip, not a locator. The top-left corner is taken as the background, so
 * anything drawn differently from it counts.
 */
export function inkMargins(png: Buffer): { left: number; right: number } {
  const bitmap = decodePng(png)
  const background = bitmap.at(0, 0)
  let left = bitmap.width
  let right = -1
  for (let x = 0; x < bitmap.width; x += 1) {
    for (let y = 0; y < bitmap.height; y += 1) {
      const pixel = bitmap.at(x, y)
      const differs = pixel.some((value, index) => Math.abs(value - background[index]) > 12)
      if (!differs) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      break
    }
  }
  return { left, right: bitmap.width - 1 - right }
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
