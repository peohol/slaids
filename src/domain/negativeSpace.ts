/**
 * Negative space as part of the zone structure, not only as a kind of content.
 *
 * Deliberate air is an ordinary leaf (`NegativeSpaceContent`), and two pieces
 * of it side by side are one piece of air drawn twice: nothing on the slide
 * tells them apart, and a gesture that grows "the air on this side" could not
 * say which of them it meant. So a stored layout never has two pieces of air
 * meeting — they are merged into one, whichever operation put them next to
 * each other: a manual conversion, a deleted zone that used to stand between
 * them, a move, a paste, an agent, or a drag that let a zone go. The rule is
 * applied in one place, `withSlide`, which is the door every edit of a content
 * slide's layout goes through, so no command has to remember it and none can
 * forget it.
 *
 * What counts is the edge on the slide, not the level in the tree. Air at the
 * end of a split that runs the same way as its parent covers that split's
 * whole side, so where it meets air beside the split — `[n, [n, a, n], n]` —
 * the two are one piece of air on one edge, separated by nothing but a gap.
 * Air across a split that runs the other way covers only part of the edge,
 * and is different air.
 *
 * Merging changes air and nothing else. Along the axis of the row it is in,
 * every content zone keeps its share of the row exactly — or, where the air
 * has to give up room to fit the 1–10 ladder, every content zone in that row
 * grows by the same factor, so their proportions to each other stay exact and
 * none of them gets smaller. Only a split with no split above it running the
 * same way may give up air like that: anywhere else, air given up would grow
 * one part of a row and not the rest of it. Each meeting is resolved by the
 * closest of a few rewrites — merging siblings, lifting the nested air out to
 * meet its neighbour, joining two groups into one when lifting would pass ten
 * children, or dropping the outer piece — and each is measured against that
 * promise before it is taken (`growthOf`). Where none keeps it, the 1–10 ladder cannot show that
 * content with one piece of air, and the tree is left as it is: a command
 * that would make such a meeting is refused instead (`guardFit`), so a stored
 * layout only has one if it was stored before this rule.
 *
 * Merging is structural and deterministic about identity: a run of air keeps
 * its *first* leaf — its node id and its content id — and a group joined with
 * its neighbour keeps the first group's id. A split left with one child
 * collapses into it, and the rule is applied bottom-up so the collapse can
 * expose a new meeting one level higher, which is then resolved too.
 */

import { MAX_SPLIT_CHILDREN, MAX_ZONE_RATIO, MIN_SPLIT_CHILDREN, MIN_ZONE_RATIO } from './constants'
import { areRatiosQuantized } from './ratios'
import type { Axis, LayoutNode, SplitNode } from './types'

/** Whether a node is a leaf of deliberate air. */
export function isNegativeSpace(node: LayoutNode): boolean {
  return node.kind === 'leaf' && node.content?.kind === 'negative-space'
}

/** Which end of a split. */
type Edge = 'start' | 'end'

/** The child at `edge` of a split. */
function childAt(split: SplitNode, edge: Edge): LayoutNode {
  return split.children[edge === 'start' ? 0 : split.children.length - 1]
}

/**
 * Whether `node`, as a child of a split along `axis`, has air along its whole
 * `edge` that is not itself a child of that split: air at that end of a split
 * running the same way, however deep.
 */
function nestedAirAt(node: LayoutNode, axis: Axis, edge: Edge): boolean {
  if (node.kind !== 'split' || node.axis !== axis) return false
  const end = childAt(node, edge)
  return isNegativeSpace(end) || nestedAirAt(end, axis, edge)
}

/** Whether `node` has air along its whole `edge`, as a child or nested. */
function airAt(node: LayoutNode, axis: Axis, edge: Edge): boolean {
  return isNegativeSpace(node) || nestedAirAt(node, axis, edge)
}

/** Whether air meets air between child `index` and the next one. */
function meetsAt(split: SplitNode, index: number): boolean {
  return airAt(split.children[index], split.axis, 'end') && airAt(split.children[index + 1], split.axis, 'start')
}

/**
 * How many places in the tree two pieces of air meet on one edge — side by
 * side, or through splits running the same way. A layout stored by a command
 * has none (`mergeNegativeSpace`, `guardFit`).
 */
export function airMeetings(node: LayoutNode): number {
  if (node.kind !== 'split') return 0
  let count = 0
  node.children.forEach((child, index) => {
    count += airMeetings(child)
    if (index < node.children.length - 1 && meetsAt(node, index)) count += 1
  })
  return count
}

/**
 * The tree with every meeting of air on one edge merged into one piece, where
 * the content's proportions allow it.
 *
 * Returns the very same object when there is nothing to merge, so the many
 * edits that never touch air — typing, above all — cost a walk and nothing
 * else.
 */
