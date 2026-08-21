/**
 * Content fit.
 *
 * `canFit(content, rect, theme)` answers whether content is fully visible inside
 * a rect. Two implementations exist:
 *
 *  - `estimateFit` (here): pure, deterministic, no DOM. Used by unit tests and
 *    as a fallback when no browser measurement is available.
 *  - `DomContentMeasurer` (ui layer): renders the real component offscreen with
 *    identical typography and measures it. Used in the app.
 *
 * The theme is an argument rather than something a checker closes over, because
 * a global font change has to be validated against the *prospective* theme —
 * see `commands/fitGuard.ts`.
 *
 * Domain commands take a `ContentFitChecker` so the domain layer stays headless.
 */

import {
  BODY_FONT_SIZE,
  BODY_LINE_HEIGHT,
  CARD_HEADER_FONT_SIZE,
  CARD_HEADER_HEIGHT,
  CARD_PADDING,
  FIT_TOLERANCE,
  HEADING_FONT_SIZE,
  SUBFIELD_GAP,
  TITLE_FONT_SIZE,
} from './constants'
import { advanceRatioFor, DEFAULT_ADVANCE_RATIO } from './fonts'
import type {
  CardBody,
  PresentationTheme,
  Rect,
  RichDoc,
  RichNode,
  TitleDoc,
  ZoneContent,
} from './types'

export interface FitResult {
  fits: boolean
  /** How many logical pixels of content did not fit (0 when it fits). */
  overflow: number
}

export type ContentFitChecker = (
  content: ZoneContent,
  rect: Rect,
  theme: PresentationTheme,
) => FitResult

/** The slide title zone is one line of heading type, so it fails horizontally. */
export type TitleFitChecker = (doc: TitleDoc, rect: Rect, theme: PresentationTheme) => FitResult

/** Normalise a raw overflow measurement into a `FitResult`. */
export function fitResult(overflow: number): FitResult {
  const rounded = Math.max(0, Math.round(overflow * 100) / 100)
  return { fits: rounded <= FIT_TOLERANCE, overflow: rounded }
}

/**
 * Theme fields that can change how much space content needs.
 *
 * Colours cannot, so a background change must not trigger a full re-measure of
 * the deck.
 */
export function sameFitRelevantTheme(a: PresentationTheme, b: PresentationTheme): boolean {
  return a.headingFontFamily === b.headingFontFamily && a.bodyFontFamily === b.bodyFontFamily
}

/* ------------------------------------------------------------------ *
 * Deterministic estimation
 * ------------------------------------------------------------------ */

const LIST_INDENT = 24
const BLOCK_SPACING = 6

/** Average glyph advances for the fonts a theme selects. */
interface FitMetrics {
  body: number
  heading: number
}

const DEFAULT_METRICS: FitMetrics = {
  body: DEFAULT_ADVANCE_RATIO,
  heading: DEFAULT_ADVANCE_RATIO,
}

function metricsFor(theme?: PresentationTheme): FitMetrics {
  if (!theme) return DEFAULT_METRICS
  return {
    body: advanceRatioFor(theme.bodyFontFamily),
    heading: advanceRatioFor(theme.headingFontFamily),
  }
}

function charsPerLine(width: number, fontSize: number, advance: number): number {
  return Math.max(1, Math.floor(width / (fontSize * advance)))
}

function estimateNodeHeight(node: RichNode, width: number, metrics: FitMetrics): number {
  switch (node.type) {
    case 'heading': {
      const chars = countChars(node)
      const lines = Math.ceil(chars / charsPerLine(width, HEADING_FONT_SIZE, metrics.heading)) || 1
      return lines * HEADING_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING
    }
    case 'paragraph': {
      const chars = countChars(node)
      const lines = Math.ceil(chars / charsPerLine(width, BODY_FONT_SIZE, metrics.body)) || 1
      return lines * BODY_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING
    }
    case 'blockquote': {
      const inner = (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width - LIST_INDENT, metrics),
        0,
      )
      return inner + BLOCK_SPACING * 2
    }
    case 'bulletList':
    case 'orderedList': {
      return (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width - LIST_INDENT, metrics),
        0,
      )
    }
    case 'listItem': {
      return (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width, metrics),
        0,
      )
    }
    case 'codeBlock': {
      const chars = countChars(node)
      const lines = Math.ceil(chars / charsPerLine(width, BODY_FONT_SIZE, metrics.body)) || 1
      return lines * BODY_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING * 2
    }
    case 'slaidsImage': {
      const percent = Number(node.attrs?.widthPercent)
      const share = Number.isFinite(percent) && percent > 0 ? percent / 100 : 1
      // Assume a 4:3 figure; the browser measurer refines this in the app.
      return (width * share * 3) / 4 + BLOCK_SPACING
    }
    case 'slaidsShape': {
      const height = Number(node.attrs?.height)
      return (Number.isFinite(height) && height > 0 ? height : 160) + BLOCK_SPACING
    }
    case 'table': {
      const rows = node.content?.length ?? 0
      return rows * (BODY_FONT_SIZE * BODY_LINE_HEIGHT + 12) + BLOCK_SPACING
    }
    default:
      return 0
  }
}

