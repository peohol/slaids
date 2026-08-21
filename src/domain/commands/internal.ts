/** Shared helpers for the command modules. */

export { cloneSubtreeWithNewIds, cloneContentWithNewIds, createLeaf } from '../layout'
export { subtreeFitsInRect as subtreeFitsHelper } from '../geometry'

import { computeSlideGeometry } from '../geometry'
import type { GeometryOptions } from '../geometry'
import { geometryForTheme } from '../metrics'
import type { NodeId, Presentation, Rect, Slide } from '../types'

/**
 * Geometry options for a presentation.
 *
 * The gap and the title zone move with the theme, so every command that asks
 * where something is has to ask *this* deck rather than the base tokens. An
 * explicit override still wins — that is how a preview asks about a rect the
 * layout does not have yet.
 */
export function geometryFor(
  presentation: Presentation,
  options?: GeometryOptions,
): GeometryOptions {
  return { ...geometryForTheme(presentation.theme), ...options }
}

/** Rect of a node inside a slide, or `null` when the node does not exist. */
export function rectForNode(
  slide: Slide,
  nodeId: NodeId,
  options: GeometryOptions = {},
): Rect | null {
  const geometry = computeSlideGeometry(slide, options)
  return geometry.rects.get(nodeId) ?? null
}