export function mergeNegativeSpace(node: LayoutNode): LayoutNode {
  return merged(node)
}

/**
 * `mergeNegativeSpace` for a node under splits running along `above`.
 *
 * A split is the outermost one along its axis when none above it runs the
 * same way — not its parent, nor one further up across a split that runs the
 * other way, since a row inside a column inside a column still shares the
 * outer column's height. Only there may air be given up (`resolve`).
 */
function merged(node: LayoutNode, above: readonly Axis[] = []): LayoutNode {
  if (node.kind === 'leaf') return node
  const outermost = !above.includes(node.axis)
  const below = outermost ? [...above, node.axis] : above
  const children = node.children.map((child) => merged(child, below))
  let current: LayoutNode = children.some((child, index) => child !== node.children[index])
    ? { ...node, children }
    : node
  // Each resolution can open a meeting it did not touch — a collapse brings a
  // group's own edge up — so the walk starts over after every one. A meeting
  // that cannot be resolved is stepped past.
  let index = 0
  while (current.kind === 'split' && current.axis === node.axis && index < current.children.length - 1) {
    const resolved: LayoutNode | null = meetsAt(current, index) ? resolve(current, index, outermost) : null
    if (resolved) {
      current = resolved
      index = 0
    } else {
      index += 1
    }
  }
  return current
}

/**
 * The best way to make the air meeting at `index` one piece, or `null` when
 * none keeps the content's proportions: the rewrite whose content grows the
 * least, the earliest of them on a tie.
 */
function resolve(split: SplitNode, index: number, outermost: boolean): LayoutNode | null {
  const meetings = airMeetings(split)
  let best: LayoutNode | null = null
  let bestGrowth = Infinity
  for (const rewrite of [mergedRun, mergedPair, liftedAir, joinedGroups, droppedPiece]) {
    const candidate = rewrite(split, index, outermost)
    if (!candidate || !isStorable(candidate) || airMeetings(candidate) >= meetings) continue
    const growth = growthOf(split, candidate, outermost)
    if (growth !== null && growth < bestGrowth - EPSILON) {
      best = candidate
      bestGrowth = growth
    }
  }
  return best
}

/* ------------------------------------------------------------------ *
 * The rewrites
 * ------------------------------------------------------------------ */

/**
 * A run of air side by side as one leaf, the first, with the whole run's
 * weight. The run is taken whole where it can be: inside a row, content `10`
 * and `8` beside air `9`, `4` and `7` is `[5, 4, 10]` on whole ratios, while
 * the first pair alone, `[10, 8, 13, 7]`, is not.
 */
function mergedRun(split: SplitNode, index: number, outermost: boolean): LayoutNode | null {
  const air = split.children.map(isNegativeSpace)
  if (!air[index] || !air[index + 1]) return null
  let [from, to] = [index, index + 1]
  while (from > 0 && air[from - 1]) from -= 1
  while (to < air.length - 1 && air[to + 1]) to += 1
  return mergedSiblings(split, from, to, outermost)
}

/** Just the two pieces at `index`, for a run that cannot be merged whole. */
function mergedPair(split: SplitNode, index: number, outermost: boolean): LayoutNode | null {
  const pair = isNegativeSpace(split.children[index]) && isNegativeSpace(split.children[index + 1])
  return pair ? mergedSiblings(split, index, index + 1, outermost) : null
}

/** Children `from` to `to`, all air, as the first of them with all their weight. */
function mergedSiblings(split: SplitNode, from: number, to: number, outermost: boolean): LayoutNode | null {
  const run = sum(split.weights.slice(from, to + 1))
  const children = split.children.filter((_, at) => at <= from || at > to)
  const desired = split.weights.flatMap((weight, at) => (at === from ? [run] : at > from && at <= to ? [] : [weight]))
  return rebuilt(split, children, desired, outermost)
}

/**
 * Nested air taken out to this split, beside the air it meets, and merged
 * with it there: `[n, [n, a]]` is `[n, a]`.
 */