function countChars(node: RichNode): number {
  let count = 0
  const go = (current: RichNode): void => {
    if (current.type === 'text' && current.text) count += current.text.length
    if (current.type === 'citation') count += 4
    if (current.content) for (const child of current.content) go(child)
  }
  go(node)
  return count
}

function countDocChars(doc: RichDoc): number {
  return (doc.content ?? []).reduce((total, node) => total + countChars(node), 0)
}

export function estimateDocHeight(doc: RichDoc, width: number, theme?: PresentationTheme): number {
  if (width <= 0) return Number.POSITIVE_INFINITY
  const metrics = metricsFor(theme)
  return (doc.content ?? []).reduce(
    (total, node) => total + estimateNodeHeight(node, width, metrics),
    0,
  )
}

function estimateBodyOverflow(body: CardBody, area: Rect, theme?: PresentationTheme): number {
  const count = body.subfields.length
  const total = body.weights.reduce((sum, w) => sum + w, 0) || count
  const along = body.axis === 'x' ? area.width : area.height
  const usable = along - SUBFIELD_GAP * (count - 1)
  let worst = 0
  for (let i = 0; i < count; i += 1) {
    const share = (usable * body.weights[i]) / total
    const width = body.axis === 'x' ? share : area.width
    const height = body.axis === 'x' ? area.height : share
    const needed = estimateDocHeight(body.subfields[i].doc, width, theme)
    worst = Math.max(worst, needed - height)
  }
  return worst
}

/**
 * A card title is one line inside a fixed-height header, so it overflows
 * sideways. The DOM measurer sees this through the header's `data-fit-scroll`;
 * the estimator has to model it explicitly.
 */
function estimateHeaderOverflow(title: TitleDoc, rect: Rect, theme?: PresentationTheme): number {
  const available = rect.width - CARD_PADDING * 2
  if (available <= 0) return Number.MAX_SAFE_INTEGER
  const needed = countDocChars(title) * CARD_HEADER_FONT_SIZE * metricsFor(theme).heading
  return needed - available
}

/** Pure estimate of whether content fits. Deliberately slightly conservative. */
export function estimateFit(
  content: ZoneContent,
  rect: Rect,
  theme?: PresentationTheme,
): FitResult {
  if (rect.width <= 0 || rect.height <= 0) return { fits: false, overflow: Number.MAX_SAFE_INTEGER }

  let overflow = 0
  switch (content.kind) {
    case 'container': {
      if (content.payload.type === 'richdoc') {
        overflow = estimateDocHeight(content.payload.doc, rect.width, theme) - rect.height
      }
      break
    }
    case 'untitled-card': {
      const inner = {
        x: rect.x + CARD_PADDING,
        y: rect.y + CARD_PADDING,
        width: rect.width - CARD_PADDING * 2,
        height: rect.height - CARD_PADDING * 2,
      }
      overflow = estimateBodyOverflow(content.body, inner, theme)
      break
    }
    case 'titled-card': {
      const inner = {
        x: rect.x + CARD_PADDING,
        y: rect.y + CARD_HEADER_HEIGHT + CARD_PADDING,
        width: rect.width - CARD_PADDING * 2,
        height: rect.height - CARD_HEADER_HEIGHT - CARD_PADDING * 2,
      }
      overflow = Math.max(
        estimateBodyOverflow(content.body, inner, theme),
        estimateHeaderOverflow(content.title, rect, theme),
      )
      break
    }
  }
  return fitResult(overflow)
}

/** Pure estimate for the deterministic single-line slide title zone. */
export function estimateTitleFit(
  doc: TitleDoc,
  rect: Rect,
  theme?: PresentationTheme,
): FitResult {
  if (rect.width <= 0) return { fits: false, overflow: Number.MAX_SAFE_INTEGER }
  const needed = countDocChars(doc) * TITLE_FONT_SIZE * metricsFor(theme).heading
  return fitResult(needed - rect.width)
}

export const estimateFitChecker: ContentFitChecker = estimateFit
export const estimateTitleFitChecker: TitleFitChecker = estimateTitleFit
