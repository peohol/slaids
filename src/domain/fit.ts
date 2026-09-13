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
  BODY_LINE_HEIGHT,
  CAPTION_PADDING_X_EM,
  CAPTION_PADDING_Y_EM,
  CITATION_FONT_SCALE,
  CITATION_MARGIN_EM,
  CITATION_MIN_WIDTH_EM,
  CITATION_PADDING_EM,
  FIT_TOLERANCE,
  INLINE_IMAGE_DEFAULT_ASPECT,
} from './constants'
import { advanceRatioFor, DEFAULT_ADVANCE_RATIO } from './fonts'
import { themeMetrics, type ThemeMetrics } from './metrics'
import { citationLabel, type ReferenceNumbering } from './references'
import { inlineImageOf } from './richdoc'
import type {
  CardBody,
  ImageCaption,
  PresentationTheme,
  Rect,
  RichDoc,
  RichNode,
  TitleDoc,
  ZoneContent,
} from './types'

/**
 * The places inside one piece of content that can clip, each with how much of
 * it did not fit.
 *
 * Keyed by the part ids below. A zone is not one place — a titled card is a
 * header *and* a body, a picture is a frame *and* a caption over it — and the
 * whole point of reporting them separately is that one of them overflowing must
 * not be able to hide another one starting to. Measuring a zone as a single
 * worst number is exactly how a card title could grow out of its header while
 * the body was already overflowing more: the worst number never moved, so
 * «never worse» read as «nothing happened».
 */
export type FitParts = Readonly<Record<string, number>>

/** The header of a titled card, with or without a picture under it. */
export const CARD_TITLE_PART = 'card-title'
/** The caption box over a picture. */
export const CAPTION_PART = 'caption'
/** One text field inside a card or container. */
export function subfieldPart(subfieldId: string): string {
  return `field:${subfieldId}`
}

