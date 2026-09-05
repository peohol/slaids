/**
 * Deck helpers for tests.
 *
 * A deck opens with a section — `slides[0]` is the front page — so the slide a
 * zone test is about is the one after it. These two say which is meant and
 * narrow to it, so a test that reaches for a layout tree on a section fails
 * where it is written rather than at the first `undefined`.
 */

import type { ContentSlide, Presentation, SectionSlide } from './types'

/** The slide at `index`, which the caller says has zones. */
export function contentAt(presentation: Presentation, index: number): ContentSlide {
  const slide = presentation.slides[index]
  if (slide?.kind !== 'content') {
    throw new Error(`Slide ${index} is not a content slide`)
  }
  return slide
}

/** The slide at `index`, which the caller says is a section. */
export function sectionAt(presentation: Presentation, index: number): SectionSlide {
  const slide = presentation.slides[index]
  if (slide?.kind !== 'section') {
    throw new Error(`Slide ${index} is not a section`)
  }
  return slide
}
