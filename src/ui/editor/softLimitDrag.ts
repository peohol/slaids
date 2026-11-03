/**
 * The soft limit, as a hand on a drag handle feels it.
 *
 * A person may drag a zone smaller than its content needs at normal type, down
 * to the hard minimum of what it holds (`domain/softSize.ts`). The size where
 * the text stops fitting is still worth finding, and worth finding *without
 * looking for it*: so the drag stops there for a moment — the zone holds
 * still while the hand travels `SOFT_LIMIT_RESISTANCE_PX` further — and then
 * lets go. Coming back the other way, the same stretch holds it at the limit
 * again; and a zone that starts out below its limit is pulled up onto it as the
 * hand approaches.
 *
 * Everything here is arithmetic on one number. Every drag operation is a pure
 * function of how far the pointer has travelled in the one direction it reads
 * (`dragAmount` / `lengthsAt` in `zoneGesture.ts`), and every child of the
 * split it acts on has its length change monotonically with that number. So a
 * child's soft limit — a *length*, measured once per drag — becomes a point on
 * the pointer's own axis, and the magnet is a mapping of that axis onto
 * itself. It depends on where the pointer is, not on how fast it got there, so
 * a flick and a crawl end in the same place, and a pointer resting on a point
 * cannot flicker between two answers.
 *
 * The resistance is in screen pixels: the same push of the hand breaks through
 * whatever the stage's zoom, which is why the caller converts it with the scale
 * the slide is drawn at.
 */

import { shortestFittingLength } from '../../domain/softSize'

/** How far, in screen pixels, a hand has to push past a soft limit before the zone follows it. */
export const SOFT_LIMIT_RESISTANCE_PX = 16

/**
 * How far, in screen pixels, the pointer has to move before the step a drag
 * shows is chosen again.
 *
 * A drag is shown in the steps it can be stored in, and a hand resting on the
 * boundary between two of them trembles across it. Without a little hysteresis
 * the slide would flicker between the two; with it, a step stays until the
 * hand has clearly moved on.
 */
export const STEP_HYSTERESIS_PX = 3

/**
 * Where on the pointer's axis a child's soft limit lies.
 *
 * `direction` is the sign of the pointer travel that reaches it and `distance`
 * how far; a limit exactly where the drag started is at distance zero in the
 * direction that crosses it. A `leave` limit is crossed going from fitting to
 * not fitting, an `enter` limit the other way.
 */
export interface SoftThreshold {
  direction: 1 | -1
  distance: number
  kind: 'leave' | 'enter'
}

/**
 * What a drag knows about one of its children's soft limit.
 *
 * `soft` is the shortest length at which the child's content fits at normal
 * size; `Infinity` for content that does not fit even with all the room the
 * split has, and `null` while it has not been measured.
 */
export interface ChildSoftLimit {
  index: number
  fitsAtStart: boolean
  soft: number | null
}

/**
 * What a drag that has moved a child from `start` to `now` needs to know about
 * its soft limit, learnt from `fitsAt(length)` — the child's content at normal
 * size in a rect of that length — only as far as it is needed.
 *
 * Whether the child fits where it started is always needed once it moves. Its
 * soft limit is needed as soon as it matters: for a child that fits, once it
 * is being made smaller; for one that does not, at once — it can be pulled up
 * onto its limit, or pushed further below it. `floor` is its hard minimum and
 * `room` the most length the split could ever give it. Each probe is a render
 * of the content, which is why none is made before it is needed and none is
 * made twice: what was learnt comes back in, and is returned as it was when
 * there is nothing more to learn.
 */
export function learnSoftLimit(
  known: ChildSoftLimit | undefined,
  index: number,
  start: number,
  now: number,
  floor: number,
  room: number,
  fitsAt: (length: number) => boolean,
): ChildSoftLimit {
  const limit = known ?? { index, fitsAtStart: fitsAt(start), soft: null }
  if (limit.soft !== null || (limit.fitsAtStart && now >= start)) return limit
  const soft = limit.fitsAtStart
    ? (shortestFittingLength(fitsAt, Math.max(0, floor), start) ?? start)
    : (shortestFittingLength(fitsAt, start, room) ?? Number.POSITIVE_INFINITY)
  return { ...limit, soft }
}

