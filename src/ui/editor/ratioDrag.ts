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
 * - `resizedWeights` grows or shrinks one zone, and every other zone pays for
 *   it in proportion to its size — one factor for all of them.
 * - `translatedWeights` slides one zone along the split without resizing it.
 *
 * The last two are both scalings of whole groups of zones: every sibling by one
 * factor for a resize, and for a move the zones before the selection by one
 * factor and the zones after it by another. That is what keeps the proportions
 * the gesture is not about exactly as they were. Both are expressed in weight
 * units, because a split's gaps are fixed — the child count never changes — so
 * weight space and length space are proportional and the arithmetic is the same
 * in either.
 */

import { areWeightsValid, sumWeights } from '../../domain/geometry'
import {
  MAX_RANKED_QUANTIZATIONS,
  equalityKeysForDrag,
  equalityKeysForZoneDrag,
  equalityKeysForZoneResize,
  proportionalQuantizations,
  rankedRatioQuantizations,
} from '../../domain/ratios'
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
 * The ratios for a zone grown (or shrunk) by `growth`.
 *
 * Every other zone in the split pays for the change in proportion to its own
 * size: all of them are scaled by one and the same factor,
 *
 *   x_i' = x_i · (T − b') / (T − b)
 *
 * where `T` is the split's total, `b` the zone's weight when the gesture
 * started and `b'` its weight now. So the siblings keep exactly the ratios they
 * had among themselves — `1 : 1 : 1 : 1` with the second zone grown stays
 * `a : b : a : a` — and which side of the zone a sibling happens to sit on
 * plays no part in how much it gives up.
 *
 * It used to be otherwise: each *side* gave up half of the change, so a zone
 * with one neighbour on its left and two on its right took as much from the
 * one as from the two together, and the lone neighbour shrank twice as fast.
 * A long drag made that visible; several short ones hid it, because each one
 * started again from the skewed result of the last.
 *
 * Because the factor is shared, the stop condition is the sibling closest to
 * its own minimum: when it is reached the whole gesture stops rather than
 * carrying on into the others, which would bend the proportions it promised to
 * keep. Shrinking only ever gives the siblings room, so there it is the zone's
 * own minimum that stops it.
 */
export function resizedWeights(
  original: readonly number[],
  index: number,
  growth: number,
  minShare: readonly number[],
): number[] | null {
  if (!Number.isFinite(growth)) return null
  const siblings = original.map((_, position) => position).filter((position) => position !== index)
  const rest = totalOf(original, siblings)
  if (rest <= 0) return [...original]

  const clamped = clamp(
    growth,
    -Math.max(0, original[index] - minShare[index]),
    shrinkCapacity(original, minShare, siblings),
  )
  const weights = scaled(original, siblings, (rest - clamped) / rest)
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
  const near = range(0, index)
  const far = range(index + 1, original.length)
  const nearSide = totalOf(original, near)
  const farSide = totalOf(original, far)
  // Unlike a resize, this one really is impossible at either end of the split:
  // a zone there has nothing behind it to open a space, and nothing to take the
  // space it would leave.
  if (nearSide <= 0 || farSide <= 0) return [...original]

  const moved = clamp(
    distance,
    -shrinkCapacity(original, minShare, near),
    shrinkCapacity(original, minShare, far),
  )
  const weights = scaled(
    scaled(original, near, (nearSide + moved) / nearSide),
    far,
    (farSide - moved) / farSide,
  )
  return areWeightsValid(weights) ? weights : null
}

/**
 * A snapped layout that leaves the zone at `index` exactly the size it is now.
 *
 * A move promises the zone keeps its size, and it does — right up until the
 * snap, which is free to trade a hair off it for a closer fit everywhere else.
 * A few per cent is enough to see, and what the author sees then is a move that
 * also resized the thing it moved.
 *
 * The comparison is exact rather than approximate because both sides of it are
 * whole numbers: a committed split is written in integers, so "the same share"
 * is `w · Σbefore = before · Σw`, a question about integers with no rounding in
 * it. A layout carrying anything else simply never matches, and the caller
 * falls back to the nearest rung.
 */
export function keepsZoneSize(
  before: readonly number[],
  index: number,
): (weights: readonly number[]) => boolean {
  const total = sumWeights(before)
  return (weights) => weights[index] * total === before[index] * sumWeights(weights)
}

/**
 * The snapped layouts that keep every sibling of the zone at `index` in exactly
 * the proportions they started with, closest to `released` first.
 *
 * A resize promises that the zones it is not about keep their ratios among
 * themselves, and while the pointer is down they do, to the last bit. The snap
 * is where that promise could quietly be broken: `1 : 2 : 3 : 4` is not a
 * proportion the nearest rung is obliged to respect. These are the rungs that
 * do, and the stage tries them before the plain ladder.
 */
