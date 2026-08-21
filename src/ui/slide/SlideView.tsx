/**
 * Renders a slide inside the fixed 1600x900 design space.
 *
 * Every box is positioned from `computeSlideGeometry`, which is why the editor,
 * the thumbnails, presentation mode and offscreen measurement can never drift
 * apart.
 */

import type { ReactNode } from 'react'
import {
  BODY_LINE_HEIGHT,
  CARD_RADIUS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { computeSlideGeometry, type GeometryOptions } from '../../domain/geometry'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { collectLeaves } from '../../domain/layout'
import { bestTextColor, textShadowFor } from '../../domain/color'
import type { LeafNode, PresentationTheme, Rect, Slide } from '../../domain/types'
import { useSlideRender } from './SlideRenderContext'
import { RichDocView } from './RichDocView'
import { ZoneContentView } from './ZoneContentView'

/**
 * Typography and spacing tokens exposed to CSS.
 *
 * `constants.ts` holds the base values and `metrics.ts` scales them by the
 * theme, so the stylesheet, the React styles and the headless estimator are all
 * reading the same numbers.
 */
export function slideTokenStyle(theme: PresentationTheme): React.CSSProperties {
  const tokens = themeMetrics(theme)
  return {
    fontFamily: theme.bodyFontFamily,
    '--slaids-body-font-size': `${tokens.bodyFontSize}px`,
    '--slaids-body-line-height': String(BODY_LINE_HEIGHT),
    '--slaids-heading-font-size': `${tokens.headingFontSize}px`,
    '--slaids-card-header-font-size': `${tokens.cardHeaderFontSize}px`,
    '--slaids-card-radius': `${CARD_RADIUS}px`,
    '--slaids-card-padding': `${tokens.cardPadding}px`,
    '--slaids-block-spacing': `${tokens.blockSpacing}px`,
    '--slaids-heading-spacing': `${tokens.headingSpacing}px`,
    '--slaids-list-indent': `${tokens.listIndent}px`,
    '--slaids-heading-font-family': theme.headingFontFamily,
  } as React.CSSProperties
}

export function absoluteStyle(rect: Rect): React.CSSProperties {
  return { position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }
}

export interface SlideViewProps {
  slide: Slide
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
  const geometry = computeSlideGeometry(slide, {
    ...geometryForTheme(theme),
    ...geometryOptions,
  })
  const leaves = collectLeaves(slide.root)
  const titleColor = bestTextColor(theme.backgroundColor)

  return (
    <div
      className={className ? `slide ${className}` : 'slide'}
      data-slide-id={slide.id}
      style={{
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        background: theme.backgroundColor,
        ...slideTokenStyle(theme),
      }}
    >
      {geometry.titleRect &&
        (renderTitle ? (
          renderTitle(geometry.titleRect)
        ) : (
          <div
            className="slide-title"
            style={{
              ...absoluteStyle(geometry.titleRect),
              color: titleColor,
              fontFamily: theme.headingFontFamily,
              fontSize: themeMetrics(theme).titleFontSize,
              lineHeight: TITLE_LINE_HEIGHT,
              textShadow: textShadowFor(theme.backgroundColor),
            }}
          >
            {slide.title && <RichDocView doc={slide.title} className="rich-doc--title" />}
          </div>
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
            {renderLeaf ? renderLeaf(leaf, rect) : leaf.content && <ZoneContentView content={leaf.content} />}
          </div>
        )
      })}

      {children}
    </div>
  )
}
