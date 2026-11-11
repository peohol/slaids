/**
 * Renders a slide inside the fixed 1600x900 design space.
 *
 * Every box is positioned from `computeSlideGeometry`, which is why the editor,
 * the thumbnails, presentation mode and offscreen measurement can never drift
 * apart.
 *
 * A zone a person made smaller than its content needs at normal size is drawn
 * scaled down to fit (`ZoneFitBox`) — here, in presentation mode and in every
 * thumbnail alike, since all of them draw a slide through this component.
 */

import type { ReactNode } from 'react'
import {
  BODY_LINE_HEIGHT,
  CARD_RADIUS,
  DEFAULT_PILL_COLOR,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { computeSlideGeometry, type GeometryOptions } from '../../domain/geometry'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { collectLeaves } from '../../domain/layout'
import { bestTextColor, textShadowFor } from '../../domain/color'
import type { ContentSlide, LeafNode, PresentationTheme, Rect } from '../../domain/types'
import { PageColorsProvider, useSectionColorsFor, useSlideRender } from './SlideRenderContext'
import { RichDocView } from './RichDocView'
import { TitleFitLine } from './TitleFitLine'
import { ZoneContentView } from './ZoneContentView'
import { ZoneFitBox } from './ZoneFitBox'

/**
 * The governing section's accent, as the two custom properties a pill reads.
 *
 * A heading that was never given a colour stores none, so what it is painted
 * with is decided here rather than in the document — which is exactly what lets
 * one change on a section repaint every such heading in its part of the deck at
 * once, with no edit to any slide and nothing for undo to walk back through.
 */
export function pillTokenStyle(pillColor: string): React.CSSProperties {
  return {
    '--slaids-heading-pill': pillColor,
    '--slaids-heading-pill-text': bestTextColor(pillColor),
  } as React.CSSProperties
}

/**
 * Typography and spacing tokens exposed to CSS.
 *
 * `constants.ts` holds the base values and `metrics.ts` scales them by the
 * theme, so the stylesheet, the React styles and the headless estimator are all
 * reading the same numbers.
 */
export function slideTokenStyle(
  theme: PresentationTheme,
  pillColor: string = DEFAULT_PILL_COLOR,
): React.CSSProperties {
  const tokens = themeMetrics(theme)
  return {
    ...pillTokenStyle(pillColor),
    fontFamily: theme.bodyFontFamily,
    '--slaids-body-font-size': `${tokens.bodyFontSize}px`,
    '--slaids-body-line-height': String(BODY_LINE_HEIGHT),
    '--slaids-heading-font-size': `${tokens.headingFontSize}px`,
    '--slaids-card-header-font-size': `${tokens.cardHeaderFontSize}px`,
    '--slaids-card-radius': `${CARD_RADIUS}px`,
    '--slaids-card-padding': `${tokens.cardPadding}px`,
    '--slaids-block-spacing': `${tokens.blockSpacing}px`,
    '--slaids-paragraph-spacing': `${tokens.paragraphSpacing}px`,
    '--slaids-reference-gap': `${tokens.referenceEntryGap}px`,
    '--slaids-heading-spacing': `${tokens.headingSpacing}px`,
    '--slaids-list-indent': `${tokens.listIndent}px`,
    '--slaids-heading-font-family': theme.headingFontFamily,
  } as React.CSSProperties
}

export function absoluteStyle(rect: Rect): React.CSSProperties {
  return { position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }
}

export interface SlideViewProps {
  slide: ContentSlide
  geometryOptions?: GeometryOptions
  /** Editor hooks: replace how a leaf's content is rendered. */
  renderLeaf?: (leaf: LeafNode, rect: Rect) => ReactNode
  renderTitle?: (rect: Rect) => ReactNode
  /** Overlays drawn on top of the slide (zone editing chrome). */
  children?: ReactNode
  className?: string
}

export function SlideView({
  slide,
  geometryOptions,
  renderLeaf,
  renderTitle,
  children,
  className,
}: SlideViewProps) {
  const { theme } = useSlideRender()
  const colors = useSectionColorsFor(slide.id)
  const geometry = computeSlideGeometry(slide, {
    ...geometryForTheme(theme),
    ...geometryOptions,
  })
  const leaves = collectLeaves(slide.root)
  const titleColor = bestTextColor(colors.background)

  return (
    <PageColorsProvider colors={colors}>
    <div
      className={className ? `slide ${className}` : 'slide'}
      data-slide-id={slide.id}
      style={{
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        background: colors.background,
        ...slideTokenStyle(theme, colors.accent),
      }}
    >
      {geometry.titleRect &&
        (renderTitle ? (
          renderTitle(geometry.titleRect)
        ) : (
          <TitleFitLine
            className="slide-title"
            fontSize={themeMetrics(theme).titleFontSize}
            style={{
              ...absoluteStyle(geometry.titleRect),
              color: titleColor,
              fontFamily: theme.headingFontFamily,
              lineHeight: TITLE_LINE_HEIGHT,
              textShadow: textShadowFor(colors.background),
            }}
          >
            {slide.title && <RichDocView doc={slide.title} className="rich-doc--title" field="title" />}
          </TitleFitLine>
        ))}

      {leaves.map((leaf) => {
        const rect = geometry.rects.get(leaf.id)
        if (!rect) return null
        return (
          <div
            key={leaf.id}
            className="slide-zone"
            data-node-id={leaf.id}
            style={absoluteStyle(rect)}
          >
            {renderLeaf
              ? renderLeaf(leaf, rect)
              : leaf.content && (
                  <ZoneFitBox width={rect.width} height={rect.height}>
                    <ZoneContentView content={leaf.content} />
                  </ZoneFitBox>
                )}
          </div>
        )
      })}

      {children}
    </div>
    </PageColorsProvider>
  )
}
