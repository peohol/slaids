/** Shared helpers for the command modules. */

export { cloneSubtreeWithNewIds, cloneContentWithNewIds, createLeaf } from '../layout'
export { subtreeFitsInRect as subtreeFitsHelper } from '../geometry'

import { computeSlideGeometry } from '../geometry'
import type { GeometryOptions } from '../geometry'
import type { NodeId, Rect, Slide } from '../types'

/** Rect of a node inside a slide, or `null` when the node does not exist. */
export function rectForNode(
  slide: Slide,
  nodeId: NodeId,
  options: GeometryOptions = {},
): Rect | null {
  const geometry = computeSlideGeometry(slide, options)
  return geometry.rects.get(nodeId) ?? null
}
