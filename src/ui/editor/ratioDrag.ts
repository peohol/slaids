/**
 * Dragging zones: the boundary between two of them, and a zone itself.
 *
 * The gesture is continuous and what it leaves behind is not, and the two
 * halves of that are both here so neither lives inside a pointer handler where
 * it cannot be tested.
 *
 * While the pointer is down nothing is quantised: the layout follows the
 * pointer exactly. Snapping on the way would make the handle stutter between
 * rungs and, worse, would measure the fit of a layout the author is only
 * passing through.
 *
 * On release the layout snaps. The released geometry is a *wish* — arbitrary
 * floats — and the closest ratio the deck can actually be written in is what
 * gets committed. The commit can still be refused (a zone under its minimum,
 * content that no longer fits), so the nearest few rungs are tried in order of
 * how close they are: the pointer was already held inside what the content
 * allows, but a snap moves it a hair further, and dropping the whole gesture
 * over that hair would read as a dead handle.
 *
 * Three gestures produce a wish, and each of them is one pure function of the
 * ratios the split started with — never of the previous frame's ratios, so a
 * long drag cannot accumulate rounding error:
 *
 * - `draggedWeights` moves one boundary, trading weight between the two zones
 *   it sits between and leaving every other zone alone.
 * - `resizedWeights` grows or shrinks one zone about its own centre, moving
 *   both of its boundaries by the same amount in opposite directions.
 * - `translatedWeights` slides one zone along the split without resizing it.
 *
 * The last two share their shape: the zones before the selection are scaled by
 * one factor and the zones after it by another, which is what keeps each side's
 * internal proportions exactly as they were. Both are expressed in weight
 * units, because a split's gaps are fixed — the child count never changes — so
 * weight space and length space are proportional and the arithmetic is the same
 * in either.
 */

import { areWeightsValid, sumWeights } from '../../domain/geometry'
import { rankedRatioQuantizations } from '../../domain/ratios'
import type { StructuralOutcome } from '../../domain/commands'
import type { Result } from '../../domain/result'
import type { Axis } from '../../domain/types'

/** How many rungs a released handle may look down for one it may stop on. */
export const RATIO_SNAP_CANDIDATES = 6

/**
 * How far a press inside a zone has to travel, in screen pixels, before it is
 * read as one gesture or the other.
 *
 * The two operations answer perpendicular movements, so the very first pixels
 * of a drag are noise: without a dead zone a hand that starts a little off-axis
 * would flip between resizing and moving several times before it settled, and
 * the layout would jump with it. Past this distance the dominant direction has
 * been established and the gesture is locked to it for the rest of the drag.
 */
export const ZONE_DRAG_THRESHOLD_PX = 6

/** What a drag that started inside a zone is doing to it. */
export type ZoneDragMode = 'resize' | 'translate'

/**
 * Which of the two operations a movement means, or `null` while it is still too
 * small to say.
 *
 * A split's own axis is the direction its zones are laid out along, so moving
 * along it is the zone changing *place* and moving across it is the zone
 * changing *size*. Rotate a row into a column and both gestures rotate with it:
 * a row grows upwards, and the same gesture on a column — a quarter turn
 * clockwise — grows it rightwards.
 *
 * The dead zone is square rather than round, because what is being decided is
 * which component dominates rather than how far the pointer went. An exact
 * diagonal is read as a move: it is the gesture that leaves the zone's size
 * alone, and so the smaller claim about what the author meant.
 */
export function zoneDragMode(axis: Axis, deltaX: number, deltaY: number): ZoneDragMode | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < ZONE_DRAG_THRESHOLD_PX) return null
  const along = axis === 'x' ? deltaX : deltaY
  const across = axis === 'x' ? deltaY : deltaX
  return Math.abs(across) > Math.abs(along) ? 'resize' : 'translate'
}

/**
 * How much of the operation a movement asks for, signed the way the operation
 * reads its own argument: positive grows a zone, or moves it towards the far
 * end of its split.
 *
 * Moving is direct — the zone follows the hand along the split, one pixel for
 * one pixel. Across the split there is nothing for the pointer to follow, so
 * that movement is a size dial instead: what it measures is how much bigger the
 * zone gets *in total*, half of it taken off each side.
 *
 * The signs are the same gesture drawn twice, a quarter turn apart. A row grows
 * upwards, and turning the row into a column takes "up" to "right"; a row's zone
 * moves left towards the start of its split, and the same quarter turn takes
 * "left" to "up". That is the whole of the rotation: no direction is chosen
 * separately for columns.
 */
export function zoneDragAmount(
  axis: Axis,
  mode: ZoneDragMode,
  deltaX: number,
  deltaY: number,
): number {
  if (mode === 'translate') return axis === 'x' ? deltaX : deltaY
  return axis === 'x' ? -deltaY : deltaX
}

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
 * The ratios for a zone grown (or shrunk) by `growth` about its own centre.
 *
 * Symmetric means both of the zone's boundaries move by half of `growth`, in
 * opposite directions: the zone changes size and stays exactly where it was.
 * Each side gives up — or takes back — the same length, but they do not
 * generally have the same length to begin with, so they are scaled by different
 * factors. Within a side every zone keeps its share of that side, so ratios the
 * gesture is not about survive it untouched.
 *
 * The stop condition is the reason `growth` is clamped rather than refused: the
 * two sides run out of room at different moments, and a resize that carried on
 * into the side that still had room would stop being symmetric halfway through
 * and start moving the zone instead. So the whole operation stops at the
 * smaller of the two, which is the largest symmetric change the split allows.
 *
 * A zone at either end of the split has a boundary it cannot move — the split's
 * own edge — so the largest symmetric change there is no change at all, and the
 * ratios come back exactly as they went in.
 */
