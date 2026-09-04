/**
 * Zone ratios: the one place a set of desired proportions becomes the integers
 * a layout is actually stored with.
 *
 * A committed split is written as whole numbers between `MIN_ZONE_RATIO` and
 * `MAX_ZONE_RATIO` — `1 : 2 : 1`, never `0.3125 : 0.625 : 0.3125`. That makes
 * the set of representable layouts a finite ladder, which is what lets a
 * released drag handle snap to a rung instead of stopping wherever the pointer
 * happened to be, and what makes two decks that look the same read the same.
 *
 * Rounding each number on its own is not that job. `[0.25, 1.6, 3.14]` rounded
 * individually is `[0, 2, 3]` — one zone gone, and a shape nobody asked for.
 * What is being approximated is the *distribution*: normalise the wish to
 * proportions `p_i = x_i / Σx`, then find the integer vector `r` whose own
 * proportions `q_i = r_i / Σr` sit closest to it, measured as
 * `loss = Σ (p_i - q_i)²`.
 *
 * The search is exact without being a `10^n` sweep, because fixing the *total*
 * makes the problem separable:
 *
 *   for a fixed `S = Σ r_i`, `loss = (1/S²) · Σ (S·p_i - r_i)²`
 *
 * so for each of the ≤ 91 possible totals the best vector is a small bounded
 * knapsack — pick `r_i ∈ [1, 10]` minimising a per-zone cost subject to
 * `Σ r_i = S` — solved by a dynamic program over the running total and then
 * compared across totals by real loss. Every legal vector is a feasible point
 * of the subproblem for its own total, so the best of the winners is the global
 * best.
 *
 * A caller that wants alternatives — the drag handle, which has to try the next
 * one when a snap is refused — needs more than that, and the difference is not
 * a detail. One winner per total is not a ranking: a total's *second* best can
 * be closer than another total's best, so a list built that way offers a
 * further layout and never offers the nearer one. The dynamic program therefore
 * keeps the `width` cheapest ways to finish in every state, not just the
 * cheapest, and `width` is however many the caller asked for. At `width = 1` —
 * the ratio dialog, on every keystroke — it is exactly the search above.
 *
 * Two rules make the answer a single answer rather than one of several:
 *
 * - Equal loss prefers the smaller total, so `1 : 2 : 1` wins over `2 : 4 : 2`.
 *   The two describe exactly the same layout, and the simpler one is the one an
 *   author would have written down. It also makes quantisation *stable*: a
 *   layout that is already legal comes back untouched rather than drifting into
 *   a bigger equivalent of itself.
 * - Everything else is broken by the smallest vector in order, so the same
 *   input always produces the same output.
 *
 * Equality groups are the other half of the contract, and they are why this
 * takes an option rather than only an array. When a drag moves one boundary,
 * zones that shared a ratio and were not touched by that boundary have to keep
 * sharing it: three equal columns must not come back as `3 : 3 : 4` because
 * that shaved a ten-thousandth off the loss. The groups are read from the
 * ratios *before* the drag — never from the temporary pixel widths, which are
 * floats that are never exactly equal — and the two zones the dragged boundary
 * sits between are deliberately left free, because moving that boundary is
 * precisely the author saying those two should differ.
 */

import { MAX_ZONE_RATIO, MIN_ZONE_RATIO } from './constants'
import { areWeightsValid } from './geometry'

/** How much two losses may differ and still count as the same fit. */
const LOSS_EPSILON = 1e-12

/** How many values a single ratio can take. */
const VALUE_COUNT = MAX_ZONE_RATIO - MIN_ZONE_RATIO + 1

/**
 * The longest ranked list the search will build.
 *
 * The list is not filtered out of a bigger search — it *is* the width of the
 * search, kept at every step of it — so the ceiling is here rather than at the
 * call site, and it is small because every caller wants a handful of
 * alternatives and none wants a catalogue.
 */
export const MAX_RANKED_QUANTIZATIONS = 16

export interface RatioQuantizeOptions {
  /**
   * One key per input index. Indices carrying the same key must come out with
   * the same ratio; `null` leaves an index free. See `equalityKeysForDrag`.
   */
  equalityKeys?: readonly (number | string | null)[]
}

/** True when every entry is a whole number within the committed range. */
export function areRatiosQuantized(weights: readonly number[]): boolean {
  return weights.every(
    (weight) =>
      Number.isInteger(weight) && weight >= MIN_ZONE_RATIO && weight <= MAX_ZONE_RATIO,
  )
}

/**
 * Which zones must keep sharing a ratio when `boundary` is dragged.
 *
 * The key is the ratio the zone had before the gesture started: two zones that
 * were written down as the same number are the same width by construction,
 * which no comparison of live floating point widths can tell you. The pair on
 * either side of the dragged boundary is freed — an author dragging the
 * boundary between two equal zones is asking for them to stop being equal.
 */
