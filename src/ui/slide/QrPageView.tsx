/**
 * The derived QR page.
 *
 * It is the last page of a shared deck and exists only while sharing is on. It
 * is not a slide: there is no zone tree behind it, nothing stores it, and no
 * command can reach it — which is exactly why it cannot be deleted, moved,
 * duplicated or edited.
 *
 * It still lives in the same 1600 × 900 design space as every slide, painted
 * with the deck's own background, fonts and spacing, so it does not arrive
 * looking like it came from somewhere else.
 */

import { QRCodeSVG } from 'qrcode.react'
import {
  PROGRESS_BAR_HEIGHT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { bestTextColor, textShadowFor } from '../../domain/color'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { useSlideRender } from './SlideRenderContext'
import { slideTokenStyle } from './SlideView'

/** Big enough to scan across a room, small enough to leave the page airy. */
const QR_SIZE = 380
/** The quiet zone a scanner needs, drawn as the card's padding. */
const QR_PADDING = 28

export function QrPageView({ url }: { url: string }) {
  const { theme } = useSlideRender()
  const metrics = themeMetrics(theme)
  const gap = geometryForTheme(theme).gap
  const foreground = bestTextColor(theme.backgroundColor)

  return (
    <div
      className="slide qr-page"
      data-testid="qr-page"
      style={{
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        background: theme.backgroundColor,
        gap,
        // The page has no zone tree for the geometry engine to reserve the
        // indicator's strip in, so the one column it does have is kept clear of
        // it here instead. The indicator itself is `DeckPageView`'s.
        paddingBottom: PROGRESS_BAR_HEIGHT,
        boxSizing: 'border-box',
        ...slideTokenStyle(theme),
      }}
    >
      <p
        className="qr-page__heading"
        style={{
          color: foreground,
          fontFamily: theme.headingFontFamily,
          fontSize: metrics.titleFontSize,
          lineHeight: TITLE_LINE_HEIGHT,
          textShadow: textShadowFor(theme.backgroundColor),
        }}
      >
        Se presentasjonen
      </p>

      {/*
        Always dark-on-white inside its own card, whatever the theme is. A QR
        code drawn in theme colours is a QR code that may not scan.
      */}
      <div className="qr-page__code" style={{ padding: QR_PADDING }}>
        <QRCodeSVG value={url} size={QR_SIZE} level="M" marginSize={0} />
      </div>

      <p
        className="qr-page__url"
        style={{
          color: foreground,
          fontSize: metrics.bodyFontSize,
          textShadow: textShadowFor(theme.backgroundColor),
        }}
      >
        {url}
      </p>
    </div>
  )
}
