/**
 * Content fit.
 *
 * `canFit(content, rect, context)` answers whether content is fully visible
 * inside a rect. Two implementations exist:
 *
 *  - `estimateFit` (here): pure, deterministic, no DOM. Used by unit tests and
 *    as a fallback when no browser measurement is available.
 *  - `DomContentMeasurer` (ui layer): renders the real component offscreen with
 *    identical typography and measures it. Used in the app.
 *
 * The render context is an argument rather than something a checker closes
 * over, because what a zone needs depends on state outside the zone: a global
 * font change has to be validated against the *prospective* theme, and a
 * citation's visible label comes from the *prospective* numbering of the whole
 * deck. Whatever will be rendered after the command is what gets measured
 * before it — see `commands/fitGuard.ts`.
 *
 * Domain commands take a `ContentFitChecker` so the domain layer stays headless.
 */

import {
  BODY_FONT_SIZE,
  BODY_LINE_HEIGHT,
  CARD_HEADER_FONT_SIZE,
  CARD_HEADER_HEIGHT,
  CARD_PADDING,
  CITATION_FONT_SCALE,
  CITATION_MARGIN_EM,
  CITATION_MIN_WIDTH_EM,
  CITATION_PADDING_EM,
  FIT_TOLERANCE,
  HEADING_FONT_SIZE,
  SUBFIELD_GAP,
  TITLE_FONT_SIZE,
} from './constants'
import { advanceRatioFor, DEFAULT_ADVANCE_RATIO } from './fonts'
import { citationLabel, type ReferenceNumbering } from './references'
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

/**
 * Everything outside the content itself that changes how much room it needs.
 *
 * Built from a whole presentation by `commands/fitGuard.ts`, so the two things
 * that live above a single zone — global typography and derived citation
 * numbers — are always the ones that will actually be rendered.
 */
export interface FitContext {
  theme: PresentationTheme
  numbering: ReferenceNumbering
}

export type ContentFitChecker = (
  content: ZoneContent,
  rect: Rect,
  context: FitContext,
) => FitResult

/** The slide title zone is one line of heading type, so it fails horizontally. */
export type TitleFitChecker = (doc: TitleDoc, rect: Rect, context: FitContext) => FitResult

const EMPTY_NUMBERING: ReferenceNumbering = new Map()

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

/** What the estimator needs to turn a document into a height. */
interface EstimateContext {
  metrics: FitMetrics
  numbering: ReferenceNumbering
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

function estimateContext(context?: Partial<FitContext>): EstimateContext {
  return {
    metrics: metricsFor(context?.theme),
    numbering: context?.numbering ?? EMPTY_NUMBERING,
  }
}

function charsPerLine(width: number, fontSize: number, advance: number): number {
  return Math.max(1, Math.floor(width / (fontSize * advance)))
}

/**
 * The width of a rendered citation pill, expressed as a number of body
 * characters so it can be added to a plain character count.
 *
 * A citation stores ids, not numbers: what it renders is derived from the
 * position of its first use in the whole deck, which is why the numbering is
 * part of the fit context. `10` is wider than `9`, and `1, 2` is wider than
 * `1–3`, so a renumbering elsewhere in the deck genuinely changes how much room
 * this paragraph needs.
 */
function citationCharCost(node: RichNode, context: EstimateContext): number {
  const ids = Array.isArray(node.attrs?.referenceIds)
    ? (node.attrs.referenceIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const label = citationLabel(ids, context.numbering)
  // A citation whose references are not numbered renders nothing at all.
  if (!label) return 0
  const advance = context.metrics.body
  const glyphs = CITATION_FONT_SCALE * label.length * advance
  const em =
    Math.max(CITATION_MIN_WIDTH_EM, glyphs + CITATION_PADDING_EM * 2) + CITATION_MARGIN_EM
  return em / advance
}

function countChars(node: RichNode, context: EstimateContext): number {
  let count = 0
  const go = (current: RichNode): void => {
    if (current.type === 'text' && current.text) count += current.text.length
    if (current.type === 'citation') count += citationCharCost(current, context)
    if (current.content) for (const child of current.content) go(child)
  }
  go(node)
  return count
}

function countDocChars(doc: RichDoc, context: EstimateContext): number {
  return (doc.content ?? []).reduce((total, node) => total + countChars(node, context), 0)
}

function estimateNodeHeight(node: RichNode, width: number, context: EstimateContext): number {
  const { metrics } = context
  switch (node.type) {
    case 'heading': {
      const chars = countChars(node, context)
      const lines = Math.ceil(chars / charsPerLine(width, HEADING_FONT_SIZE, metrics.heading)) || 1
      return lines * HEADING_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING
    }
    case 'paragraph': {
      const chars = countChars(node, context)
      const lines = Math.ceil(chars / charsPerLine(width, BODY_FONT_SIZE, metrics.body)) || 1
      return lines * BODY_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING
    }
    case 'blockquote': {
      const inner = (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width - LIST_INDENT, context),
        0,
      )
      return inner + BLOCK_SPACING * 2
    }
    case 'bulletList':
    case 'orderedList': {
      return (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width - LIST_INDENT, context),
        0,
      )
    }
    case 'listItem': {
      return (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width, context),
        0,
      )
    }
    case 'codeBlock': {
      const chars = countChars(node, context)
      const lines = Math.ceil(chars / charsPerLine(width, BODY_FONT_SIZE, metrics.body)) || 1
      return lines * BODY_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING * 2
    }
    case 'slaidsImage': {
      const percent = Number(node.attrs?.widthPercent)
      const share = Number.isFinite(percent) && percent > 0 ? percent / 100 : 1
      // Assume a 4:3 figure; the browser measurer refines this in the app.
      return (width * share * 3) / 4 + BLOCK_SPACING
    }
    case 'table': {
      const rows = node.content?.length ?? 0
      return rows * (BODY_FONT_SIZE * BODY_LINE_HEIGHT + 12) + BLOCK_SPACING
    }
    default:
      return 0
  }
}

