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
 *
 * The one render-context field that is *not* the caller's is the deck's heading
 * pill colour: a colour changes no glyph's width, so the offscreen copy is
 * measured with the default one and the box it lands in is the same box.
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
import { nodeIdOfKey } from '../domain/commands/fitGuard'
import { fitContextFor, pageOverflow, type StructuralOptions } from '../domain/commands'
import { FIT_TOLERANCE, TITLE_LINE_HEIGHT } from '../domain/constants'
import { themeMetrics } from '../domain/metrics'
import type { Presentation, Rect, TitleDoc, ZoneContent } from '../domain/types'
import { AssetSourceProvider } from './assetSource'
import { repositoryAssetSource } from './assetSources'
import { SlideRenderProvider } from '../ui/slide/SlideRenderContext'
import { ZoneContentView } from '../ui/slide/ZoneContentView'
import { RichDocView } from '../ui/slide/RichDocView'
import { slideTokenStyle } from '../ui/slide/SlideView'
import { measureOverflowParts } from '../ui/slide/overflowParts'

export { measureElementOverflow, measureOverflowParts } from '../ui/slide/overflowParts'

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

function withHost<T>(rect: Rect, render: () => React.ReactNode, read: (host: HTMLElement) => T): T {
  const { host: element, root: reactRoot } = ensureHost()
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
  // The measuring root is detached from the app's, so it has to name its own
  // asset source. It is the owner's own files: an inline picture is measured as
  // the `<img>` it will be, not as the placeholder an unresolved one draws —
  // and those are different heights.
  flushSync(() =>
    reactRoot.render(
      <AssetSourceProvider value={repositoryAssetSource}>{render()}</AssetSourceProvider>,
    ),
  )
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
  // Nothing can be laid out in a rect of no size, so nothing is rendered into
  // one: the estimator answers with every part of this content failing at once,
  // which is the same shape a real measurement would have had.
  if (rect.width <= 0 || rect.height <= 0) return estimateFit(content, rect, context)
  const { theme } = context

  const parts = withHost(
    rect,
    () => (
      <SlideRenderProvider
        value={{
          theme,
          numbering: context.numbering,
          // A zone is measured on its own, not as a page of a deck: there is
          // no section above it whose colours apply and no progress to draw,
          // and the room the indicator takes was already subtracted from the
          // rect this content is being measured against. Colour is never
          // fit-relevant, so the defaults measure the same as any other pair.
          sectionColors: new Map(),
          progress: new Map(),
          isStatic: true,
        }}
      >
        <div
          className="slide-zone"
          style={{ ...slideTokenStyle(theme), width: rect.width, height: rect.height }}
        >
          <ZoneContentView content={content} />
        </div>
      </SlideRenderProvider>
    ),
    measureOverflowParts,
  )
  return fitResult(parts)
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
  size?: number,
): FitResult {
  if (typeof document === 'undefined') return estimateTitleFit(doc, titleRect, context, size)
  const { theme } = context
  const fontSize = size ?? themeMetrics(theme).titleFontSize
  const height = fontSize * TITLE_LINE_HEIGHT
  const needed = withHost(
    { x: 0, y: 0, width: titleRect.width, height },
    () => (
      <SlideRenderProvider
        value={{
          theme,
          numbering: context.numbering,
          // A zone is measured on its own, not as a page of a deck: there is
          // no section above it whose colours apply and no progress to draw,
          // and the room the indicator takes was already subtracted from the
          // rect this content is being measured against. Colour is never
          // fit-relevant, so the defaults measure the same as any other pair.
          sectionColors: new Map(),
          progress: new Map(),
          isStatic: true,
        }}
      >
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
          <RichDocView doc={doc} className="rich-doc--title" field="title" />
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
 * How many places in the whole deck currently clip their content, measured for
 * real: every zone, every slide title, and both lines of every section.
 *
 * This is the after-the-fact half of the fit rule: commands refuse changes that
 * would hide content, but some things — a web font swapping in, an image
 * finishing its download, a document written before the rule existed — are not
 * commands at all. Sections are in the count for exactly that reason: a font
 * that arrives wider than the one it replaced clips a section heading the same
 * way it clips a slide title. One offscreen render per place, so this is used
 * deliberately rather than on every keystroke.
 */
export function overflowingCount(presentation: Presentation): number {
  const context = fitContextFor(presentation)
  const places = new Set<string>()
  for (const slide of presentation.slides) {
    // Which kind is measured how is `pageOverflow`'s decision, not this file's.
    for (const [key, overflow] of pageOverflow(slide, context, domFitCheckers)) {
      // Counted per *zone* rather than per region: what the status bar offers
      // is somewhere to go and look, and a card whose header and body are both
      // full is one place to look, not two.
      if (overflow > FIT_TOLERANCE) places.add(`${slide.id}:${nodeIdOfKey(key)}`)
    }
  }
  return places.size
}
