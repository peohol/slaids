/**
 * The cover.
 *
 * Two pills, centred as one block in the middle of the page: the title in the
 * same type a slide title is set in, the subtitle one step below it. Both are
 * centred by construction — there is no alignment to store and none to pick —
 * which is why the pills are laid out here rather than positioned from the
 * geometry engine: a pill is only as wide as its text, so where it starts is a
 * matter of centring, exactly as a heading pill inside a card is.
 *
 * What geometry *does* decide is the part CSS cannot answer: how much room each
 * line actually has. That is `computeCoverGeometry`, and the fit gate measures
 * against the same rects — so the pill's `max-width` here and the width a line
 * is judged against there are the same number, and a line that would be clipped
 * is refused before it is committed rather than quietly cut off.
 *
 * The pill colour is the deck's, and the text colour is never picked: it
 * follows from contrast, like every other colour pair in Slaids.
 */

import type { ReactNode } from 'react'
import {
  COVER_PILL_PADDING_X_EM,
  COVER_PILL_PADDING_Y_EM,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { bestTextColor } from '../../domain/color'
import { computeCoverGeometry } from '../../domain/geometry'
import { coverGeometryForTheme, themeMetrics } from '../../domain/metrics'
import { isDocEmpty } from '../../domain/richdoc'
import type { DeckCover, PresentationTheme } from '../../domain/types'
import { useSlideRender } from './SlideRenderContext'
import { RichDocView } from './RichDocView'
import { slideTokenStyle } from './SlideView'

export type CoverLine = 'title' | 'subtitle'

export const COVER_LINES: readonly CoverLine[] = ['title', 'subtitle']

/** The document a line draws. */
export function coverLineDoc(cover: DeckCover, line: CoverLine) {
  return line === 'title' ? cover.title : cover.subtitle
}

/** The two type sizes the cover is set in, under a given theme. */
export function coverFontSizes(theme: PresentationTheme): Record<CoverLine, number> {
  const metrics = themeMetrics(theme)
  return { title: metrics.titleFontSize, subtitle: metrics.coverSubtitleFontSize }
}

/**
 * The cover's frame: the page, the centred block, and one pill per line.
 *
 * The editor draws its own editable lines into the same frame, so what is being
 * typed sits in exactly the box that will be presented.
 */
export function CoverFrame({
  pillColor,
  lines,
  renderLine,
  pillRef,
  testId = 'cover-page',
  children,
}: {
  pillColor: string
  /** Which lines get a pill. A line with no text draws none when presented. */
  lines: readonly CoverLine[]
  renderLine: (line: CoverLine) => ReactNode
  /** The pill's own element — the box the editor measures its overflow against. */
  pillRef?: (line: CoverLine, element: HTMLElement | null) => void
  testId?: string
  children?: ReactNode
}) {
  const { theme } = useSlideRender()
  const options = coverGeometryForTheme(theme)
  const geometry = computeCoverGeometry(options)
  const fontSizes = coverFontSizes(theme)

  return (
    <div
      className="slide cover-page"
      data-testid={testId}
      style={{
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        background: theme.backgroundColor,
        gap: options.gap,
        ...slideTokenStyle(theme, pillColor),
      }}
    >
      {lines.map((line) => (
        <div
          key={line}
          ref={(element) => pillRef?.(line, element)}
          className={`cover-pill cover-pill--${line}`}
          data-cover-line={line}
          data-fit-scroll=""
          style={{
            background: pillColor,
            color: bestTextColor(pillColor),
            fontFamily: theme.headingFontFamily,
            fontSize: fontSizes[line],
            lineHeight: TITLE_LINE_HEIGHT,
            padding: `${COVER_PILL_PADDING_Y_EM}em ${COVER_PILL_PADDING_X_EM}em`,
            // Border-box, so this less the pill's own padding is exactly the
            // width `computeCoverGeometry` hands the fit checker.
            maxWidth: geometry.areaRect.width,
          }}
        >
          {renderLine(line)}
        </div>
      ))}
      {children}
    </div>
  )
}

export function CoverPageView({ cover }: { cover: DeckCover }) {
  // An empty line draws no pill: a coloured lozenge with nothing in it is not
  // content, and a deck with no subtitle should not look like it lost one.
  const lines = COVER_LINES.filter((line) => !isDocEmpty(coverLineDoc(cover, line)))

  return (
    <CoverFrame
      pillColor={cover.pillColor}
      lines={lines}
      renderLine={(line) => (
        <RichDocView doc={coverLineDoc(cover, line)} className="rich-doc--title" />
      )}
    />
  )
}
