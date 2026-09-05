/** Shared helpers for the command modules. */

export { cloneSubtreeWithNewIds, cloneContentWithNewIds, createLeaf } from '../layout'
export { subtreeFitsInRect as subtreeFitsHelper } from '../geometry'

import { computeSlideGeometry } from '../geometry'
import type { GeometryOptions } from '../geometry'
import { geometryForTheme } from '../metrics'
import { findSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import type { ContentSlide, NodeId, Presentation, Rect } from '../types'

/**
 * The slide a zone command is about.
 *
 * Every command that names a zone starts here, so "a section has no zones" is
 * answered once, in the same words, rather than by each command discovering it
 * when `slide.root` turns out not to exist. The two refusals are different
 * because the caller's next move is: an unknown id is a mistake about which
 * deck this is, a section is a mistake about which page.
 */
export function contentSlide(
  presentation: Presentation,
  slideId: string,
): Result<ContentSlide> {
  const slide = findSlide(presentation, slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.', { slideId })
  if (slide.kind !== 'content') {
    return err('NOT_A_CONTENT_SLIDE', 'Seksjonsslides har ingen soner å redigere.', { slideId })
  }
  return ok(slide)
}

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
  slide: ContentSlide,
  nodeId: NodeId,
  options: GeometryOptions = {},
): Rect | null {
  const geometry = computeSlideGeometry(slide, options)
  return geometry.rects.get(nodeId) ?? null
}