export function equalityKeysForDrag(
  before: readonly number[],
  boundary: number,
): (number | null)[] {
  return before.map((weight, index) =>
    index === boundary || index === boundary + 1 ? null : weight,
  )
}

/**
 * The integer ratios closest to the proportions `desired` describes.
 *
 * `desired` is any set of positive relative weights — `[0.25, 1.6, 3.14]`,
 * `[1, 100]` and `[10, 20, 10]` are all fine, and only their proportions
 * matter.
 */
export function quantizeRatios(
  desired: readonly number[],
  options: RatioQuantizeOptions = {},
): number[] {
  return rankedRatioQuantizations(desired, 1, options)[0]
}

/**
 * The `limit` closest distinct quantisations, closest first.
 *
 * A caller that can be refused — a drag handle, whose snapped result still has
 * to clear minimum zone sizes and the content-fit guard — walks this list and
 * takes the first one the command accepts, instead of dropping the whole
 * gesture because the very nearest rung happened to be a hair too small.
 * "Distinct" means distinct *layouts*: `2 : 4 : 2` is not a second chance after
 * `1 : 2 : 1`, it is the same geometry written twice.
 *
 * `limit` is not a slice taken off the end of the search — it is the width of
 * the search itself, because whether a vector belongs in the answer cannot be
 * decided one total at a time. Keeping only each total's own best looks like it
 * ranks correctly and does not: for `19.6 : 7.2 : 4.1` the second-best layout
 * at total 15 (`9 : 4 : 2`) is closer than the best layout at total 11
 * (`7 : 3 : 1`), so a list built from per-total winners offers the further one
 * and never offers the nearer. That matters precisely here, where the list is a
 * fallback: whether a layout is accepted depends on *which* zone grew, so the
 * one left out can be the one that would have fitted.
 *
 * At most `MAX_RANKED_QUANTIZATIONS`; asking for more returns that many.
 */
export function rankedRatioQuantizations(
  desired: readonly number[],
  limit: number,
  options: RatioQuantizeOptions = {},
): number[][] {
  const proportions = toProportions(desired)
  const groups = groupsFor(proportions, options.equalityKeys)
  const width = Math.max(1, Math.min(Math.floor(limit), MAX_RANKED_QUANTIZATIONS))

  const candidates: Candidate[] = []
  const minTotal = groups.reduce((total, group) => total + group.size * MIN_ZONE_RATIO, 0)
  const maxTotal = groups.reduce((total, group) => total + group.size * MAX_ZONE_RATIO, 0)
  // One table for every total, rather than one per total: the search runs on
  // each keystroke in the ratio dialog, and ninety-one throwaway arrays per
  // keystroke is the whole cost of it.
  const table = emptyTable(groups.length, maxTotal, width)
  for (let total = minTotal; total <= maxTotal; total += 1) {
    for (const values of bestForTotal(groups, total, table)) {
      const ratios = expand(groups, values, proportions.length)
      candidates.push({ ratios, total, loss: lossOf(proportions, ratios) })
    }
  }

  candidates.sort(compareCandidates)

  const out: number[][] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = reduceRatios(candidate.ratios).join(':')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate.ratios)
    if (out.length >= width) break
  }
  return out
}

/**
 * Rewrite every split's ratios in raw, unvalidated data.
 *
 * The one repair for everything that was written down before whole ratios were
 * the rule: the schema migration runs it over a stored presentation, and the
 * template validator runs it over a stored template, which has no version of
 * its own to migrate on. The layout is kept — each split is replaced by the
 * closest ratio expressible — and the *same* function the commands use decides
 * what "closest" means, so what a stored deck holds and what an edit produces
 * cannot drift apart.
 *
 * Splits whose shape is wrong — weights that are not numbers, or a count that
 * does not match the children — are left exactly as they are, for the schema to
 * refuse. Repairing those would be rebuilding a slide rather than rewriting a
 * number.
 */
export function quantizeStoredRatios(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(quantizeStoredRatios)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) out[key] = quantizeStoredRatios(entry)

  if (record.kind !== 'split' || !Array.isArray(out.weights)) return out
  const weights = out.weights
  const children = Array.isArray(out.children) ? out.children.length : -1
  // The geometry engine's own predicate, so "can this be measured" and "can
  // this be rewritten" are one question — a pair of enormous weights whose sum
  // overflows is neither.
  const usable =
    weights.length === children &&
    weights.every((weight) => typeof weight === 'number') &&
    areWeightsValid(weights as number[])
  if (!usable) return out
  return { ...out, weights: quantizeRatios(weights as number[]) }
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

