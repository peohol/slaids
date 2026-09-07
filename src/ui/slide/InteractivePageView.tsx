/**
 * An interactive slide, inactive: the cover.
 *
 * This is what the deck draws for the slide everywhere — thumbnails, the
 * editor's stage, presentation mode before activation, the shared view, the
 * rendered preview and any export. It is static markup in the deck's own
 * design: the governing section's colours, the theme's type, one pill saying
 * what this is, the app's name, and the button that would start it.
 *
 * The button is a real `<button>` only where an activation has been provided
 * (see `InteractiveActivation`). Everywhere else it is the same shape drawn
 * inert, so a thumbnail, a server render or an export shows a recognisable
 * cover and can never start code. Nothing of the app itself — not a byte of
 * its markup — is drawn here.
 */

import {
  CARD_SHADOW,
  PROGRESS_BAR_HEIGHT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { bestTextColor, textShadowFor } from '../../domain/color'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import type { InteractiveSlide } from '../../domain/types'
import {
  ACTIVATE_BUTTON_ATTRIBUTE,
  useInteractiveActivation,
} from '../interactive/InteractiveActivation'
import { PageColorsProvider, useSectionColorsFor, useSlideRender } from './SlideRenderContext'
import { slideTokenStyle } from './SlideView'

export const ACTIVATE_LABEL = 'Aktiver miniapp'
export const INTERACTIVE_BADGE = 'Interaktiv miniapp'

export function InteractivePageView({ slide }: { slide: InteractiveSlide }) {
  const { theme } = useSlideRender()
  const colors = useSectionColorsFor(slide.id)
  const activation = useInteractiveActivation()
  const metrics = themeMetrics(theme)
  const gap = geometryForTheme(theme).gap
  const foreground = bestTextColor(colors.background)
  const shadow = textShadowFor(colors.background)
  const buttonStyle: React.CSSProperties = {
    background: colors.accent,
    color: bestTextColor(colors.accent),
    fontFamily: theme.headingFontFamily,
    fontSize: metrics.sectionSubtitleFontSize,
    lineHeight: TITLE_LINE_HEIGHT,
    boxShadow: CARD_SHADOW,
  }

  return (
    <PageColorsProvider colors={colors}>
      <div
        className="slide interactive-page"
        data-testid="interactive-page"
        data-slide-id={slide.id}
        style={{
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
          background: colors.background,
          gap,
          // The page has no zone tree for the geometry engine to reserve the
          // indicator's strip in, so the column is kept clear of it here — the
          // same number a section and the QR page subtract.
          paddingBottom: PROGRESS_BAR_HEIGHT,
          boxSizing: 'border-box',
          ...slideTokenStyle(theme, colors.accent),
        }}
      >
        <span
          className="interactive-page__badge"
          style={{
            background: colors.accent,
            color: bestTextColor(colors.accent),
            fontSize: metrics.bodyFontSize,
          }}
        >
          {INTERACTIVE_BADGE}
        </span>
        <h1
          className="interactive-page__name"
          data-testid="interactive-name"
          style={{
            color: foreground,
            fontFamily: theme.headingFontFamily,
            fontSize: metrics.titleFontSize,
            lineHeight: TITLE_LINE_HEIGHT,
            textShadow: shadow,
          }}
        >
          {slide.name}
        </h1>
        {activation ? (
          <button
            type="button"
            className="interactive-page__activate"
            data-testid="activate-interactive"
            {...{ [ACTIVATE_BUTTON_ATTRIBUTE]: '' }}
            style={buttonStyle}
            onClick={(event) => {
              // The click is the button's, never the page's: on a surface that
              // turns pages on a click, this one must not also turn a page.
              event.stopPropagation()
              activation.activate()
            }}
          >
            {ACTIVATE_LABEL}
          </button>
        ) : (
          <span
            className="interactive-page__activate interactive-page__activate--inert"
            data-testid="activate-interactive-inert"
            aria-hidden="true"
            style={buttonStyle}
          >
            {ACTIVATE_LABEL}
          </span>
        )}
        <span
          className="interactive-page__file"
          style={{ color: foreground, fontSize: metrics.bodyFontSize, textShadow: shadow }}
        >
          {slide.fileName}
        </span>
      </div>
    </PageColorsProvider>
  )
}
