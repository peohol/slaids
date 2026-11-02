/**
 * Negative space as part of the zone structure, not only as a kind of content.
 *
 * Deliberate air is an ordinary leaf (`NegativeSpaceContent`), and two pieces
 * of it side by side are one piece of air drawn twice: nothing on the slide
 * tells them apart, and a gesture that grows "the air on this side" could not
 * say which of them it meant. So a split never keeps two adjacent ones — they
 * are merged into one, whichever operation put them next to each other: a
 * manual conversion, a deleted zone that used to stand between them, a move, a
 * paste, an agent, or a drag that let a zone go. The rule is applied in one
 * place, `withSlide`, which is the door every edit of a content slide's layout
 * goes through, so no command has to remember it and none can forget it.
 *
 * Merging is structural and therefore deterministic about identity: the run
 * keeps the *first* leaf — its node id and its content id — and takes the
 * whole run's weight. A split whose children are all air becomes that one leaf
 * of air, the way any single-child split collapses into its child, and the
 * rule is applied bottom-up so the collapse can expose a new pair one level
 * higher, which is then merged too.
 *
 * What counts is the edge on the slide, not the level in the tree. Air at the
 * end of a split that runs the same way as its parent covers that split's
 * whole side, so where it meets air beside the split — `[n, [n, a, n], n]` —
 * the two are one piece of air on one edge, separated by nothing but a gap.
 * That air is taken out of the inner split and merged with its neighbour, so
 * the example is stored as `[n, a, n]`. Air across a split that runs the
 * other way covers only part of the edge, and is different air.
 */

import { MAX_SPLIT_CHILDREN } from './constants'
import { areRatiosQuantized, rankedRatioQuantizations, MAX_RANKED_QUANTIZATIONS } from './ratios'
import type { Axis, LayoutNode } from './types'

/** Whether a node is a leaf of deliberate air. */
export function isNegativeSpace(node: LayoutNode): boolean {
  return node.kind === 'leaf' && node.content?.kind === 'negative-space'
}

/**
 * The tree with every run of air on one edge merged into one piece.
 *
 * Returns the very same object when there is nothing to merge, so the many
 * edits that never touch air — typing, above all — cost a walk and nothing
 * else.
 */
export function mergeNegativeSpace(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return node
  const children = node.children.map(mergeNegativeSpace)
  const childrenChanged = children.some((child, index) => child !== node.children[index])
  const unchanged = (): LayoutNode => (childrenChanged ? { ...node, children } : node)

  const opened = openTouchingEdges(node.axis, children, node.weights)
  const merged: LayoutNode[] = []
  const weights: number[] = []
  opened.children.forEach((child, index) => {
    const last = merged.length - 1
    if (last >= 0 && isNegativeSpace(child) && isNegativeSpace(merged[last])) {
      weights[last] += opened.weights[index]
      return
    }
    merged.push(child)
    weights.push(opened.weights[index])
  })

  if (merged.length === 1) return merged[0]
  if (!opened.changed && merged.length === children.length) return unchanged()
  // Two nested edges opened into one split can, in a split already near the
  // limit, add a child more than a split may store; it is left as it was.
  if (merged.length > MAX_SPLIT_CHILDREN) return unchanged()
  return { ...node, children: merged, weights: onLadder(weights, merged) }
}

/** Which end of a split. */
type Edge = 'start' | 'end'

/**
 * Whether `node`, as a child of a split along `axis`, has air along its whole
 * `edge` that is not itself a child of that split: air at that end of a split
 * running the same way, however deep.
 */
function nestedAirAt(node: LayoutNode, axis: Axis, edge: Edge): boolean {
  if (node.kind !== 'split' || node.axis !== axis) return false
  const end = node.children[edge === 'start' ? 0 : node.children.length - 1]
  return isNegativeSpace(end) || nestedAirAt(end, axis, edge)
}

/** Whether `node` has air along its whole `edge`, as a child or nested. */
function airAt(node: LayoutNode, axis: Axis, edge: Edge): boolean {
  return isNegativeSpace(node) || nestedAirAt(node, axis, edge)
}