interface Candidate {
  ratios: number[]
  total: number
  loss: number
}

/** Indices that have to share one ratio, plus the proportion they want. */
interface RatioGroup {
  members: number[]
  size: number
  /** Summed desired proportion of the members. */
  target: number
}

function toProportions(desired: readonly number[]): number[] {
  if (desired.length === 0) {
    throw new Error('quantizeRatios: at least one weight is required')
  }
  let sum = 0
  for (const weight of desired) {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error('quantizeRatios: every weight must be finite and greater than zero')
    }
    sum += weight
  }
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new Error('quantizeRatios: the weights must sum to a finite number')
  }
  return desired.map((weight) => weight / sum)
}

function groupsFor(
  proportions: readonly number[],
  equalityKeys: readonly (number | string | null)[] | undefined,
): RatioGroup[] {
  const groups: RatioGroup[] = []
  const byKey = new Map<number | string, RatioGroup>()
  for (let index = 0; index < proportions.length; index += 1) {
    const key = equalityKeys?.[index] ?? null
    const existing = key === null ? undefined : byKey.get(key)
    if (existing) {
      existing.members.push(index)
      existing.size += 1
      existing.target += proportions[index]
      continue
    }
    const group: RatioGroup = { members: [index], size: 1, target: proportions[index] }
    groups.push(group)
    if (key !== null) byKey.set(key, group)
  }
  return groups
}

/**
 * The table the search fills in: for every (group, remaining sum) it keeps the
 * `width` cheapest ways to finish, cheapest first.
 *
 * Three flat arrays rather than objects, and one allocation for the whole run
 * rather than one per total: this runs on every keystroke in the ratio dialog.
 * `value` is the ratio that state hands to its own group and doubles as the
 * "no such alternative" marker when it is `0`; `next` is which of the *next*
 * group's alternatives the rest of the run continues into, which is what makes
 * a whole ranked list reconstructible from the front.
 */
interface RankedTable {
  cost: Float64Array
  value: Int8Array
  next: Int8Array
  width: number
}

function emptyTable(count: number, maxTotal: number, width: number): RankedTable {
  const size = (count + 1) * (maxTotal + 1) * width
  return {
    cost: new Float64Array(size),
    value: new Int8Array(size),
    next: new Int8Array(size),
    width,
  }
}

/**
 * The `width` best assignments whose ratios sum to exactly `total`, cheapest
 * first — empty when the total cannot be reached at all, which happens because
 * three zones locked together can only ever add up to a multiple of three.
 *
 * With the total fixed, every group's cost is its own business: a group of
 * `size` zones sharing the value `v` wants `v` to be `total × (its share of the
 * proportions) / size`, and a miss costs `size × (v - want)²`. The only thing
 * tying the groups together is that their values must add up to `total` again,
 * which is a bounded knapsack, solved backwards over the groups.
 *
 * Keeping `width` alternatives per state rather than one is what makes the
 * *ranking* trustworthy and not just the winner. Each value's own alternatives
 * are already in order, so the merge is a pointer per value and `width` rounds
 * of "which head is cheapest" — no sorting, and ties always go to the smaller
 * value, which is what makes the same input give the same list every time.
 *
 * The table is the caller's, and only the region this run touches is written, so
 * a stale value from a previous total is never read: every cell is assigned
 * before it is looked at.
 */
