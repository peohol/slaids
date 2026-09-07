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

import type { ContentSlide, DeckSlides, InteractiveSlide, SectionSlide, Slide } from './types'

/** The deck's slides, if the first of them is a section. */
export function asDeckSlides(slides: readonly Slide[]): DeckSlides | null {
  const [first, ...rest] = slides
  return first && first.kind === 'section' ? [first, ...rest] : null
}

/**
 * Rebuild every slide, keeping each one's kind.
 *
 * One mapper per kind rather than one for all, because there are three shapes
 * and no shared "slide" shape to map: what a transformation does to a
 * section's two lines is not what it does to a content slide's title and zone
 * tree, and an interactive slide has neither — its one field is a source file
 * that no document transform may touch. Every kind is named, so a caller that
 * forgets one is told by the compiler rather than by a slide that quietly
 * passed through the wrong branch.
 */
export function mapDeckSlides(
  slides: DeckSlides,
  map: {
    section: (slide: SectionSlide) => SectionSlide
    content: (slide: ContentSlide) => ContentSlide
    interactive: (slide: InteractiveSlide) => InteractiveSlide
  },
): DeckSlides {
  const [first, ...rest] = slides
  return [map.section(first), ...rest.map((slide) => mapSlide(slide, map))]
}

function mapSlide(
  slide: Slide,
  map: Parameters<typeof mapDeckSlides>[1],
): Slide {
  switch (slide.kind) {
    case 'section':
      return map.section(slide)
    case 'content':
      return map.content(slide)
    case 'interactive':
      return map.interactive(slide)
  }
}

/** Narrowing helpers, so a caller states which kind of slide it means. */
export function isSectionSlide(slide: Slide): slide is SectionSlide {
  return slide.kind === 'section'
}

export function isContentSlide(slide: Slide): slide is ContentSlide {
  return slide.kind === 'content'
}

export function isInteractiveSlide(slide: Slide): slide is InteractiveSlide {
  return slide.kind === 'interactive'
}
