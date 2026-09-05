/**
 * The deck's slide list, and the two operations that keep its promise.
 *
 * `DeckSlides` says that a deck opens with a section — that is the whole
 * content of "every presentation has a front page", stated once in the type
 * rather than as a rule each command has to remember. These are the only two
 * ways to produce one from something else, so this file is where that promise
 * is either checked (`asDeckSlides`, once, at the edge of every command that
 * rebuilds the list) or carried by the types (`mapDeckSlides`, which never
 * needs to check because the head goes through the mapper that returns a
 * section).
 *
 * It holds nothing but these, and imports nothing but types, so both
 * `presentation.ts` and the traversals in `docs.ts` can reach it.
 */

import type { ContentSlide, DeckSlides, SectionSlide, Slide } from './types'

/** The deck's slides, if the first of them is a section. */
export function asDeckSlides(slides: readonly Slide[]): DeckSlides | null {
  const [first, ...rest] = slides
  return first && first.kind === 'section' ? [first, ...rest] : null
}

/**
 * Rebuild every slide, keeping each one's kind.
 *
 * Two mappers rather than one, because there are two shapes and no shared
 * "slide" shape to map: what a transformation does to a section's two lines is
 * not what it does to a content slide's title and zone tree.
 */
export function mapDeckSlides(
  slides: DeckSlides,
  map: {
    section: (slide: SectionSlide) => SectionSlide
    content: (slide: ContentSlide) => ContentSlide
  },
): DeckSlides {
  const [first, ...rest] = slides
  return [
    map.section(first),
    ...rest.map((slide) => (slide.kind === 'section' ? map.section(slide) : map.content(slide))),
  ]
}

/** Narrowing helpers, so a caller states which kind of slide it means. */
export function isSectionSlide(slide: Slide): slide is SectionSlide {
  return slide.kind === 'section'
}

export function isContentSlide(slide: Slide): slide is ContentSlide {
  return slide.kind === 'content'
}
