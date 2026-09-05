/**
 * The progress indicator.
 *
 * A low stripe along the bottom edge of every page but the cover: a track in
 * the deck's own pill colour at reduced opacity, and a fill in the same colour
 * at full opacity that grows to the right as the deck advances. Nothing else —
 * no number, no shadow, no label.
 *
 * How far through the deck a page sits is deck-wide knowledge, so the fraction
 * is looked up here from the render context rather than passed in: a host says
 * *which page* it is drawing, and a page the deck does not list — the cover,
 * and a slide being measured offscreen — draws nothing.
 *
 * The track and the fill are siblings rather than parent and child, and that is
 * the whole reason this is two elements: `opacity` on a parent applies to the
 * group, so a fill nested inside a 30 % track would be 30 % too, however
 * opaque its own colour was.
 *
 * The room the stripe takes is not decided here. It is reserved by the geometry
 * engine on every slide — see `PROGRESS_BAR_HEIGHT` — so the bar is drawn into
 * a strip no content was ever laid out in, and turning a full slide's indicator
 * "on" can never be the thing that pushes content out of view.
 */

import {
  PROGRESS_BAR_HEIGHT,
  PROGRESS_TRACK_OPACITY,
  PROGRESS_TRANSITION_MS,
} from '../../domain/constants'
import { useSectionColorsFor, useSlideRender } from './SlideRenderContext'

/**
 * The fill, in per cent of the slide.
 *
 * Clamped rather than trusted: the fraction comes from a page's position in a
 * deck that can change under a renderer, and a bar wider than the slide would
 * be the one thing on the page painted outside it.
 */
function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

/**
 * The fill's corners.
 *
 * Rounded where it grows, square where it starts — the right end is the only
 * end that ever moves. At the end of the deck it is square there too: a rounded
 * end sitting exactly on the track's own end would leave two slivers of track
 * showing past it, and the last page is supposed to read as full.
 */
function fillRadius(progress: number): string {
  const radius = progress < 1 ? PROGRESS_BAR_HEIGHT / 2 : 0
  return `0 ${radius}px ${radius}px 0`
}

export function SlideProgressBar({ pageId }: { pageId: string }) {
  const { progress } = useSlideRender()
  // The indicator is drawn in the accent of the section the page belongs to,
  // so it changes colour with the part of the deck it is measuring.
  const { accent } = useSectionColorsFor(pageId)
  const position = progress.get(pageId)
  if (position === undefined) return null
  const filled = clampProgress(position)

  return (
    <div
      className="slide-progress"
      data-testid="slide-progress"
      style={{ height: PROGRESS_BAR_HEIGHT }}
      aria-hidden="true"
    >
      <div
        className="slide-progress__track"
        style={{ background: accent, opacity: PROGRESS_TRACK_OPACITY }}
      />
      <div
        className="slide-progress__fill"
        data-testid="slide-progress-fill"
        style={{
          background: accent,
          width: `${filled * 100}%`,
          borderRadius: fillRadius(filled),
          transitionDuration: `${PROGRESS_TRANSITION_MS}ms`,
        }}
      />
    </div>
  )
}
