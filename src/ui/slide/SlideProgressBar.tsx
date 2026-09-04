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
import { useSlideRender } from './SlideRenderContext'

/**
 * The fill, in per cent of the slide.
 *
 * Clamped rather than trusted: the fraction comes from a page's position in a
 * deck that can change under a renderer, and a bar wider than the slide would
 * be the one thing on the page painted outside it.
 */
function fillWidth(progress: number): string {
  if (!Number.isFinite(progress)) return '0%'
  return `${Math.min(1, Math.max(0, progress)) * 100}%`
}

export function SlideProgressBar({ pageId }: { pageId: string }) {
  const { headingPillColor, progress } = useSlideRender()
  const position = progress.get(pageId)
  if (position === undefined) return null

  return (
    <div
      className="slide-progress"
      data-testid="slide-progress"
      style={{ height: PROGRESS_BAR_HEIGHT }}
      aria-hidden="true"
    >
      <div
        className="slide-progress__track"
        style={{ background: headingPillColor, opacity: PROGRESS_TRACK_OPACITY }}
      />
      <div
        className="slide-progress__fill"
        data-testid="slide-progress-fill"
        style={{
          background: headingPillColor,
          width: fillWidth(position),
          // Rounded where it grows, square where it starts: the right end is
          // the only end that ever moves.
          borderRadius: `0 ${PROGRESS_BAR_HEIGHT / 2}px ${PROGRESS_BAR_HEIGHT / 2}px 0`,
          transitionDuration: `${PROGRESS_TRANSITION_MS}ms`,
        }}
      />
    </div>
  )
}