/**
 * The pointer amount the drag acts on, for the pointer's own `raw` amount.
 *
 * Walking out from where the drag started, each `leave` limit holds the
 * amount on itself while the hand covers `resistance` more, and from then on
 * the zone follows the hand that same distance behind — so letting go of the
 * limit never jumps. Each `enter` limit reaches out `resistance` towards the
 * hand and pulls the zone onto itself.
 */
export function magneticAmount(
  raw: number,
  thresholds: readonly SoftThreshold[],
  resistance: number,
): number {
  if (!Number.isFinite(raw) || raw === 0) return raw
  const direction = raw > 0 ? 1 : -1
  const travelled = Math.abs(raw)
  const ahead = thresholds
    .filter((threshold) => threshold.direction === direction)
    .sort((a, b) => a.distance - b.distance)
  let behind = 0
  for (const threshold of ahead) {
    const at = travelled - behind
    if (threshold.kind === 'leave') {
      if (at <= threshold.distance) break
      if (at <= threshold.distance + resistance) return direction * threshold.distance
      behind += resistance
    } else {
      if (at < threshold.distance - resistance) break
      if (at <= threshold.distance) return direction * threshold.distance
    }
  }
  return direction * (travelled - behind)
}

/** How many halvings locate a limit on the pointer's axis: far below a pixel. */
const AXIS_SEARCH_STEPS = 40

/**
 * Every child's soft limit as a point on the pointer's axis.
 *
 * `lengthsAt` is the drag's own amount-to-lengths function and `reach` an
 * amount past which nothing changes any more. A child that fits at the start
 * has a `leave` limit in whichever direction shrinks it below `soft`; one that
 * does not has an `enter` limit in whichever direction grows it to `soft`.
 * Either may be out of reach, and then there is none.
 */
export function softThresholds(
  lengthsAt: (amount: number) => readonly number[] | null,
  limits: readonly ChildSoftLimit[],
  reach: number,
): SoftThreshold[] {
  const start = lengthsAt(0)
  if (!start) return []
  const thresholds: SoftThreshold[] = []
  for (const limit of limits) {
    const soft = limit.soft
    if (soft === null || !Number.isFinite(soft)) continue
    const fitting = (amount: number): boolean => {
      const lengths = lengthsAt(amount)
      return lengths ? lengths[limit.index] >= soft : true
    }
    for (const direction of [1, -1] as const) {
      // A child that fits is looking for where it stops; one that does not,
      // for where it starts.
      const wanted = !limit.fitsAtStart
      if (fitting(direction * reach) !== wanted) continue
      let near = 0
      let far = reach
      for (let step = 0; step < AXIS_SEARCH_STEPS; step += 1) {
        const middle = (near + far) / 2
        if (fitting(direction * middle) === wanted) far = middle
        else near = middle
      }
      // Always the fitting side of the crossing, so a zone held on the limit
      // is a zone whose content fits.
      thresholds.push({
        direction,
        distance: limit.fitsAtStart ? near : far,
        kind: limit.fitsAtStart ? 'leave' : 'enter',
      })
    }
  }
  return thresholds
}

/** How far a length may differ from a limit and still be on it. */
const LENGTH_EPSILON = 1e-6

/**
 * Whether a layout takes some child further below its soft limit than it was
 * when the drag started — the layouts only a person's own resize may store
 * (`domain/commands/manualLayout.ts`).
 *
 * A child that fitted and now does not is past it, and so is one that did not
 * fit and has been made smaller still. One that did not fit and has been
 * given room is not: that is a repair, and the ordinary fit rule allows it.
 */
export function isPastSoftLimit(
  lengths: readonly number[],
  start: readonly number[],
  limits: readonly ChildSoftLimit[],
): boolean {
  return limits.some((limit) => {
    if (limit.soft === null) return false
    const length = lengths[limit.index]
    return length < limit.soft - LENGTH_EPSILON && length < start[limit.index] - LENGTH_EPSILON
  })
}
