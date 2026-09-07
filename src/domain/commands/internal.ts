/** Shared helpers for the command modules. */

export { cloneSubtreeWithNewIds, cloneContentWithNewIds, createLeaf } from '../layout'
export { subtreeFitsInRect as subtreeFitsHelper } from '../geometry'

import { computeSlideGeometry } from '../geometry'
import type { GeometryOptions } from '../geometry'
import { geometryForTheme } from '../metrics'
import { asDeckSlides, findSlide, touch } from '../presentation'
import { err, ok, type Result } from '../result'
import type { ContentSlide, NodeId, Presentation, Rect, Slide } from '../types'

/**
 * Commit a rebuilt slide list.
 *
 * The one door between a plain array and the deck, so the rule that a deck
 * opens with a section is decided in one place rather than remembered by every
 * command that inserts, removes or reorders — whichever kind of slide it is
 * inserting. `asDeckSlides` is what says yes; this only turns its `null` into
 * the refusal a caller can act on.
 */
export function withSlides(presentation: Presentation, slides: readonly Slide[]): Result<Presentation> {
  const deckSlides = asDeckSlides(slides)
  if (!deckSlides) {
    return err(
      'FIRST_SLIDE_MUST_BE_SECTION',
      'Første slide må være en seksjon, så presentasjonen alltid har en forside.',
    )
  }
  return ok(touch({ ...presentation, slides: deckSlides }))
}

/** The insert position a caller asked for, or the refusal for one off the deck. */
export function insertionIndex(
  presentation: Presentation,
  index: number | undefined,
  message: string,
): Result<number> {
  const at = index ?? presentation.slides.length
  if (at < 0 || at > presentation.slides.length) return err('SLIDE_INDEX_OUT_OF_RANGE', message)
  return ok(at)
}

/**
 * The slide a zone command is about.
 *
 * Every command that names a zone starts here, so "this kind of slide has no
 * zones" — a section, an interactive slide — is answered once, in the same
 * words, rather than by each command discovering it when `slide.root` turns
 * out not to exist. The two refusals are different because the caller's next
 * move is: an unknown id is a mistake about which deck this is, a page without
 * zones is a mistake about which page.
 */
export function contentSlide(
  presentation: Presentation,
  slideId: string,
): Result<ContentSlide> {
  const slide = findSlide(presentation, slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.', { slideId })
  if (slide.kind !== 'content') {
    return err('NOT_A_CONTENT_SLIDE', 'Sliden har ingen soner å redigere.', { slideId })
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
