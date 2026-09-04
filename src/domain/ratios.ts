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
  const ranked = rankedRatioQuantizations(desired, options, 1)
  return ranked[0]
}

/**
 * The best `limit` distinct quantisations, closest first.
 *
 * A caller that can be refused — a drag handle, whose snapped result still has
 * to clear minimum zone sizes and the content-fit guard — walks this list and
 * takes the first one the command accepts, instead of dropping the whole
 * gesture because the very nearest rung happened to be a hair too small.
 * "Distinct" means distinct *layouts*: `2 : 4 : 2` is not a second chance after
 * `1 : 2 : 1`, it is the same geometry written twice.
 */
export function rankedRatioQuantizations(
  desired: readonly number[],
  options: RatioQuantizeOptions = {},
  limit = Number.POSITIVE_INFINITY,
): number[][] {
  const proportions = toProportions(desired)
  const groups = groupsFor(proportions, options.equalityKeys)

  const candidates: Candidate[] = []
  const minTotal = groups.reduce((total, group) => total + group.size * MIN_ZONE_RATIO, 0)
  const maxTotal = groups.reduce((total, group) => total + group.size * MAX_ZONE_RATIO, 0)
  // One buffer for every total, rather than one per total: the search runs on
  // each keystroke in the ratio dialog, and ninety-one throwaway arrays per
  // keystroke is the whole cost of it.
  const buffer = new Float64Array((groups.length + 1) * (maxTotal + 1))
  for (let total = minTotal; total <= maxTotal; total += 1) {
    const ratios = bestForTotal(groups, total, buffer)
    if (ratios) {
      const expanded = expand(groups, ratios, proportions.length)
      candidates.push({ ratios: expanded, total, loss: lossOf(proportions, expanded) })
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
    if (out.length >= limit) break
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
 * The best value per group for a run that sums to exactly `total`, or `null`
 * when no assignment can reach it — three zones locked together can only ever
 * add up to a multiple of three.
 *
 * With the total fixed, every group's cost is its own business: a group of
 * `size` zones sharing the value `v` wants `v` to be `total × (its share of the
 * proportions) / size`, and a miss costs `size × (v - want)²`. The only thing
 * tying the groups together is that their values must add up to `total` again,
 * which is a bounded knapsack — solved backwards over the groups so the forward
 * walk can pick the smallest value at each step among the ones that stay
 * optimal, making the result not merely optimal but the same optimum every
 * time.
 *
 * The table is the caller's, and only the region this run touches is written, so
 * a stale value from a previous total is never read: every cell is assigned
 * before it is looked at.
 */
function bestForTotal(
  groups: readonly RatioGroup[],
  total: number,
  /** suffix[group * stride + remaining]: best cost for groups[group..] summing to `remaining`. */
  suffix: Float64Array,
): number[] | null {
  const count = groups.length
  const stride = total + 1

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

  suffix[count * stride] = 0
  for (let index = count - 1; index >= 0; index -= 1) {
    const group = groups[index]
    const low = reach[index] * MIN_ZONE_RATIO
    const high = Math.min(total, reach[index] * MAX_ZONE_RATIO)
    for (let remaining = low; remaining <= high; remaining += 1) {
      let best = Number.POSITIVE_INFINITY
      for (let value = MIN_ZONE_RATIO; value <= MAX_ZONE_RATIO; value += 1) {
        const rest = remaining - group.size * value
        if (rest < 0) break
        if (rest < reach[index + 1] * MIN_ZONE_RATIO) break
        if (rest > reach[index + 1] * MAX_ZONE_RATIO) continue
        const candidate =
          costs[index * VALUE_COUNT + (value - MIN_ZONE_RATIO)] +
          suffix[(index + 1) * stride + rest]
        if (candidate < best) best = candidate
      }
      suffix[index * stride + remaining] = best
    }
  }

  if (total < reach[0] * MIN_ZONE_RATIO || total > reach[0] * MAX_ZONE_RATIO) return null
  const optimum = suffix[total]
  if (!Number.isFinite(optimum)) return null

  const values = new Array<number>(count)
  let remaining = total
  for (let index = 0; index < count; index += 1) {
    const group = groups[index]
    const target = suffix[index * stride + remaining]
    for (let value = MIN_ZONE_RATIO; value <= MAX_ZONE_RATIO; value += 1) {
      const rest = remaining - group.size * value
      if (rest < 0) break
      if (rest < reach[index + 1] * MIN_ZONE_RATIO) break
      if (rest > reach[index + 1] * MAX_ZONE_RATIO) continue
      const candidate =
        costs[index * VALUE_COUNT + (value - MIN_ZONE_RATIO)] + suffix[(index + 1) * stride + rest]
      if (candidate <= target + LOSS_EPSILON) {
        values[index] = value
        remaining = rest
        break
      }
    }
  }
  return values
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