function liftedAir(split: SplitNode, index: number, outermost: boolean): LayoutNode | null {
  const [left, right] = [split.children[index], split.children[index + 1]]
  if (isNegativeSpace(left) && isNegativeSpace(right)) return null
  const [leftWeight, rightWeight] = [split.weights[index], split.weights[index + 1]]
  const leftTaken = isNegativeSpace(left) ? null : takeEdgeAir(left, 'end')
  const rightTaken = isNegativeSpace(right) ? null : takeEdgeAir(right, 'start')
  if ((!isNegativeSpace(left) && !leftTaken) || (!isNegativeSpace(right) && !rightTaken)) return null

  // The run keeps its first leaf: the one on the left.
  const middle: Array<[LayoutNode, number]> = [
    ...(leftTaken ? [[leftTaken.rest, leftWeight * (1 - leftTaken.share)] as [LayoutNode, number]] : []),
    [
      leftTaken ? leftTaken.air : left,
      (leftTaken ? leftWeight * leftTaken.share : leftWeight) +
        (rightTaken ? rightWeight * rightTaken.share : rightWeight),
    ],
    ...(rightTaken ? [[rightTaken.rest, rightWeight * (1 - rightTaken.share)] as [LayoutNode, number]] : []),
  ]
  return spliced(split, index, middle, outermost)
}

/**
 * Two groups that meet with air joined into one, the first, with the air
 * merged in the middle of it: `[[a, n], [n, b], c…]` is `[[a, n, b], c…]`.
 * The split this happens in gets a child fewer rather than one more, which is
 * how a split with ten children still has room to merge.
 */
function joinedGroups(split: SplitNode, index: number, outermost: boolean): LayoutNode | null {
  const [left, right] = [split.children[index], split.children[index + 1]]
  if (!nestedAirAt(left, split.axis, 'end') || !nestedAirAt(right, split.axis, 'start')) return null
  const leftTaken = takeEdgeAir(left, 'end')
  const rightTaken = takeEdgeAir(right, 'start')
  if (!leftTaken || !rightTaken || left.kind !== 'split') return null
  const [leftWeight, rightWeight] = [split.weights[index], split.weights[index + 1]]

  const parts = (rest: LayoutNode, weight: number): Array<[LayoutNode, number]> => {
    if (rest.kind !== 'split' || rest.axis !== split.axis) return [[rest, weight]]
    const total = sum(rest.weights)
    return rest.children.map((child, at) => [child, (weight * rest.weights[at]) / total])
  }
  const joined: Array<[LayoutNode, number]> = [
    ...parts(leftTaken.rest, leftWeight * (1 - leftTaken.share)),
    [leftTaken.air, leftWeight * leftTaken.share + rightWeight * rightTaken.share],
    ...parts(rightTaken.rest, rightWeight * (1 - rightTaken.share)),
  ]
  const group = rebuilt(
    left,
    joined.map(([child]) => child),
    joined.map(([, weight]) => weight),
    false,
  )
  return group && spliced(split, index, [[group, leftWeight + rightWeight]], outermost)
}

/**
 * The outer piece of the two left out, so the nested one is all the air there
 * is: `[n, [[n, a], b]]` is `[[n, a], b]`. Its room goes to every other child
 * of the split alike, so only where that is the whole row — the outermost
 * split — does all of the row's content grow by one factor.
 */
function droppedPiece(split: SplitNode, index: number, outermost: boolean): LayoutNode | null {
  if (!outermost) return null
  const drop = [index, index + 1].find((at) => isNegativeSpace(split.children[at]))
  if (drop === undefined) return null
  const children = split.children.filter((_, at) => at !== drop)
  const weights = split.weights.filter((_, at) => at !== drop)
  return children.length === 1 ? children[0] : { ...split, children, weights }
}

/**
 * The air at `edge` of a split, taken out: the air leaf, the share of the
 * split it had, and the split without it — its one remaining child, when that
 * is all there is. `null` when a split on the way down cannot keep its
 * content's proportions without it.
 */
function takeEdgeAir(node: LayoutNode, edge: Edge): { air: LayoutNode; share: number; rest: LayoutNode } | null {
  if (node.kind !== 'split') return null
  const at = edge === 'start' ? 0 : node.children.length - 1
  const end = node.children[at]
  const share = node.weights[at] / sum(node.weights)
  if (isNegativeSpace(end)) {
    // Taking a child out leaves the others' whole ratios as they were.
    const children = node.children.filter((_, index) => index !== at)
    const weights = node.weights.filter((_, index) => index !== at)
    return {
      air: end,
      share,
      rest: children.length === 1 ? children[0] : { ...node, children, weights },
    }
  }
  const inner = takeEdgeAir(end, edge)
  if (!inner) return null
  const children = [...node.children]
  const desired = [...node.weights]
  children[at] = inner.rest
  desired[at] = node.weights[at] * (1 - inner.share)
  const rest = rebuilt(node, children, desired, false)
  return rest ? { air: inner.air, share: share * inner.share, rest } : null
}

/* ------------------------------------------------------------------ *
 * Whole ratios, and the promise they are held to
 * ------------------------------------------------------------------ */

const EPSILON = 1e-9

