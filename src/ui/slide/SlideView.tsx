/**
 * Renders a slide inside the fixed 1600x900 design space.
 *
 * Every box is positioned from `computeSlideGeometry`, which is why the editor,
 * the thumbnails, presentation mode and offscreen measurement can never drift
 * apart.
 */

import type { ReactNode } from 'react'
import {
  BODY_FONT_SIZE,
  BODY_LINE_HEIGHT,
  CARD_HEADER_FONT_SIZE,
  CARD_PADDING,
  CARD_RADIUS,
  HEADING_FONT_SIZE,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_FONT_SIZE,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { computeSlideGeometry, type GeometryOptions } from '../../domain/geometry'
import { collectLeaves } from '../../domain/layout'
import { bestTextColor, textShadowFor } from '../../domain/color'
import type { LeafNode, PresentationTheme, Rect, Slide } from '../../domain/types'
import { useSlideRender } from './SlideRenderContext'
import { RichDocView } from './RichDocView'
import { ZoneContentView } from './ZoneContentView'

/** Typography tokens exposed to CSS. Kept here so `constants.ts` stays the source. */
export function slideTokenStyle(theme: PresentationTheme): React.CSSProperties {
  return {
    fontFamily: theme.bodyFontFamily,
    '--slaids-body-font-size': `${BODY_FONT_SIZE}px`,
    '--slaids-body-line-height': String(BODY_LINE_HEIGHT),
    '--slaids-heading-font-size': `${HEADING_FONT_SIZE}px`,
    '--slaids-card-header-font-size': `${CARD_HEADER_FONT_SIZE}px`,
    '--slaids-card-radius': `${CARD_RADIUS}px`,
    '--slaids-card-padding': `${CARD_PADDING}px`,
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
  const geometry = computeSlideGeometry(slide, geometryOptions)
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
              fontSize: TITLE_FONT_SIZE,
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
