/**
 * A section slide — the deck's front page included, since it is the first one.
 *
 * Two pills, centred as one block in the middle of the page: the heading in the
 * same type a slide title is set in, the subheading one step below it. Both are
 * centred by construction — there is no alignment to store and none to pick —
 * which is why the pills are laid out here rather than positioned from the
 * geometry engine: a pill is only as wide as its text, so where it starts is a
 * matter of centring, exactly as a heading pill inside a card is. A section
 * with only a heading therefore centres that one line, and one with both
 * centres the pair, without either case being written down anywhere.
 *
 * What geometry *does* decide is the part CSS cannot answer: how much room each
 * line actually has. That is `computeSectionGeometry`, and the fit gate measures
 * against the same rects — so the pill's `max-width` here and the width a line
 * is judged against there are the same number, and a line that would be clipped
 * is refused before it is committed rather than quietly cut off.
 *
 * The two colours are the section's own, and they are the colours every page
 * after it inherits. The text colour is never picked: it follows from contrast,
 * like every other colour pair in Slaids.
 */

import type { ReactNode } from 'react'
import {
  PROGRESS_BAR_HEIGHT,
  SECTION_PILL_PADDING_X_EM,
  SECTION_PILL_PADDING_Y_EM,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { bestTextColor } from '../../domain/color'
import { computeSectionGeometry } from '../../domain/geometry'
import { cardShadow, sectionGeometryForTheme, themeMetrics } from '../../domain/metrics'
import { sectionColorsOf } from '../../domain/pages'
import { isDocEmpty } from '../../domain/richdoc'
import type { PresentationTheme, SectionSlide } from '../../domain/types'
import { PageColorsProvider, useSlideRender } from './SlideRenderContext'
import { RichDocView } from './RichDocView'
import { slideTokenStyle } from './SlideView'

export type SectionLine = 'title' | 'subtitle'

export const SECTION_LINES: readonly SectionLine[] = ['title', 'subtitle']

/** The document a line draws. */
export function sectionLineDoc(section: SectionSlide, line: SectionLine) {
  return line === 'title' ? section.title : section.subtitle
}

/** The two type sizes a section is set in, under a given theme. */
export function sectionFontSizes(theme: PresentationTheme): Record<SectionLine, number> {
  const metrics = themeMetrics(theme)
  return { title: metrics.titleFontSize, subtitle: metrics.sectionSubtitleFontSize }
}

/**
 * A section's frame: the page, the centred block, and one pill per line.
 *
 * The editor draws its own editable lines into the same frame, so what is being
 * typed sits in exactly the box that will be presented.
 */
export function SectionFrame({
  accentColor,
  backgroundColor,
  lines,
  renderLine,
  pillRef,
  testId = 'section-page',
  children,
}: {
  accentColor: string
  backgroundColor: string
  /** Which lines get a pill. A line with no text draws none when presented. */
  lines: readonly SectionLine[]
  renderLine: (line: SectionLine) => ReactNode
  /** The pill's own element — the box the editor measures its overflow against. */
  pillRef?: (line: SectionLine, element: HTMLElement | null) => void
  testId?: string
  children?: ReactNode
}) {
  const { theme } = useSlideRender()
  const options = sectionGeometryForTheme(theme)
  const geometry = computeSectionGeometry(options)
  const fontSizes = sectionFontSizes(theme)

  return (
    <PageColorsProvider colors={{ accent: accentColor, background: backgroundColor }}>
      <div
        className="slide section-page"
        data-testid={testId}
        style={{
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
          background: backgroundColor,
          gap: options.gap,
          // The page has no zone tree for the geometry engine to reserve the
          // indicator's strip in, so the one column it does have is kept clear
          // of it here instead — the same number `computeSectionGeometry`
          // subtracts, so the centred block and the measured area agree.
          paddingBottom: PROGRESS_BAR_HEIGHT,
          boxSizing: 'border-box',
          ...slideTokenStyle(theme, accentColor),
        }}
      >
        {lines.map((line) => (
          <div
            key={line}
            ref={(element) => pillRef?.(line, element)}
            className={`section-pill section-pill--${line}`}
            data-section-line={line}
            data-fit-scroll=""
            data-fit-axis="x"
            style={{
              background: accentColor,
              color: bestTextColor(accentColor),
              fontFamily: theme.headingFontFamily,
              fontSize: fontSizes[line],
              lineHeight: TITLE_LINE_HEIGHT,
              padding: `${SECTION_PILL_PADDING_Y_EM}em ${SECTION_PILL_PADDING_X_EM}em`,
              boxShadow: cardShadow(theme),
              // Border-box, so this less the pill's own padding is exactly the
              // width `computeSectionGeometry` hands the fit checker.
              maxWidth: geometry.areaRect.width,
            }}
          >
            {renderLine(line)}
          </div>
        ))}
        {children}
      </div>
    </PageColorsProvider>
  )
}

export function SectionPageView({ section }: { section: SectionSlide }) {
  // An empty line draws no pill: a coloured lozenge with nothing in it is not
  // content, and a section with no subheading should not look like it lost one.
  const lines = SECTION_LINES.filter((line) => !isDocEmpty(sectionLineDoc(section, line)))
  const colors = sectionColorsOf(section)

  return (
    <SectionFrame
      accentColor={colors.accent}
      backgroundColor={colors.background}
      lines={lines}
      renderLine={(line) => (
        <RichDocView doc={sectionLineDoc(section, line)} className="rich-doc--title" field="title" />
      )}
    />
  )
}
