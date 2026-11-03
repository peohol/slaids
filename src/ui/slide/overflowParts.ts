/**
 * Reading overflow off a laid-out zone.
 *
 * The one DOM reading every fit answer in the app comes down to — the
 * offscreen measurer (`state/measure.tsx`), the editor's typing guard and the
 * slide's own scaling (`ZoneFitBox`) — kept here, beside the components whose
 * clipping boxes it reads, so a slide can scale itself without depending on
 * the measuring machinery that renders slides offscreen.
 */

/**
 * Overflow per clipped region inside `element`, in logical pixels.
 *
 * Every box that clips carries `data-fit-scroll`, and the ones that are *part*
 * of something bigger carry `data-fit-part` naming which part they are — a
 * card's header, one field of a body, the caption over a picture. Reporting
 * them separately is what stops one full field from hiding another one starting
 * to overflow: see `FitParts`.
 *
 * A region with no part id is the whole of whatever is being measured (a slide
 * title, a section's line) and is reported under the empty key.
 */
export function measureOverflowParts(element: HTMLElement): Record<string, number> {
  const parts: Record<string, number> = {}
  // The element itself counts when it is one of them. `querySelectorAll` only
  // looks at descendants, and the slide title's clipping box *is* the host a
  // caller hands in — measured as descendants only, it reported nothing at all.
  const self = element.matches('[data-fit-scroll]') ? [element] : []
  for (const target of [...self, ...element.querySelectorAll<HTMLElement>('[data-fit-scroll]')]) {
    const part = target.dataset.fitPart ?? ''
    /*
     * Which way a box can fail is a property of the box.
     *
     * A single line of heading type — a slide title, a card's header, a
     * section's pill — is as tall as the type it is set in, by construction:
     * the box's height comes from the same token the line does, so it can only
     * fail sideways. What does stick out of it vertically is the decoration
     * around a citation's number, which is drawn inside the line and clipped by
     * design, and which the headless estimator does not measure either. Reading
     * it as an overflow would roll back every citation ever put in a title.
     */
    const axis = target.dataset.fitAxis
    const overflow = Math.max(
      axis === 'x' ? 0 : target.scrollHeight - target.clientHeight,
      axis === 'y' ? 0 : target.scrollWidth - target.clientWidth,
    )
    // Two boxes can legitimately claim the same part — a caption layer redrawn
    // per variant — so the worst of them is the part's overflow.
    parts[part] = Math.max(parts[part] ?? 0, overflow)
  }
  return parts
}

/** Largest overflow, in logical pixels, across every clipped region inside `element`. */
export function measureElementOverflow(element: HTMLElement): number {
  return Object.values(measureOverflowParts(element)).reduce(
    (worst, overflow) => Math.max(worst, overflow),
    0,
  )
}