export function estimateDocHeight(
  doc: RichDoc,
  width: number,
  context?: Partial<FitContext>,
): number {
  if (width <= 0) return Number.POSITIVE_INFINITY
  const estimate = estimateContext(context)
  return (doc.content ?? []).reduce(
    (total, node) => total + estimateNodeHeight(node, width, estimate),
    0,
  )
}

function estimateBodyOverflow(body: CardBody, area: Rect, context: EstimateContext): number {
  const count = body.subfields.length
  const total = body.weights.reduce((sum, w) => sum + w, 0) || count
  const along = body.axis === 'x' ? area.width : area.height
  const usable = along - SUBFIELD_GAP * (count - 1)
  let worst = 0
  for (let i = 0; i < count; i += 1) {
    const share = (usable * body.weights[i]) / total
    const width = body.axis === 'x' ? share : area.width
    const height = body.axis === 'x' ? area.height : share
    const needed = (body.subfields[i].doc.content ?? []).reduce(
      (sum, node) => sum + estimateNodeHeight(node, width, context),
      0,
    )
    worst = Math.max(worst, width <= 0 ? Number.POSITIVE_INFINITY : needed - height)
  }
  return worst
}

/**
 * A card title is one line inside a fixed-height header, so it overflows
 * sideways. The DOM measurer sees this through the header's `data-fit-scroll`;
 * the estimator has to model it explicitly.
 */
function estimateHeaderOverflow(title: TitleDoc, rect: Rect, context: EstimateContext): number {
  const available = rect.width - CARD_PADDING * 2
  if (available <= 0) return Number.MAX_SAFE_INTEGER
  const needed = countDocChars(title, context) * CARD_HEADER_FONT_SIZE * context.metrics.heading
  return needed - available
}

/** Pure estimate of whether content fits. Deliberately slightly conservative. */
export function estimateFit(
  content: ZoneContent,
  rect: Rect,
  context?: Partial<FitContext>,
): FitResult {
  if (rect.width <= 0 || rect.height <= 0) return { fits: false, overflow: Number.MAX_SAFE_INTEGER }
  const estimate = estimateContext(context)

  let overflow = 0
  switch (content.kind) {
    case 'container': {
      // A container is a transparent card without the padding: its subfields
      // divide the zone exactly as a card body divides the space inside one.
      if (content.payload.type === 'fields') {
        overflow = estimateBodyOverflow(content.payload.body, rect, estimate)
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
      overflow = estimateBodyOverflow(content.body, inner, estimate)
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
        estimateBodyOverflow(content.body, inner, estimate),
        estimateHeaderOverflow(content.title, rect, estimate),
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
  context?: Partial<FitContext>,
): FitResult {
  if (rect.width <= 0) return { fits: false, overflow: Number.MAX_SAFE_INTEGER }
  const estimate = estimateContext(context)
  const needed = countDocChars(doc, estimate) * TITLE_FONT_SIZE * estimate.metrics.heading
  return fitResult(needed - rect.width)
}

export const estimateFitChecker: ContentFitChecker = estimateFit
export const estimateTitleFitChecker: TitleFitChecker = estimateTitleFit
