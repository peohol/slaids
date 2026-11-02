/** Shared helpers for the command modules. */

export { cloneSubtreeWithNewIds, cloneContentWithNewIds, createLeaf } from '../layout'
export { subtreeFitsInRect as subtreeFitsHelper } from '../geometry'

import { computeSlideGeometry, resolveOptions } from '../geometry'
import { contentKindRefusal } from '../contentSize'
import type { GeometryOptions } from '../geometry'
import { geometryForTheme } from '../metrics'
import { interactiveBudgetRegression, interactiveSlidesIn } from '../interactive'
import { asDeckSlides, findSlide, normalizedSlide, touch } from '../presentation'
import { err, ok, type Refusal, type Result } from '../result'
import type { ContentSlide, NodeId, Presentation, Rect, Slide, ZoneContentKind } from '../types'

/**
 * Commit a rebuilt slide list.
 *
 * The one door between a plain array and the deck, so the rule that a deck
 * opens with a section is decided in one place rather than remembered by every
 * command that inserts, removes or reorders — whichever kind of slide it is
 * inserting. `asDeckSlides` is what says yes; this only turns its `null` into
 * the refusal a caller can act on. Every slide in it is normalised on the way
 * in (`normalizedSlide`), as `withSlide` does for one.
 */
export function withSlides(presentation: Presentation, slides: readonly Slide[]): Result<Presentation> {
  const deckSlides = asDeckSlides(slides.map(normalizedSlide))
  if (!deckSlides) {
    return err(
      'FIRST_SLIDE_MUST_BE_SECTION',
      'Første slide må være en inndeling, så presentasjonen alltid har en forside.',
    )
  }
  const overBudget = budgetRefusal(presentation, slides)
  if (overBudget) return overBudget
  return ok(touch({ ...presentation, slides: deckSlides }))
}

/**
 * The deck-wide miniapp budget, asked of every change to the slide list.
 *
 * Here rather than in each command, because it is a property of the *list*:
 * adding a slide is not the only way to hold more miniapp source than the
 * budget allows — duplicating one is too, and so would be any way of building
 * a slide list that is invented later. A command that had to remember this
 * rule is a command that can forget it, and forgetting it means writing a
 * document that `validatePresentation` then refuses to open again.
 *
 * Two things keep it cheap and keep it from trapping anybody:
 *
 *  - When the interactive slides are the very same objects as before, nothing
 *    about the source can have changed, and the bytes are not counted at all.
 *    That is every ordinary edit, every move and every delete of a slide that
 *    holds no app.
 *  - A list that is over the budget is refused only when it is *worse* than
 *    what is already stored. A document that got over the line some other way
 *    can still be edited down; the rule is «do not make it worse», which is
 *    the only version of it that cannot leave somebody stuck.
 */
function budgetRefusal(presentation: Presentation, slides: readonly Slide[]): Refusal | null {
  const before = interactiveSlidesIn(presentation)
  const after = interactiveSlidesIn({ slides })
  if (before.length === after.length && before.every((slide, index) => slide === after[index])) {
    return null
  }
  return interactiveBudgetRegression(presentation, { slides })
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

/**
 * The refusal a kind of content earns in a rect it cannot be drawn in, if any.
 *
 * One helper behind every door that puts content into a zone — placing,
 * moving, copying, converting, placing from the sandbox, and the drop target
 * that lights up before any of them run — so «this kind cannot be drawn that
 * small» is decided by `domain/contentSize.ts` and phrased once. It is asked
 * *before* the fit check and answers with its own code, because the two call
 * for different repairs: `ZONE_TOO_SMALL` needs a bigger zone, and
 * `CONTENT_DOES_NOT_FIT` needs shorter text.
 *
 * The details carry both rectangles rather than only a sentence, so an agent
 * can act on the numbers and a picker can grey a button out with the same
 * answer.
 */
export function contentTooBigForZone(
  kind: ZoneContentKind,
  rect: Rect,
  geometry: GeometryOptions,
  where: { slideId: string; nodeId: NodeId },
): Refusal | null {
  const refusal = contentKindRefusal(kind, rect, resolveOptions(geometry).metrics)
  if (!refusal) return null
  return err('ZONE_TOO_SMALL', refusal.message, {
    ...where,
    contentKind: kind,
    rect: refusal.rect,
    minimum: refusal.minimum,
  })
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
