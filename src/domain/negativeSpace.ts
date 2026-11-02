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
 * higher, which is then merged too. Only siblings are merged: air at different
 * levels of the hierarchy is different air.
 */

import { MAX_ZONE_RATIO } from './constants'
import { rankedRatioQuantizations, MAX_RANKED_QUANTIZATIONS } from './ratios'
import type { LayoutNode } from './types'

/** Whether a node is a leaf of deliberate air. */
export function isNegativeSpace(node: LayoutNode): boolean {
  return node.kind === 'leaf' && node.content?.kind === 'negative-space'
}

/**
 * The tree with every run of adjacent negative-space siblings merged into one.
 *
 * Returns the very same object when there is nothing to merge, so the many
 * edits that never touch air — typing, above all — cost a walk and nothing
 * else.
 */
export function mergeNegativeSpace(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return node
  const children = node.children.map(mergeNegativeSpace)
  const childrenChanged = children.some((child, index) => child !== node.children[index])

  const merged: LayoutNode[] = []
  const weights: number[] = []
  children.forEach((child, index) => {
    const last = merged.length - 1
    if (last >= 0 && isNegativeSpace(child) && isNegativeSpace(merged[last])) {
      weights[last] += node.weights[index]
      return
    }
    merged.push(child)
    weights.push(node.weights[index])
  })

  if (merged.length === 1) return merged[0]
  if (merged.length === children.length) {
    return childrenChanged ? { ...node, children } : node
  }
  return { ...node, children: merged, weights: withinRange(weights, merged) }
}

/**
 * A merged split's weights, back inside the range a ratio may take.
 *
 * Summing the run's weights keeps every other zone's share of the split
 * exactly, and as the split now has one gap fewer those zones even grow a
 * little — merging air can never hide content. Only a sum past
 * `MAX_ZONE_RATIO` needs another rung, and then the nearest rung that still
 * leaves no content zone with a smaller share than it had is taken.
 */
function withinRange(weights: number[], children: readonly LayoutNode[]): number[] {
  if (weights.every((weight) => weight <= MAX_ZONE_RATIO)) return weights
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
