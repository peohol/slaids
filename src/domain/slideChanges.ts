/**
 * Where in the deck a change between two versions of it can be seen.
 *
 * The editor asks this before it steps through the history: an undo or redo
 * whose change is on another page than the one on screen goes to that page
 * first, so the user sees what is being taken back or put back. The answer is
 * computed from the two documents alone — what the step does, not which
 * command once produced it — so every kind of edit, present and future, is
 * covered by the same rule.
 */

import type { Presentation, Slide } from './types'

/**
 * The slides of `from` on which going from `from` to `to` is visible, in deck
 * order. Empty when no slide changed — a deck-wide edit such as the theme, or
 * one to something no slide shows.
 *
 * - A slide that was edited or removed is its own answer.
 * - A slide that was added does not exist in `from` yet, so the answer is the
 *   page it will appear next to: the nearest one before it that is in both,
 *   or after it when nothing before it is.
 * - When nothing was edited, added or removed but the order changed, the
 *   answer is the slides that moved: those outside the longest run of slides
 *   that kept their relative order.
 */
export function slidesTouchedBy(from: Presentation, to: Presentation): string[] {
  if (from.slides === to.slides) return []
  const before = new Map(from.slides.map((slide) => [slide.id, slide]))
  const after = new Map(to.slides.map((slide) => [slide.id, slide]))
  const touched = new Set<string>()

  for (const slide of from.slides) {
    const next = after.get(slide.id)
    if (!next || !sameSlide(slide, next)) touched.add(slide.id)
  }
  to.slides.forEach((slide, index) => {
    if (before.has(slide.id)) return
    const neighbour = nearestKept(to.slides, index, before)
    if (neighbour) touched.add(neighbour)
  })

  if (touched.size === 0) {
    for (const id of movedSlideIds(from.slides, to.slides)) touched.add(id)
  }
  return from.slides.filter((slide) => touched.has(slide.id)).map((slide) => slide.id)
}

/**
 * Commands share the slides they did not touch, so identity answers almost
 * every comparison; the structural fallback covers one that rebuilt a slide
 * into an equal copy.
 */
function sameSlide(a: Slide, b: Slide): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

function nearestKept(
  slides: readonly Slide[],
  index: number,
  kept: ReadonlyMap<string, Slide>,
): string | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (kept.has(slides[at].id)) return slides[at].id
  }
  for (let at = index + 1; at < slides.length; at += 1) {
    if (kept.has(slides[at].id)) return slides[at].id
  }
  return null
}

/** The slides of a reordering that are not in a longest common subsequence. */
function movedSlideIds(from: readonly Slide[], to: readonly Slide[]): string[] {
  const rows = from.length
  const columns = to.length
  const lengths = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        from[i].id === to[j].id
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const stayed = new Set<string>()
  for (let i = 0, j = 0; i < rows && j < columns; ) {
    if (from[i].id === to[j].id) {
      stayed.add(from[i].id)
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }
  return from.filter((slide) => !stayed.has(slide.id)).map((slide) => slide.id)
}