export function resizedWeights(
  original: readonly number[],
  index: number,
  growth: number,
  minShare: readonly number[],
): number[] | null {
  if (!Number.isFinite(growth)) return null
  const nearSide = sideTotal(original, 0, index)
  const farSide = sideTotal(original, index + 1, original.length)
  if (nearSide <= 0 || farSide <= 0) return [...original]

  const room = Math.min(
    shrinkCapacity(original, minShare, 0, index),
    shrinkCapacity(original, minShare, index + 1, original.length),
  )
  // Growing is bounded by whichever side runs out first; shrinking only ever
  // gives the sides room, so there it is the zone's own minimum that stops it.
  const clamped = clamp(growth, -Math.max(0, original[index] - minShare[index]), room * 2)
  const half = clamped / 2

  const weights = [...original]
  scaleSide(weights, original, 0, index, (nearSide - half) / nearSide)
  scaleSide(weights, original, index + 1, original.length, (farSide - half) / farSide)
  weights[index] = original[index] + clamped
  return areWeightsValid(weights) ? weights : null
}

/**
 * The ratios for a zone slid `distance` along its split without resizing it.
 *
 * Positive is towards the far end of the axis — right in a row, down in a
 * column. The side it moves towards is compressed by exactly what the side it
 * moves away from gains, so the split's total is unchanged and the zone itself
 * never appears in the arithmetic: it keeps the ratio it had. Both sides are
 * scaled, so both keep their internal proportions.
 *
 * The move stops when the side being compressed reaches the first of its zones'
 * minimums. A zone at either end cannot move at all: there is nothing behind it
 * to open a space, and nothing to take the space it would leave.
 */
export function translatedWeights(
  original: readonly number[],
  index: number,
  distance: number,
  minShare: readonly number[],
): number[] | null {
  if (!Number.isFinite(distance)) return null
  const nearSide = sideTotal(original, 0, index)
  const farSide = sideTotal(original, index + 1, original.length)
  if (nearSide <= 0 || farSide <= 0) return [...original]

  const moved = clamp(
    distance,
    -shrinkCapacity(original, minShare, 0, index),
    shrinkCapacity(original, minShare, index + 1, original.length),
  )
  const weights = [...original]
  scaleSide(weights, original, 0, index, (nearSide + moved) / nearSide)
  scaleSide(weights, original, index + 1, original.length, (farSide - moved) / farSide)
  return areWeightsValid(weights) ? weights : null
}

/**
 * Snap a released drag to whole ratios and commit the closest one `attempt`
 * accepts.
 *
 * `equalityKeys` is read from the split's ratios as the gesture *started*, and
 * it is what decides which zones have to keep sharing a ratio: two zones written
 * down as the same number are the same size by construction, while the live
 * sizes this gesture produced are floats that are never exactly equal. Which
 * zones the gesture frees from that is the gesture's own business —
 * `equalityKeysForDrag` and `equalityKeysForZoneDrag` each state theirs.
 *
 * If every candidate is refused, the refusal handed back is the nearest one's:
 * it is the one that explains what is actually in the way.
 */
export function commitDraggedRatios(
  equalityKeys: readonly (number | string | null)[],
  released: readonly number[],
  attempt: (weights: number[]) => Result<StructuralOutcome>,
): Result<StructuralOutcome> {
  const candidates = rankedRatioQuantizations(released, RATIO_SNAP_CANDIDATES, { equalityKeys })
  const nearest = attempt(candidates[0])
  if (nearest.ok) return nearest
  for (let index = 1; index < candidates.length; index += 1) {
    const fallback = attempt(candidates[index])
    if (fallback.ok) return fallback
  }
  return nearest
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

function clamp(value: number, lowest: number, highest: number): number {
  return Math.max(lowest, Math.min(value, highest))
}

/** The weight the zones in `[from, to)` hold between them; `0` for none. */
function sideTotal(weights: readonly number[], from: number, to: number): number {
  return sumWeights(weights.slice(from, to))
}

/**
 * How much weight the zones in `[from, to)` can give up before the first of them
 * reaches its minimum.
 *
 * They are compressed together, by one factor, so the binding constraint is
 * whichever of them is closest to its own minimum: the side can shrink by that
 * factor and no further. A side that is already under its minimum — content
 * grew, or a theme changed underneath it — can give up nothing rather than a
 * negative amount.
 */
function shrinkCapacity(
  weights: readonly number[],
  minShare: readonly number[],
  from: number,
  to: number,
): number {
  const total = sideTotal(weights, from, to)
  if (total <= 0) return 0
  let floor = 0
  for (let index = from; index < to; index += 1) {
    floor = Math.max(floor, minShare[index] / weights[index])
  }
  return Math.max(0, total * (1 - floor))
}

/** Scale the zones in `[from, to)` of `source` into `out`. */
function scaleSide(
  out: number[],
  source: readonly number[],
  from: number,
  to: number,
  factor: number,
): void {
  for (let index = from; index < to; index += 1) out[index] = source[index] * factor
}
