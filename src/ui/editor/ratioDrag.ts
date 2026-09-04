/**
 * Dragging the boundary between two zones.
 *
 * The gesture is continuous and what it leaves behind is not, and the two
 * halves of that are both here so neither lives inside a pointer handler where
 * it cannot be tested.
 *
 * While the pointer is down nothing is quantised: the boundary follows the
 * pointer exactly, trading weight between the two zones it sits between and
 * leaving every other zone alone. Snapping on the way would make the handle
 * stutter between rungs and, worse, would measure the fit of a layout the
 * author is only passing through.
 *
 * On release the layout snaps. The released geometry is a *wish* — arbitrary
 * floats — and the closest ratio the deck can actually be written in is what
 * gets committed. The commit can still be refused (a zone under its minimum,
 * content that no longer fits), so the nearest few rungs are tried in order of
 * how close they are: the pointer was already held inside what the content
 * allows, but a snap moves it a hair further, and dropping the whole gesture
 * over that hair would read as a dead handle.
 */

import { equalityKeysForDrag, rankedRatioQuantizations } from '../../domain/ratios'
import type { StructuralOutcome } from '../../domain/commands'
import type { Result } from '../../domain/result'

/** How many rungs a released handle may look down for one it may stop on. */
export const RATIO_SNAP_CANDIDATES = 6

/**
 * The ratios the handle shows while the pointer is still down, or `null` when
 * the move would collapse one of the two zones.
 *
 * Only the pair on either side of the boundary changes, and their sum is
 * preserved, so the rest of the split — and the split's total — stays exactly
 * as it was. `minShare` is each zone's minimum expressed in the same weight
 * units, so the handle simply stops where the layout stops being legal instead
 * of running past it and springing back on release.
 */
export function draggedWeights(
  original: readonly number[],
  boundary: number,
  deltaWeight: number,
  minShare: readonly number[],
): number[] | null {
  const weights = [...original]
  const pairTotal = weights[boundary] + weights[boundary + 1]
  const lowest = minShare[boundary]
  const highest = pairTotal - minShare[boundary + 1]
  const moved = Math.max(lowest, Math.min(weights[boundary] + deltaWeight, highest))
  if (!Number.isFinite(moved) || moved <= 0 || pairTotal - moved <= 0) return null
  weights[boundary] = moved
  weights[boundary + 1] = pairTotal - moved
  return weights
}

/**
 * Snap a released drag to whole ratios and commit the closest one `attempt`
 * accepts.
 *
 * `before` is the split's ratios as the gesture started, and it is what decides
 * which zones have to keep sharing a ratio: two zones written down as the same
 * number are the same size by construction, while the live widths this gesture
 * produced are floats that are never exactly equal. The pair the dragged
 * boundary sits between is exempt — dragging the boundary between two equal
 * zones is precisely the author asking for them to stop being equal.
 *
 * If every candidate is refused, the refusal handed back is the nearest one's:
 * it is the one that explains what is actually in the way.
 */
export function commitDraggedRatios(
  before: readonly number[],
  boundary: number,
  released: readonly number[],
  attempt: (weights: number[]) => Result<StructuralOutcome>,
): Result<StructuralOutcome> {
  const candidates = rankedRatioQuantizations(released, RATIO_SNAP_CANDIDATES, {
    equalityKeys: equalityKeysForDrag(before, boundary),
  })
  const nearest = attempt(candidates[0])
  if (nearest.ok) return nearest
  for (let index = 1; index < candidates.length; index += 1) {
    const fallback = attempt(candidates[index])
    if (fallback.ok) return fallback
  }
  return nearest
}