function bestForTotal(
  groups: readonly RatioGroup[],
  total: number,
  table: RankedTable,
): number[][] {
  const count = groups.length
  const width = table.width
  const stride = (total + 1) * width
  const slotOf = (index: number, remaining: number, rank: number): number =>
    index * stride + remaining * width + rank

  // What each group's values cost at this total, worked out once instead of
  // once per (group, remaining, value).
  const costs = new Float64Array(count * VALUE_COUNT)
  for (let index = 0; index < count; index += 1) {
    const group = groups[index]
    const want = (total * group.target) / group.size
    for (let value = MIN_ZONE_RATIO; value <= MAX_ZONE_RATIO; value += 1) {
      costs[index * VALUE_COUNT + (value - MIN_ZONE_RATIO)] =
        group.size * (value - want) * (value - want)
    }
  }

  // The sums the groups from `index` on can possibly make, so the table is
  // only filled where an answer can exist.
  const reach: number[] = new Array<number>(count + 1)
  reach[count] = 0
  for (let index = count - 1; index >= 0; index -= 1) {
    reach[index] = reach[index + 1] + groups[index].size
  }

  // Past the last group there is exactly one way to have nothing left: stop.
  for (let rank = 0; rank < width; rank += 1) {
    const slot = slotOf(count, 0, rank)
    table.cost[slot] = rank === 0 ? 0 : Number.POSITIVE_INFINITY
    table.value[slot] = 0
    table.next[slot] = 0
  }

  const taken = new Int32Array(VALUE_COUNT)
  for (let index = count - 1; index >= 0; index -= 1) {
    const group = groups[index]
    const size = group.size
    const low = reach[index] * MIN_ZONE_RATIO
    const high = Math.min(total, reach[index] * MAX_ZONE_RATIO)
    const restLow = reach[index + 1] * MIN_ZONE_RATIO
    const restHigh = reach[index + 1] * MAX_ZONE_RATIO
    // The index arithmetic is hoisted rather than called: this is the loop the
    // whole search spends its time in.
    const base = index * stride
    const nextBase = base + stride
    const costBase = index * VALUE_COUNT
    for (let remaining = low; remaining <= high; remaining += 1) {
      taken.fill(0)
      const stateBase = base + remaining * width
      for (let rank = 0; rank < width; rank += 1) {
        let bestCost = Number.POSITIVE_INFINITY
        let bestValue = 0
        let bestNext = 0
        for (let value = MIN_ZONE_RATIO; value <= MAX_ZONE_RATIO; value += 1) {
          const rest = remaining - size * value
          if (rest < restLow) break
          if (rest > restHigh) continue
          const nextRank = taken[value - MIN_ZONE_RATIO]
          if (nextRank >= width) continue
          const rested = table.cost[nextBase + rest * width + nextRank]
          if (!Number.isFinite(rested)) continue
          const candidate = costs[costBase + (value - MIN_ZONE_RATIO)] + rested
          if (candidate < bestCost) {
            bestCost = candidate
            bestValue = value
            bestNext = nextRank
          }
        }
        const slot = stateBase + rank
        table.cost[slot] = bestCost
        table.value[slot] = bestValue
        table.next[slot] = bestNext
        if (bestValue === 0) {
          // This state has run out of ways to finish; the rest of its slots say
          // so, because a later run at another total will read them.
          for (let empty = rank + 1; empty < width; empty += 1) {
            table.cost[stateBase + empty] = Number.POSITIVE_INFINITY
            table.value[stateBase + empty] = 0
            table.next[stateBase + empty] = 0
          }
          break
        }
        taken[bestValue - MIN_ZONE_RATIO] += 1
      }
    }
  }

  if (total < reach[0] * MIN_ZONE_RATIO || total > reach[0] * MAX_ZONE_RATIO) return []

  const out: number[][] = []
  for (let rank = 0; rank < width; rank += 1) {
    if (!Number.isFinite(table.cost[slotOf(0, total, rank)])) break
    const values = new Array<number>(count)
    let remaining = total
    let cursor = rank
    for (let index = 0; index < count; index += 1) {
      const slot = slotOf(index, remaining, cursor)
      values[index] = table.value[slot]
      cursor = table.next[slot]
      remaining -= groups[index].size * values[index]
    }
    out.push(values)
  }
  return out
}

/** Group values back out to one ratio per zone. */
function expand(groups: readonly RatioGroup[], values: readonly number[], length: number): number[] {
  const ratios = new Array<number>(length)
  for (let index = 0; index < groups.length; index += 1) {
    for (const member of groups[index].members) ratios[member] = values[index]
  }
  return ratios
}

function lossOf(proportions: readonly number[], ratios: readonly number[]): number {
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0)
  let loss = 0
  for (let index = 0; index < proportions.length; index += 1) {
    const difference = proportions[index] - ratios[index] / total
    loss += difference * difference
  }
  return loss
}

/**
 * Closest first; then the simplest, then the smallest.
 *
 * The loss comparison is deliberately fuzzy: `1 : 2 : 1` and `2 : 4 : 2` are
 * the same distribution, but they are two different divisions in floating
 * point and can land a rounding error apart. Treating that as a real
 * difference would make the tie-break — the rule that keeps the answer simple —
 * fire only when the arithmetic happened to come out even.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (Math.abs(a.loss - b.loss) > LOSS_EPSILON) return a.loss - b.loss
  if (a.total !== b.total) return a.total - b.total
  for (let index = 0; index < a.ratios.length; index += 1) {
    if (a.ratios[index] !== b.ratios[index]) return a.ratios[index] - b.ratios[index]
  }
  return 0
}

/** `[2, 4, 2]` and `[1, 2, 1]` are one layout; this is the name they share. */
function reduceRatios(ratios: readonly number[]): number[] {
  const divisor = ratios.reduce((current, ratio) => greatestCommonDivisor(current, ratio), 0)
  return divisor > 1 ? ratios.map((ratio) => ratio / divisor) : [...ratios]
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = a
  let right = b
  while (right !== 0) {
    const next = left % right
    left = right
    right = next
  }
  return left
}
