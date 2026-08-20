/** Shared helpers for the command modules. */

export { cloneSubtreeWithNewIds, cloneContentWithNewIds, createLeaf } from '../layout'
export { subtreeFitsInRect as subtreeFitsHelper } from '../geometry'

import { computeLayoutRects, computeSlideGeometry } from '../geometry'
import type { GeometryOptions } from '../geometry'
import { collectLeaves } from '../layout'
import type { ContentFitChecker } from '../fit'
import type { LayoutNode, NodeId, Rect, Slide, ZoneContent } from '../types'
import { G } from '../constants'

/** Rect of a node inside a slide, or `null` when the node does not exist. */
export function rectForNode(
  slide: Slide,
  nodeId: NodeId,
  options: GeometryOptions = {},
): Rect | null {
  const geometry = computeSlideGeometry(slide, options)
  return geometry.rects.get(nodeId) ?? null
}

export interface FitFailure {
  nodeId: NodeId
  content: ZoneContent
  overflow: number
}

/**
 * Check every piece of content inside a subtree against the rects it would get
 * if the subtree were placed in `area`.
 *
 * This is what makes a ratio change or a title toggle honour the content-fit
 * invariant: shrinking a zone whose content no longer fits is not allowed to
 * silently clip it.
 */
export function findFitFailures(
  node: LayoutNode,
  area: Rect,
  fits: ContentFitChecker | undefined,
  options: GeometryOptions = {},
): FitFailure[] {
  if (!fits) return []
  const rects = computeLayoutRects(node, area, options.gap ?? G)
  const failures: FitFailure[] = []
  for (const leaf of collectLeaves(node)) {
    if (!leaf.content) continue
    const rect = rects.get(leaf.id)
    if (!rect) continue
    const result = fits(leaf.content, rect)
    if (!result.fits) failures.push({ nodeId: leaf.id, content: leaf.content, overflow: result.overflow })
  }
  return failures
}