/**
 * The children with nested air that meets air beside it taken out to this
 * level, next to the air it meets — where the merge then joins them — and
 * each one's weight shared out between what it was split into.
 */
function openTouchingEdges(
  axis: Axis,
  children: readonly LayoutNode[],
  weights: readonly number[],
): { children: LayoutNode[]; weights: number[]; changed: boolean } {
  const out: LayoutNode[] = []
  const outWeights: number[] = []
  let changed = false
  children.forEach((child, index) => {
    const before = index > 0 && airAt(children[index - 1], axis, 'end')
    const after = index < children.length - 1 && airAt(children[index + 1], axis, 'start')
    let rest: LayoutNode = child
    let restShare = 1
    const tail: Array<[LayoutNode, number]> = []
    if (before && nestedAirAt(rest, axis, 'start')) {
      const taken = takeEdgeAir(rest, 'start')
      out.push(taken.air)
      outWeights.push(weights[index] * restShare * taken.share)
      restShare *= 1 - taken.share
      rest = taken.rest
      changed = true
    }
    if (after && nestedAirAt(rest, axis, 'end')) {
      const taken = takeEdgeAir(rest, 'end')
      tail.push([taken.air, restShare * taken.share])
      restShare *= 1 - taken.share
      rest = taken.rest
      changed = true
    }
    out.push(rest)
    outWeights.push(weights[index] * restShare)
    for (const [air, share] of tail) {
      out.push(air)
      outWeights.push(weights[index] * share)
    }
  })
  return { children: out, weights: outWeights, changed }
}

/**
 * The air at `edge` of a split, taken out: the air leaf, what share of the
 * split it had, and the split without it — its one remaining child, when that
 * is all there is, the way any single-child split collapses.
 */
function takeEdgeAir(
  split: LayoutNode,
  edge: Edge,
): { air: LayoutNode; share: number; rest: LayoutNode } {
  if (split.kind !== 'split') throw new Error('takeEdgeAir: not a split')
  const at = edge === 'start' ? 0 : split.children.length - 1
  const end = split.children[at]
  const total = split.weights.reduce((sum, weight) => sum + weight, 0)
  const share = split.weights[at] / total
  if (isNegativeSpace(end)) {
    const children = split.children.filter((_, index) => index !== at)
    const weights = split.weights.filter((_, index) => index !== at)
    const rest = children.length === 1 ? children[0] : { ...split, children, weights }
    return { air: end, share, rest }
  }
  // Deeper: the air is at the same end of the child at that end.
  const inner = takeEdgeAir(end, edge)
  const children = [...split.children]
  const weights = [...split.weights]
  children[at] = inner.rest
  weights[at] = split.weights[at] * (1 - inner.share)
  return {
    air: inner.air,
    share: share * inner.share,
    rest: { ...split, children, weights: onLadder(weights, children) },
  }
}

/**
 * A rearranged split's weights, as whole ratios again.
 *
 * Summing a run of air keeps every other zone's share of the split exactly,
 * and as the split now has one gap fewer those zones even grow a little —
 * merging air can never hide content. Only a sum past `MAX_ZONE_RATIO`, or
 * air taken out of a nested split, needs another rung, and then the nearest
 * rung that leaves no content zone with a smaller share than it had is taken:
 * what changes is the air.
 */
function onLadder(weights: number[], children: readonly LayoutNode[]): number[] {
  if (areRatiosQuantized(weights)) return weights
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const ranked = rankedRatioQuantizations(weights, MAX_RANKED_QUANTIZATIONS)
  const keepsContent = (candidate: readonly number[]): boolean => {
    const candidateTotal = candidate.reduce((sum, weight) => sum + weight, 0)
    return children.every(
      (child, index) =>
        isNegativeSpace(child) || candidate[index] * total >= weights[index] * candidateTotal,
    )
  }
  return ranked.find(keepsContent) ?? ranked[0]
}