export function proportionKeepingSnaps(
  before: readonly number[],
  index: number,
  released: readonly number[],
): number[][] {
  const siblings = before.map((_, position) => position).filter((position) => position !== index)
  return proportionalQuantizations(released, before, [siblings], RATIO_SNAP_CANDIDATES)
}

/** What a gesture can tell the snap about which rungs answer it best. */
export interface SnapPreference {
  /**
   * Rungs that answer the gesture better than closeness alone can tell — a
   * move, whose whole promise is that the zone keeps its size. See
   * `keepsZoneSize`.
   */
  prefer?: (weights: readonly number[]) => boolean
  /**
   * Whole layouts to try before the ladder at all, in order — a resize's
   * proportion-keeping rungs, which the ladder may not reach.
   */
  first?: readonly number[][]
}

/** Everything a released gesture tells the snap: see `commitDraggedRatios`. */
export interface SnapRules {
  equalityKeys: (number | string | null)[]
  preference: SnapPreference
}

/** How a released boundary drag snaps. */
export function boundarySnapRules(before: readonly number[], boundary: number): SnapRules {
  return { equalityKeys: equalityKeysForDrag(before, boundary), preference: {} }
}

/**
 * How a released drag inside a zone snaps.
 *
 * A move promised the zone would keep its size, and a resize that every other
 * zone would keep its proportions; each is held to its promise on the snap.
 */
export function zoneSnapRules(
  before: readonly number[],
  index: number,
  mode: ZoneDragMode,
  released: readonly number[],
): SnapRules {
  return mode === 'translate'
    ? {
        equalityKeys: equalityKeysForZoneDrag(before, index),
        preference: { prefer: keepsZoneSize(before, index) },
      }
    : {
        equalityKeys: equalityKeysForZoneResize(before, index),
        preference: { first: proportionKeepingSnaps(before, index, released) },
      }
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
 * `equalityKeysForDrag`, `equalityKeysForZoneResize` and
 * `equalityKeysForZoneDrag` each state theirs.
 *
 * A `SnapPreference` lets a gesture say that some rungs answer it better than
 * closeness alone can tell. `first` is tried before anything else; `prefer`
 * picks rungs out of the ladder to try before the rest of it, and looks further
 * down the ladder, because a rung a preference is asking for is by definition
 * not the nearest one. Either way the plain ladder follows, so a preference
 * narrows what is chosen without ever making the gesture fail.
 *
 * If every candidate is refused, the refusal handed back is the nearest one's:
 * it is the one that explains what is actually in the way.
 */
export function commitDraggedRatios(
  equalityKeys: readonly (number | string | null)[],
  released: readonly number[],
  attempt: (weights: number[]) => Result<StructuralOutcome>,
  preference: SnapPreference = {},
): Result<StructuralOutcome> {
  const { prefer, first = [] } = preference
  const ranked = rankedRatioQuantizations(
    released,
    prefer ? MAX_RANKED_QUANTIZATIONS : RATIO_SNAP_CANDIDATES,
    { equalityKeys },
  )
  const candidates = [
    ...first,
    ...(prefer
      ? [...ranked.filter(prefer), ...ranked.filter((weights) => !prefer(weights))]
      : ranked),
  ]

  let nearest: Result<StructuralOutcome> | null = null
  for (const candidate of candidates) {
    const result = attempt([...candidate])
    if (result.ok) return result
    nearest ??= result
  }
  // `ranked` is never empty for a valid release, so neither is `candidates`.
  return nearest ?? attempt(ranked[0])
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

function clamp(value: number, lowest: number, highest: number): number {
  return Math.max(lowest, Math.min(value, highest))
}

/** The indices `[from, to)`. */
function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset)
}

/** The weight the zones at `indices` hold between them; `0` for none. */
function totalOf(weights: readonly number[], indices: readonly number[]): number {
  return indices.reduce((total, index) => total + weights[index], 0)
}

/**
 * How much weight the zones at `indices` can give up before the first of them
 * reaches its minimum.
 *
 * They are compressed together, by one factor, so the binding constraint is
 * whichever of them is closest to its own minimum: the group can shrink by that
 * factor and no further. A group that is already under its minimum — content
 * grew, or a theme changed underneath it — can give up nothing rather than a
 * negative amount.
 */
function shrinkCapacity(
  weights: readonly number[],
  minShare: readonly number[],
  indices: readonly number[],
): number {
  const total = totalOf(weights, indices)
  if (total <= 0) return 0
  let floor = 0
  for (const index of indices) floor = Math.max(floor, minShare[index] / weights[index])
  return Math.max(0, total * (1 - floor))
}

/** A copy of `source` with the zones at `indices` scaled by `factor`. */
function scaled(source: readonly number[], indices: readonly number[], factor: number): number[] {
  const out = [...source]
  for (const index of indices) out[index] = source[index] * factor
  return out
}