/** `split` with children `index` and `index + 1` replaced by `middle`, each with its desired weight. */
function spliced(
  split: SplitNode,
  index: number,
  middle: ReadonlyArray<readonly [LayoutNode, number]>,
  outermost: boolean,
): LayoutNode | null {
  const children = [
    ...split.children.slice(0, index),
    ...middle.map(([child]) => child),
    ...split.children.slice(index + 2),
  ]
  const desired = [
    ...split.weights.slice(0, index),
    ...middle.map(([, weight]) => weight),
    ...split.weights.slice(index + 2),
  ]
  return rebuilt(split, children, desired, outermost)
}

/** A split with new children, on whole ratios; its one child when that is all; `null` off the ladder. */
function rebuilt(
  split: SplitNode,
  children: LayoutNode[],
  desired: readonly number[],
  outermost: boolean,
): LayoutNode | null {
  if (children.length === 1) return children[0]
  const weights = wholeRatios(desired, children, outermost)
  return weights ? { ...split, children, weights } : null
}

/**
 * Whole ratios for `desired` that keep every content child's proportion to
 * the others exactly: all of them scaled by one factor. Air is scaled with
 * them, or — where `mayGiveUpAir` — rounded down, so the content's share can
 * only grow. Of the scales that work, the one whose content grows least.
 */
function wholeRatios(
  desired: readonly number[],
  children: readonly LayoutNode[],
  mayGiveUpAir: boolean,
): number[] | null {
  const anchor = children.findIndex((child) => !isNegativeSpace(child))
  // Nothing but air has no proportions to keep; it is one leaf a merge later.
  if (anchor < 0) return desired.map((weight) => Math.min(MAX_ZONE_RATIO, Math.max(MIN_ZONE_RATIO, Math.round(weight))))
  let best: { weights: number[]; growth: number; scale: number } | null = null
  for (let rung = MIN_ZONE_RATIO; rung <= MAX_ZONE_RATIO; rung += 1) {
    const scale = rung / desired[anchor]
    const weights = desired.map((weight, index) => {
      const scaled = weight * scale
      if (mayGiveUpAir && isNegativeSpace(children[index])) {
        return Math.min(MAX_ZONE_RATIO, Math.floor(scaled + EPSILON))
      }
      const whole = Math.round(scaled)
      return Math.abs(whole - scaled) <= EPSILON * Math.max(1, scaled) ? whole : Number.NaN
    })
    if (!areRatiosQuantized(weights)) continue
    const growth = (scale * sum(desired)) / sum(weights)
    // On a tie, the numbers nearest the ones written down: `[2, 4, 2]` stays.
    const better =
      !best ||
      growth < best.growth - EPSILON ||
      (growth < best.growth + EPSILON && Math.abs(Math.log(scale)) < Math.abs(Math.log(best.scale)))
    if (better) best = { weights, growth, scale }
  }
  return best?.weights ?? null
}

/** Whether every split in the tree could be stored as it is. */
function isStorable(node: LayoutNode): boolean {
  if (node.kind === 'leaf') return true
  return (
    node.children.length >= MIN_SPLIT_CHILDREN &&
    node.children.length <= MAX_SPLIT_CHILDREN &&
    node.weights.length === node.children.length &&
    areRatiosQuantized(node.weights) &&
    node.children.every(isStorable)
  )
}

/**
 * The factor every content zone in `before` grew by along its axis in
 * `after`, or `null` when they did not all grow by the same one — or when it
 * is not 1 inside a row (`outermost` false), where growth would be growth
 * against the rest of the row.
 *
 * Shares are what the ratios say, along splits that run the same way; a
 * split running the other way is one unit, since nothing here changes it.
 */
function growthOf(before: SplitNode, after: LayoutNode, outermost: boolean): number | null {
  const was = sharesAlong(before, before.axis)
  const now = sharesAlong(after, before.axis)
  if (was.size !== now.size) return null
  if (was.size === 0) return 1
  let growth: number | null = null
  for (const [id, share] of was) {
    const next = now.get(id)
    if (next === undefined) return null
    const factor = next / share
    if (growth === null) growth = factor
    else if (Math.abs(factor - growth) > EPSILON * growth) return null
  }
  if (growth === null || growth < 1 - EPSILON) return null
  if (!outermost && Math.abs(growth - 1) > EPSILON) return null
  return growth
}

/** Each content unit's share of `node` along `axis`, by id. */
function sharesAlong(node: LayoutNode, axis: Axis, share = 1, out = new Map<string, number>()): Map<string, number> {
  if (node.kind === 'split' && node.axis === axis) {
    const total = sum(node.weights)
    node.children.forEach((child, index) => sharesAlong(child, axis, (share * node.weights[index]) / total, out))
  } else if (!isNegativeSpace(node)) {
    out.set(node.id, share)
  }
  return out
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
