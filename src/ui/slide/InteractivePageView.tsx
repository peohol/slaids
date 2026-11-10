/**
 * An interactive slide, inactive: the cover.
 *
 * This is what the deck draws for the slide everywhere — thumbnails, the
 * editor's stage, presentation mode before activation, the shared view, the
 * rendered preview and any export. It is static markup in the deck's own
 * design: the governing section's colours, the app's name in the theme's
 * heading type, and one green play button under it.
 *
 * Deliberately almost nothing else. A cover is what an audience looks at while
 * somebody decides to start the app, so it says the one thing they need — what
 * this is called — and offers the one thing they can do. The file name is the
 * author's business and lives in the inspector; a badge explaining that an
 * interactive slide is interactive is a label on a play button.
 *
 * The button is a real `<button>` only where an activation has been provided
 * (see `InteractiveActivation`). Everywhere else it is the same shape drawn
 * inert, so a thumbnail, a server render or an export shows a recognisable
 * cover and can never start code. Nothing of the app itself — not a byte of
 * its markup — is drawn here.
 */

import {
  CARD_RADIUS,
  PROGRESS_BAR_HEIGHT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { bestTextColor, textShadowFor } from '../../domain/color'
import { cardShadow, geometryForTheme, themeMetrics } from '../../domain/metrics'
import type { InteractiveSlide } from '../../domain/types'
import {
  ACTIVATE_BUTTON_ATTRIBUTE,
  useInteractiveActivation,
} from '../interactive/InteractiveActivation'
import { PageColorsProvider, useSectionColorsFor, useSlideRender } from './SlideRenderContext'
import { slideTokenStyle } from './SlideView'

export const ACTIVATE_LABEL = 'Aktiver miniapp'

/**
 * The play button's green, and why it is not the theme's accent.
 *
 * Every other colour on this page is the section's, because the cover belongs
 * to the deck. The button does not: it is a control, and «press this to start»
 * is one of the few places where a colour means something to an audience
 * before they have read anything. A section whose accent happens to be red
 * would otherwise get a red play button.
 */
const PLAY_GREEN = '#1f9d55'

/** Design-space pixels. Square, and large enough to be an obvious target. */
const PLAY_SIZE = 120

export function InteractivePageView({ slide }: { slide: InteractiveSlide }) {
  const { theme } = useSlideRender()
  const colors = useSectionColorsFor(slide.id)
  const activation = useInteractiveActivation()
  const metrics = themeMetrics(theme)
  const gap = geometryForTheme(theme).gap
  const foreground = bestTextColor(colors.background)
  const shadow = textShadowFor(colors.background)
  const buttonStyle: React.CSSProperties = {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    background: PLAY_GREEN,
    color: bestTextColor(PLAY_GREEN),
    borderRadius: CARD_RADIUS,
    boxShadow: cardShadow(theme),
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
            aria-label={ACTIVATE_LABEL}
            {...{ [ACTIVATE_BUTTON_ATTRIBUTE]: '' }}
            style={buttonStyle}
            onClick={(event) => {
              // The click is the button's, never the page's: on a surface that
              // turns pages on a click, this one must not also turn a page.
              event.stopPropagation()
              activation.activate()
            }}
          >
            <PlayIcon />
          </button>
        ) : (
          <span
            className="interactive-page__activate interactive-page__activate--inert"
            data-testid="activate-interactive-inert"
            aria-hidden="true"
            style={buttonStyle}
          >
            <PlayIcon />
          </span>
        )}
      </div>
    </PageColorsProvider>
  )
}

/**
 * The play triangle, drawn rather than typed.
 *
 * Inline SVG and not a glyph: this cover is drawn by a headless Chromium for
 * previews and exports as well as by the audience's browser, and a font
 * character would be at the mercy of what each of them has installed. The
 * triangle is optically centred — a shape with a flat left edge and a point on
 * the right reads as off-centre when its bounding box is centred.
 */
function PlayIcon() {
  return (
    <svg
      viewBox="0 0 100 100"
      width={PLAY_SIZE / 2}
      height={PLAY_SIZE / 2}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M32 20 L82 50 L32 80 Z" fill="currentColor" />
    </svg>
  )
}
