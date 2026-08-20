/**
 * Browser content measurement.
 *
 * `canFit` is answered by rendering the real component offscreen at the exact
 * target size and asking the layout engine whether anything overflowed. Because
 * the offscreen render uses the same components and the same typography tokens
 * as the visible slide, the answer matches what the user will actually see.
 *
 * Outside a browser (unit tests, future server-side validation) the pure
 * estimator in `domain/fit.ts` is used instead.
 */

import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { estimateFit, type ContentFitChecker, type FitResult } from '../domain/fit'
import {
  SLIDE_WIDTH,
  TITLE_FONT_SIZE,
  TITLE_LINE_HEIGHT,
  SLIDE_INSET,
} from '../domain/constants'
import type { PresentationTheme, Rect, RichDoc, ZoneContent } from '../domain/types'
import { SlideRenderProvider } from '../ui/slide/SlideRenderContext'
import { ZoneContentView } from '../ui/slide/ZoneContentView'
import { RichDocView } from '../ui/slide/RichDocView'
import { slideTokenStyle } from '../ui/slide/SlideView'

const OVERFLOW_TOLERANCE = 0.75

let host: HTMLDivElement | null = null
let root: Root | null = null

function ensureHost(): { host: HTMLDivElement; root: Root } {
  if (host && root) return { host, root }
  host = document.createElement('div')
  host.setAttribute('data-slaids-measure', '')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  host.style.zIndex = '-1'
  host.style.contain = 'layout style'
  document.body.appendChild(host)
  root = createRoot(host)
  return { host, root }
}

/** Largest overflow, in logical pixels, across every clipped region inside `element`. */
export function measureElementOverflow(element: HTMLElement): number {
  let worst = 0
  const targets = element.querySelectorAll<HTMLElement>('[data-fit-scroll]')
  for (const target of targets) {
    worst = Math.max(
      worst,
      target.scrollHeight - target.clientHeight,
      target.scrollWidth - target.clientWidth,
    )
  }
  return worst
}

function withHost<T>(rect: Rect, render: () => React.ReactNode, read: (host: HTMLElement) => T): T {
  const { host: element, root: reactRoot } = ensureHost()
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
  flushSync(() => reactRoot.render(render()))
  try {
    return read(element)
  } finally {
    flushSync(() => reactRoot.render(null))
  }
}

/** Measure whether content fits a rect, using the real renderer. */
export function measureContentFit(
  content: ZoneContent,
  rect: Rect,
  theme: PresentationTheme,
): FitResult {
  if (typeof document === 'undefined') return estimateFit(content, rect)
  if (rect.width <= 0 || rect.height <= 0) return { fits: false, overflow: Number.MAX_SAFE_INTEGER }

  const overflow = withHost(
    rect,
    () => (
      <SlideRenderProvider value={{ theme, numbering: new Map(), isStatic: true }}>
        <div
          className="slide-zone"
          style={{ ...slideTokenStyle(theme), width: rect.width, height: rect.height }}
        >
          <ZoneContentView content={content} />
        </div>
      </SlideRenderProvider>
    ),
    measureElementOverflow,
  )
  const rounded = Math.max(0, Math.round(overflow * 100) / 100)
  return { fits: rounded <= OVERFLOW_TOLERANCE, overflow: rounded }
}

/**
 * A slide title is one line at a fixed size. It fits only if it does not need
 * to scroll horizontally.
 */
export function measureTitleFit(doc: RichDoc, theme: PresentationTheme, width?: number): FitResult {
  if (typeof document === 'undefined') {
    return estimateFit(
      { id: 'title', kind: 'container', payload: { type: 'richdoc', doc } },
      { x: 0, y: 0, width: width ?? SLIDE_WIDTH - SLIDE_INSET * 2, height: 1000 },
    )
  }
  const rect: Rect = {
    x: 0,
    y: 0,
    width: width ?? SLIDE_WIDTH - SLIDE_INSET * 2,
    height: TITLE_FONT_SIZE * TITLE_LINE_HEIGHT,
  }
  const overflow = withHost(
    rect,
    () => (
      <SlideRenderProvider value={{ theme, numbering: new Map(), isStatic: true }}>
        <div
          className="slide-title"
          data-fit-scroll=""
          style={{
            ...slideTokenStyle(theme),
            width: rect.width,
            height: rect.height,
            fontFamily: theme.headingFontFamily,
            fontSize: TITLE_FONT_SIZE,
            lineHeight: TITLE_LINE_HEIGHT,
          }}
        >
          <RichDocView doc={doc} className="rich-doc--title" />
        </div>
      </SlideRenderProvider>
    ),
    (element) => Math.max(0, element.scrollWidth - element.clientWidth),
  )
  return { fits: overflow <= OVERFLOW_TOLERANCE, overflow }
}

/** Fit checker bound to a theme, for passing into domain commands. */
export function fitCheckerFor(theme: PresentationTheme): ContentFitChecker {
  return (content, rect) => measureContentFit(content, rect, theme)
}

export function disposeMeasurementHost(): void {
  if (root) root.unmount()
  if (host?.parentNode) host.parentNode.removeChild(host)
  root = null
  host = null
}
