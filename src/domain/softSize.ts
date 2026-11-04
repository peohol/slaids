/**
 * The two minimum sizes a zone has, and the searches that find the soft one.
 *
 * A zone holding content has two floors, and they answer different questions:
 *
 *  - **Hard** — can this *kind* of content be drawn here at all, empty? That is
 *    `contentSize.ts` for a leaf and `minimumSizeFor` in `geometry.ts` for a
 *    subtree (every child's floor through the split's own ratios, plus the
 *    gaps). Nothing goes below it: not an agent, not a hand on a drag handle,
 *    not a stored document the validator accepts.
 *  - **Soft** — does the content that is *there* fit at the deck's normal
 *    typography? That is the fit checker (`domain/fit.ts`, or the DOM measurer
 *    in the app), asked of the zone's actual rect. It is the size an agent may
 *    never shrink a zone below (`commands/fitGuard.ts`), and the size a hand on
 *    a drag handle is held at for a moment before it may push past
 *    (`ui/editor/softLimitDrag.ts`).
 *
 * Between the two, the zone is legal and its content is drawn smaller: the
 * renderer lays the content out in a box `1/s` times the zone and scales it
 * back down by `s` (`ui/slide/ZoneFitBox.tsx`). Nothing about that is stored —
 * `s` is derived from the content and the geometry every time it is drawn.
 *
 * This module holds only the two searches, as pure functions of a yes/no
 * question about fit. Which measurement answers the question is the caller's:
 * the estimator in tests and on the server, the live DOM for the visible
 * slide, the offscreen renderer while a drag looks for the soft limit. One
 * search, so the scale the slide is drawn at and the limit the drag snaps to
 * are found the same way.
 */

/**
 * How close, relative to itself, a found scale is to the largest one that fits.
 *
 * Half a per cent of the type size is under a pixel for any type a slide uses,
 * and each halving of it costs one more layout of the zone.
 */
export const FIT_SCALE_PRECISION = 0.005

/**
 * The smallest scale the search goes down to.
 *
 * Not a floor on how small text may be drawn — there is none — but a bound on
 * the search itself: content that does not fit even in a box a million times
 * the zone's size is content no scale can show, and a search for it must end.
 * In practice the search stops thousands of times above this.
 */
export const MIN_FIT_SCALE = 2 ** -20

/** How finely, in design pixels, a soft limit along one axis is located. */
export const SOFT_LIMIT_PRECISION = 0.5

/**
 * The largest uniform scale `s ≤ 1` at which content fits a `width × height`
 * zone, when it is laid out in a box of `width / s × height / s` and drawn
 * scaled by `s`.
 *
 * `fitsIn(w, h)` answers whether the content fits a box of that size at normal
 * typography. Laying out in the enlarged box and scaling the result is what
 * makes this exact rather than an approximation of a smaller font: the scaled
 * content *is* the normal content of a bigger box, so the question the search
 * asks is the very question the renderer's result answers.
 *
 * `hint` is the scale found last time, if there was one. Geometry changes in
 * small steps — a drag, a window resize — and the answer seldom moves far, so
 * the search brackets the answer outwards from the hint instead of starting
 * from scratch: two or three measurements where a cold search takes eight.
 *
 * Assumes that a bigger box never fits less, which is what text does. Where a
 * measurement disagrees with that, the answer is still one that was measured
 * to fit.
 */
export function fitScale(
  fitsIn: (width: number, height: number) => boolean,
  width: number,
  height: number,
  hint = 1,
): number {
  const search = fitScaleSearch(width, height, hint)
  let step = search.next()
  while (!step.done) step = search.next(fitsIn(width / step.value, height / step.value))
  return step.value
}

/**
 * `fitScale` for a measurement that has to be waited for — a page in another
 * process, as when a preview is rasterised (`render/chromium.ts`). The same
 * search, step for step: only how each answer arrives differs.
 */
export async function fitScaleAsync(
  fitsIn: (width: number, height: number) => Promise<boolean>,
  width: number,
  height: number,
  hint = 1,
): Promise<number> {
  const search = fitScaleSearch(width, height, hint)
  let step = search.next()
  while (!step.done) step = search.next(await fitsIn(width / step.value, height / step.value))
  return step.value
}

/**
 * The search behind both: it yields each scale it wants measured, is told
 * whether the content fits at it, and returns the answer.
 */
function* fitScaleSearch(width: number, height: number, hint: number): Generator<number, number, boolean> {
  if (!(width > 0) || !(height > 0)) return 1
  if (yield 1) return 1

  // A bracket: `low` fits, `high` does not. Grown outwards from the hint.
  let low: number
  let high: number
  const start = hint > 0 && hint < 1 ? Math.max(hint, MIN_FIT_SCALE) : 0.5
  if (yield start) {
    low = start
    high = 1
    // Try a hair above the hint first: the common case is that it barely moved.
    let step = 1 + FIT_SCALE_PRECISION * 4
    while (low * step < 1) {
      const probe = low * step
      if (!(yield probe)) {
        high = probe
        break
      }
      low = probe
      step *= step
    }
  } else {
    high = start
    let step = 1 + FIT_SCALE_PRECISION * 4
    for (;;) {
      low = Math.max(MIN_FIT_SCALE, high / step)
      if (yield low) break
      if (low <= MIN_FIT_SCALE) return MIN_FIT_SCALE
      high = low
      step *= step
    }
  }

  while ((high - low) / high > FIT_SCALE_PRECISION) {
    const middle = (low + high) / 2
    if (yield middle) low = middle
    else high = middle
  }
  return low
}

/**
 * The shortest length in `[from, to]` at which `fitsAt(length)` holds, or
 * `null` when it does not hold even at `to`.
 *
 * This is the soft limit along one axis: `from` is the hard minimum (or the
 * length a zone has now, when it is known to fit there), `to` the most room
 * the gesture could ever give it. The answer is a length that was *measured*
 * to fit — the bracket's upper end — so a zone held at it never shows its
 * content scaled, however the measurement rounds.
 */
export function shortestFittingLength(
  fitsAt: (length: number) => boolean,
  from: number,
  to: number,
  precision = SOFT_LIMIT_PRECISION,
): number | null {
  if (fitsAt(from)) return from
  if (to <= from || !fitsAt(to)) return null
  let low = from
  let high = to
  while (high - low > precision) {
    const middle = (low + high) / 2
    if (fitsAt(middle)) high = middle
    else low = middle
  }
  return high
}
