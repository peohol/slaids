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
import {
  estimateFit,
  estimateTitleFit,
  fitResult,
  type ContentFitChecker,
  type FitContext,
  type FitResult,
  type TitleFitChecker,
} from '../domain/fit'
import { fitContextFor, slideOverflow, type StructuralOptions } from '../domain/commands'
import { FIT_TOLERANCE, TITLE_LINE_HEIGHT } from '../domain/constants'
import { themeMetrics } from '../domain/metrics'
import type { Presentation, Rect, TitleDoc, ZoneContent } from '../domain/types'
import { SlideRenderProvider } from '../ui/slide/SlideRenderContext'
import { ZoneContentView } from '../ui/slide/ZoneContentView'
import { RichDocView } from '../ui/slide/RichDocView'
import { slideTokenStyle } from '../ui/slide/SlideView'

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

/**
 * Measure whether content fits a rect, using the real renderer.
 *
 * The render context is the caller's, not an empty one: a citation renders the
 * number it will actually show, so the offscreen copy is the same pixels as the
 * slide. Measuring with an empty numbering would silently drop every citation
 * pill from the measurement — the label is derived, so no numbering means no
 * label at all.
 */
export function measureContentFit(
  content: ZoneContent,
  rect: Rect,
  context: FitContext,
): FitResult {
  if (typeof document === 'undefined') return estimateFit(content, rect, context)
  if (rect.width <= 0 || rect.height <= 0) return { fits: false, overflow: Number.MAX_SAFE_INTEGER }
  const { theme } = context

  const overflow = withHost(
    rect,
    () => (
      <SlideRenderProvider value={{ theme, numbering: context.numbering, isStatic: true }}>
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
  return fitResult(overflow)
}

/**
 * A slide title is one line at a fixed size. It fits only if the text it draws
 * is no wider than the zone.
 *
 * Measured as a natural width rather than as scroll overflow: `.slide-title`
 * clips its own content and so does the visible stage, and asking a clipping
 * box how much stuck out is exactly the question it exists not to answer. So
 * the same markup is laid out at `max-content` — its width is then the width
 * the title wants — and compared against the width it will get.
 */
export function measureTitleFit(
  doc: TitleDoc,
  titleRect: Rect,
  context: FitContext,
): FitResult {
  if (typeof document === 'undefined') return estimateTitleFit(doc, titleRect, context)
  const { theme } = context
  const fontSize = themeMetrics(theme).titleFontSize
  const height = fontSize * TITLE_LINE_HEIGHT
  const needed = withHost(
    { x: 0, y: 0, width: titleRect.width, height },
    () => (
      <SlideRenderProvider value={{ theme, numbering: context.numbering, isStatic: true }}>
        <div
          className="slide-title"
          data-measure-title=""
          style={{
            ...slideTokenStyle(theme),
            width: 'max-content',
            height,
            fontFamily: theme.headingFontFamily,
            fontSize,
            lineHeight: TITLE_LINE_HEIGHT,
          }}
        >
          <RichDocView doc={doc} className="rich-doc--title" />
        </div>
      </SlideRenderProvider>
    ),
    (element) => {
      const title = element.querySelector<HTMLElement>('[data-measure-title]')
      return title ? title.getBoundingClientRect().width : 0
    },
  )
  return fitResult(needed - titleRect.width)
}

/**
 * The checkers every editor command is given.
 *
 * One bundle rather than two loose arguments, so no call site can validate zone
 * content but silently skip slide titles. The domain commands close over
 * nothing: they are handed the prospective render context at call time, which
 * is what lets a font change or a renumbering be validated before it is
 * committed.
 */
export const domFitCheckers: Required<Pick<StructuralOptions, 'fits' | 'fitsTitle'>> = {
  fits: measureContentFit satisfies ContentFitChecker,
  fitsTitle: measureTitleFit satisfies TitleFitChecker,
}

/**
 * How many zones in the whole deck currently overflow, measured for real.
 *
 * This is the after-the-fact half of the fit rule: commands refuse changes that
 * would hide content, but some things — a web font swapping in, an image
 * finishing its download, a document written before the rule existed — are not
 * commands at all. One offscreen render per zone, so it is used deliberately
 * rather than on every keystroke.
 */
export function overflowingZoneCount(presentation: Presentation): number {
  const context = fitContextFor(presentation)
  let count = 0
  for (const slide of presentation.slides) {
    for (const overflow of slideOverflow(slide, context, domFitCheckers).values()) {
      if (overflow > FIT_TOLERANCE) count += 1
    }
  }
  return count
}