export interface FitResult {
  fits: boolean
  /** How many logical pixels of content did not fit (0 when it fits). */
  overflow: number
  /**
   * The same measurement broken down per clipping region. Empty means the
   * content is one region — there is nothing inside it to tell apart.
   */
  parts: FitParts
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

/**
 * The slide title zone is one line of heading type, so it fails horizontally.
 *
 * `fontSize` exists because the same rule governs a line that is not the slide
 * title's size — the cover's subtitle is a step smaller — and measuring that
 * line at the title's size would refuse text that fits perfectly well. Omitted,
 * it is the slide title's own size, which is what every slide asks for.
 */
export type TitleFitChecker = (
  doc: TitleDoc,
  rect: Rect,
  context: FitContext,
  fontSize?: number,
) => FitResult

const EMPTY_NUMBERING: ReferenceNumbering = new Map()

function roundOverflow(overflow: number): number {
  return Math.max(0, Math.round(overflow * 100) / 100)
}

/**
 * Normalise raw overflow measurements into a `FitResult`.
 *
 * The whole is the worst part rather than a number of its own: a zone fits when
 * every place in it fits, and it is as broken as its most broken place. Passing
 * the parts is therefore enough — the total cannot disagree with them.
 */
export function fitResult(parts: FitParts): FitResult
export function fitResult(overflow: number): FitResult
export function fitResult(input: number | FitParts): FitResult {
  if (typeof input === 'number') {
    const rounded = roundOverflow(input)
    return { fits: rounded <= FIT_TOLERANCE, overflow: rounded, parts: {} }
  }
  const parts: Record<string, number> = {}
  let worst = 0
  for (const [part, overflow] of Object.entries(input)) {
    const rounded = roundOverflow(overflow)
    parts[part] = rounded
    worst = Math.max(worst, rounded)
  }
  return { fits: worst <= FIT_TOLERANCE, overflow: worst, parts }
}

/** What a rect nothing can be drawn in answers, whatever is asked of it. */
function doesNotFitAtAll(parts: readonly string[]): FitResult {
  return fitResult(Object.fromEntries(parts.map((part) => [part, Number.MAX_SAFE_INTEGER])))
}

/**
 * Theme fields that can change how much space content needs.
 *
 * The fonts, the air and the type size all can — each of them changes either
 * how wide a glyph is, how much room is left for glyphs, or both. Colours
 * cannot, so a background change must not trigger a full re-measure of the deck.
 */
export function sameFitRelevantTheme(a: PresentationTheme, b: PresentationTheme): boolean {
  return (
    a.headingFontFamily === b.headingFontFamily &&
    a.bodyFontFamily === b.bodyFontFamily &&
    a.spacing === b.spacing &&
    a.fontScale === b.fontScale
  )
}

/* ------------------------------------------------------------------ *
 * Deterministic estimation
 * ------------------------------------------------------------------ */

/** Average glyph advances for the fonts a theme selects. */
interface FitMetrics {
  body: number
  heading: number
}

/** What the estimator needs to turn a document into a height. */
interface EstimateContext {
  metrics: FitMetrics
  /** Sizes and spacing the theme dictates — see `domain/metrics.ts`. */
  tokens: ThemeMetrics
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
    tokens: themeMetrics(context?.theme),
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

/**
 * How much of a field's height one block takes.
 *
 * `fieldHeight` is the height of the block's containing block — the field it
 * stands in — and only a figure has any use for it: see `slaidsImage`. It is
 * `Infinity` for a block nested inside another one, which is not a hedge but
 * the same thing the stylesheet says (a percentage against an auto height is
 * no limit at all).
 */
function estimateNodeHeight(
  node: RichNode,
  width: number,
  context: EstimateContext,
  fieldHeight = Number.POSITIVE_INFINITY,
): number {
  const { metrics, tokens } = context
  const indent = tokens.listIndent
  switch (node.type) {
    case 'heading': {
      const chars = countChars(node, context)
      const size = tokens.headingFontSize
      const lines = Math.ceil(chars / charsPerLine(width, size, metrics.heading)) || 1
      return lines * size * BODY_LINE_HEIGHT + tokens.headingSpacing
    }
    case 'paragraph': {
      const chars = countChars(node, context)
      const size = tokens.bodyFontSize
      const lines = Math.ceil(chars / charsPerLine(width, size, metrics.body)) || 1
      return lines * size * BODY_LINE_HEIGHT + tokens.blockSpacing
    }
    case 'blockquote': {
      const inner = (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width - indent, context),
        0,
      )
      return inner + tokens.blockSpacing * 2
    }
    case 'bulletList':
    case 'orderedList': {
      return (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width - indent, context),
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
      const size = tokens.bodyFontSize
      const lines = Math.ceil(chars / charsPerLine(width, size, metrics.body)) || 1
      return lines * size * BODY_LINE_HEIGHT + tokens.blockSpacing * 2
    }
    case 'slaidsImage': {
      /*
       * Two rules, and both of them are `slide.css`'s rather than this file's.
       *
       * The picture's own proportions decide how tall it wants to be: the box
       * is `width / aspect`, taken from the file when it was stored, and a
       * document written before `aspect` existed gets the stylesheet's own
       * fallback ratio.
       *
       * And then it is capped. `.rd-image-wrapper` is `max-height: 100%` inside
       * a field of a definite height, so the browser never draws a figure
       * taller than the field it stands in — «a figure can never be the cause
       * of an overflow», as the stylesheet puts it, and a portrait photograph
       * at full width is *contained*, not overflowing. Estimating it at its
       * uncapped height would refuse a slide the renderer draws perfectly, and
       * refuse it at every width, because the cap is the same at every width.
       *
       * The cap is the field's whole height and not the room left below the
       * blocks above, because that is what a percentage resolves against: text
       * above a filled figure therefore *does* overflow, by exactly its own
       * height, which is what the browser reports too.
       *
       * `fieldHeight` is `Infinity` where the cap does not apply — inside a
       * list item or a quote the containing block has an auto height, the
       * percentage resolves to `none`, and the figure really is as tall as its
       * proportions make it.
       *
       * The block's own bottom margin is inside the cap rather than added on
       * top of it, because a capped figure is by definition the block that
       * fills the field: it is either the last one, and `slide.css` zeroes the
       * last child's margin, or what follows it has already overflowed by its
       * own height. Adding the margin outside would refuse a figure that fills
       * its field exactly — by one block spacing, at every width.
       */
      const image = inlineImageOf(node)
      if (!image) return 0
      const ratio = image.aspect ?? INLINE_IMAGE_DEFAULT_ASPECT
      const natural = (width * (image.widthPercent / 100)) / ratio
      return Math.min(natural + tokens.blockSpacing, fieldHeight)
    }
    case 'table': {
      const rows = node.content?.length ?? 0
      return rows * (tokens.bodyFontSize * BODY_LINE_HEIGHT + 12) + tokens.blockSpacing
    }
    default:
      return 0
  }
}

/**
 * The height a flow needs in a column of `width`.
 *
 * `fieldHeight` is the height of the field the flow is laid out in, when the
 * caller has one. It changes nothing for text and everything for a figure,
 * which the stylesheet caps at the height of its field — so a caller that
 * leaves it out gets a figure measured uncapped, which is right for a flow
 * with no field around it (a reference entry) and too pessimistic for one
 * inside a zone. `estimateBodyOverflow` always passes it.
 */
export function estimateDocHeight(
  doc: RichDoc,
  width: number,
  context?: Partial<FitContext>,
  fieldHeight = Number.POSITIVE_INFINITY,
): number {
  if (width <= 0) return Number.POSITIVE_INFINITY
  const estimate = estimateContext(context)
  return (doc.content ?? []).reduce(
    (total, node) => total + estimateNodeHeight(node, width, estimate, fieldHeight),
    0,
  )
}

/**
 * The overflow of each field in a body, keyed by the field it belongs to.
 *
 * Per field and not one worst number, for the reason `FitParts` exists: two
 * columns in one card are two places that clip, and filling the second one must
 * not be allowed to hide under the first one already being full.
 */
function estimateBodyOverflow(body: CardBody, area: Rect, context: EstimateContext): FitParts {
  const count = body.subfields.length
  const total = body.weights.reduce((sum, w) => sum + w, 0) || count
  const along = body.axis === 'x' ? area.width : area.height
  const usable = along - context.tokens.subfieldGap * (count - 1)
  const parts: Record<string, number> = {}
  for (let i = 0; i < count; i += 1) {
    // The fraction first, the length second — the same ordering `splitRect`
    // uses, and for the same reason. `usable * 1e307` is `Infinity` while the
    // sum is still perfectly finite, and an infinite share reads as a subfield
    // wide enough for any text: `[1e307, 1e307]` and `[1, 1]` are the same
    // layout, so they have to get the same answer.
    const share = usable * (body.weights[i] / total)
    const width = body.axis === 'x' ? share : area.width
    const height = body.axis === 'x' ? area.height : share
    const needed = (body.subfields[i].doc.content ?? []).reduce(
      (sum, node) => sum + estimateNodeHeight(node, width, context, height),
      0,
    )
    parts[subfieldPart(body.subfields[i].id)] =
      width <= 0 ? Number.MAX_SAFE_INTEGER : needed - height
  }
  return parts
}

/**
 * A card title is one line inside a fixed-height header, so it overflows
 * sideways. The DOM measurer sees this through the header's `data-fit-scroll`;
 * the estimator has to model it explicitly.
 */
function estimateHeaderOverflow(title: TitleDoc, rect: Rect, context: EstimateContext): number {
  const available = rect.width - context.tokens.cardPadding * 2
  if (available <= 0) return Number.MAX_SAFE_INTEGER
  const needed =
    countDocChars(title, context) * context.tokens.cardHeaderFontSize * context.metrics.heading
  return needed - available
}

/**
 * A caption over a picture.
 *
 * The picture itself can never overflow — it is cropped to the frame by
 * definition — so the only thing to measure here is the caption, which grows
 * downwards from one line as it wraps and is bounded by the picture's own
 * height. Its width is the frame less the air on both sides.
 */
function estimateCaptionOverflow(
  caption: ImageCaption,
  panel: Rect,
  context: EstimateContext,
): number {
  const size = context.tokens.captionFontSize
  const padX = size * CAPTION_PADDING_X_EM
  const padY = size * CAPTION_PADDING_Y_EM
  const available = panel.width - context.tokens.captionSideGap * 2 - padX * 2
  if (available <= 0) return Number.MAX_SAFE_INTEGER
  const chars = countDocChars(caption.doc, context)
  const lines = Math.ceil(chars / charsPerLine(available, size, context.metrics.body)) || 1
  return lines * size * BODY_LINE_HEIGHT + padY * 2 - panel.height
}

/** Pure estimate of whether content fits. Deliberately slightly conservative. */
export function estimateFit(
  content: ZoneContent,
  rect: Rect,
  context?: Partial<FitContext>,
): FitResult {
  // Air is the one kind with nothing to measure, and it is measured first: a
  // rect of no size holds it perfectly well, because it draws nothing there.
  if (content.kind === 'negative-space') return fitResult({})
  if (rect.width <= 0 || rect.height <= 0) return doesNotFitAtAll(partsOf(content))
  const estimate = estimateContext(context)

  switch (content.kind) {
    case 'image': {
      return fitResult(
        content.image.caption
          ? { [CAPTION_PART]: estimateCaptionOverflow(content.image.caption, rect, estimate) }
          : {},
      )
    }
    case 'titled-image-card': {
      const header = estimate.tokens.cardHeaderHeight
      const panel = { ...rect, y: rect.y + header, height: rect.height - header }
      return fitResult({
        [CARD_TITLE_PART]: estimateHeaderOverflow(content.title, rect, estimate),
        ...(content.image.caption
          ? {
              [CAPTION_PART]: Math.max(
                // A header taller than the card leaves the picture — and with
                // it the caption over it — nowhere to be drawn at all.
                panel.height <= 0 ? Number.MAX_SAFE_INTEGER : 0,
                estimateCaptionOverflow(content.image.caption, panel, estimate),
              ),
            }
          : {}),
      })
    }
    case 'container': {
      // A container is a transparent card without the padding: its subfields
      // divide the zone exactly as a card body divides the space inside one.
      return fitResult(estimateBodyOverflow(content.body, rect, estimate))
    }
    case 'untitled-card': {
      const pad = estimate.tokens.cardPadding
      const inner = {
        x: rect.x + pad,
        y: rect.y + pad,
        width: rect.width - pad * 2,
        height: rect.height - pad * 2,
      }
      return fitResult(estimateBodyOverflow(content.body, inner, estimate))
    }
    case 'titled-card': {
      const pad = estimate.tokens.cardPadding
      const header = estimate.tokens.cardHeaderHeight
      const inner = {
        x: rect.x + pad,
        y: rect.y + header + pad,
        width: rect.width - pad * 2,
        height: rect.height - header - pad * 2,
      }
      return fitResult({
        ...estimateBodyOverflow(content.body, inner, estimate),
        [CARD_TITLE_PART]: estimateHeaderOverflow(content.title, rect, estimate),
      })
    }
  }
}

/**
 * Every place this content can clip, whether or not it clips today.
 *
 * Used where there is no room to measure anything: a rect of no size fails in
 * all of them at once, and a result that named none would be a result the
 * regression check reads as "nothing overflows here".
 */
export function partsOf(content: ZoneContent): string[] {
  switch (content.kind) {
    case 'negative-space':
      return []
    case 'image':
      return content.image.caption ? [CAPTION_PART] : []
    case 'titled-image-card':
      return content.image.caption ? [CARD_TITLE_PART, CAPTION_PART] : [CARD_TITLE_PART]
    case 'container':
    case 'untitled-card':
      return content.body.subfields.map((field) => subfieldPart(field.id))
    case 'titled-card':
      return [CARD_TITLE_PART, ...content.body.subfields.map((field) => subfieldPart(field.id))]
  }
}

/** Pure estimate for a deterministic single line of heading type. */
export function estimateTitleFit(
  doc: TitleDoc,
  rect: Rect,
  context?: Partial<FitContext>,
  fontSize?: number,
): FitResult {
  // One line is one place, so a title reports no parts: the node it belongs to
  // is the region, and `overflowKey` leaves the part empty for exactly this.
  if (rect.width <= 0) return fitResult(Number.MAX_SAFE_INTEGER)
  const estimate = estimateContext(context)
  const size = fontSize ?? estimate.tokens.titleFontSize
  const needed = countDocChars(doc, estimate) * size * estimate.metrics.heading
  return fitResult(needed - rect.width)
}

export const estimateFitChecker: ContentFitChecker = estimateFit
export const estimateTitleFitChecker: TitleFitChecker = estimateTitleFit
