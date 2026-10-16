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
 *   answer is the slides that may have moved — see `movedSlideIds`.
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

/**
 * The slides of a reordering that may be the ones that moved: every slide
 * outside at least one longest run that kept its relative order.
 *
 * A slide in every such run certainly stayed put. One that is left out of some
 * of them is ambiguous at worst — swapping two neighbours is the same reorder
 * whichever of the two was moved — and both candidates are named rather than
 * one picked arbitrarily.
 */
function movedSlideIds(from: readonly Slide[], to: readonly Slide[]): string[] {
  const positionIn = new Map(to.map((slide, index) => [slide.id, index]))
  const order = from.map((slide) => positionIn.get(slide.id) ?? -1)
  const count = order.length
  // Longest increasing run ending at, and starting from, each slide.
  const ending = order.map(() => 1)
  const starting = order.map(() => 1)
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (order[j] < order[i]) ending[i] = Math.max(ending[i], ending[j] + 1)
    }
  }
  for (let i = count - 1; i >= 0; i -= 1) {
    for (let j = i + 1; j < count; j += 1) {
      if (order[j] > order[i]) starting[i] = Math.max(starting[i], starting[j] + 1)
    }
  }
  const longest = Math.max(0, ...ending)
  const onSomeRun = order.map((_, i) => ending[i] + starting[i] - 1 === longest)
  // Every longest run holds exactly one slide at each length, so a slide is in
  // all of them when it is the only candidate for its length.
  const candidates = new Map<number, number>()
  onSomeRun.forEach((on, i) => {
    if (on) candidates.set(ending[i], (candidates.get(ending[i]) ?? 0) + 1)
  })
  return from
    .filter((_, i) => !onSomeRun[i] || candidates.get(ending[i]) !== 1)
    .map((slide) => slide.id)
}
