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
 * Domain commands take a `ContentFitChecker` so the domain layer stays headless.
 */

import {
  BODY_FONT_SIZE,
  BODY_LINE_HEIGHT,
  CARD_HEADER_HEIGHT,
  CARD_PADDING,
  HEADING_FONT_SIZE,
  SUBFIELD_GAP,
} from './constants'
import { docCharacterCount } from './richdoc'
import type { CardBody, Rect, RichDoc, RichNode, ZoneContent } from './types'

export interface FitResult {
  fits: boolean
  /** How many logical pixels of content did not fit (0 when it fits). */
  overflow: number
}

export type ContentFitChecker = (content: ZoneContent, rect: Rect) => FitResult

export const FITS: FitResult = { fits: true, overflow: 0 }

/** Permissive checker used where fit is not the constraint being tested. */
export const alwaysFits: ContentFitChecker = () => FITS

/* ------------------------------------------------------------------ *
 * Deterministic estimation
 * ------------------------------------------------------------------ */

/** Average glyph advance as a fraction of the font size. */
const AVERAGE_GLYPH_RATIO = 0.5
const LIST_INDENT = 24
const BLOCK_SPACING = 6

function charsPerLine(width: number, fontSize: number): number {
  return Math.max(1, Math.floor(width / (fontSize * AVERAGE_GLYPH_RATIO)))
}

function estimateNodeHeight(node: RichNode, width: number): number {
  switch (node.type) {
    case 'heading': {
      const chars = countChars(node)
      const lines = Math.ceil(chars / charsPerLine(width, HEADING_FONT_SIZE)) || 1
      return lines * HEADING_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING
    }
    case 'paragraph': {
      const chars = countChars(node)
      const lines = Math.ceil(chars / charsPerLine(width, BODY_FONT_SIZE)) || 1
      return lines * BODY_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING
    }
    case 'blockquote': {
      const inner = (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width - LIST_INDENT),
        0,
      )
      return inner + BLOCK_SPACING * 2
    }
    case 'bulletList':
    case 'orderedList': {
      return (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width - LIST_INDENT),
        0,
      )
    }
    case 'listItem': {
      return (node.content ?? []).reduce(
        (total, child) => total + estimateNodeHeight(child, width),
        0,
      )
    }
    case 'codeBlock': {
      const chars = countChars(node)
      const lines = Math.ceil(chars / charsPerLine(width, BODY_FONT_SIZE)) || 1
      return lines * BODY_FONT_SIZE * BODY_LINE_HEIGHT + BLOCK_SPACING * 2
    }
    case 'slaidsImage': {
      const height = Number(node.attrs?.displayHeight)
      return Number.isFinite(height) && height > 0 ? height + BLOCK_SPACING : width * 0.5
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

export function estimateDocHeight(doc: RichDoc, width: number): number {
  if (width <= 0) return Number.POSITIVE_INFINITY
  return (doc.content ?? []).reduce((total, node) => total + estimateNodeHeight(node, width), 0)
}

function estimateBodyOverflow(body: CardBody, area: Rect): number {
  const count = body.subfields.length
  const total = body.weights.reduce((sum, w) => sum + w, 0) || count
  const along = body.axis === 'x' ? area.width : area.height
  const usable = along - SUBFIELD_GAP * (count - 1)
  let worst = 0
  for (let i = 0; i < count; i += 1) {
    const share = (usable * body.weights[i]) / total
    const width = body.axis === 'x' ? share : area.width
    const height = body.axis === 'x' ? area.height : share
    const needed = estimateDocHeight(body.subfields[i].doc, width)
    worst = Math.max(worst, needed - height)
  }
  return worst
}

/** Pure estimate of whether content fits. Deliberately slightly conservative. */
export function estimateFit(content: ZoneContent, rect: Rect): FitResult {
  if (rect.width <= 0 || rect.height <= 0) return { fits: false, overflow: Number.MAX_SAFE_INTEGER }

  let overflow = 0
  switch (content.kind) {
    case 'container': {
      if (content.payload.type === 'richdoc') {
        overflow = estimateDocHeight(content.payload.doc, rect.width) - rect.height
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
      overflow = estimateBodyOverflow(content.body, inner)
      break
    }
    case 'titled-card': {
      const inner = {
        x: rect.x + CARD_PADDING,
        y: rect.y + CARD_HEADER_HEIGHT + CARD_PADDING,
        width: rect.width - CARD_PADDING * 2,
        height: rect.height - CARD_HEADER_HEIGHT - CARD_PADDING * 2,
      }
      overflow = estimateBodyOverflow(content.body, inner)
      break
    }
  }
  const rounded = Math.max(0, Math.round(overflow * 100) / 100)
  return { fits: rounded <= 0, overflow: rounded }
}

export const estimateFitChecker: ContentFitChecker = estimateFit

/** Character budget for a single-line title zone at a given width. */
export function titleFitsWidth(text: string, width: number, fontSize: number): boolean {
  return text.length * fontSize * AVERAGE_GLYPH_RATIO <= width
}

export function docFitsTitleZone(doc: RichDoc, width: number, fontSize: number): boolean {
  return docCharacterCount(doc) * fontSize * AVERAGE_GLYPH_RATIO <= width
}
