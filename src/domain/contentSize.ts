/**
 * How small a zone may be, given what it holds.
 *
 * There is no universal minimum zone size. A zone is too small when the thing
 * inside it cannot be drawn there — which is a question about the content, not
 * about zones — so this module answers exactly one question, and every caller
 * asks it here rather than keeping a number of its own:
 *
 *     «Can this kind of content exist in this rectangle?»
 *
 * The layout commands ask it before they commit a split or a ratio, the
 * geometry validator asks it of a stored document, the content picker asks it
 * of every kind it offers, and the agent's operations ask it through the very
 * same commands. One rule, so a layout the editor allows is a layout the agent
 * allows and a document the validator calls valid.
 *
 * Two of the minimums are judgements (`MIN_TEXT_WIDTH`, `MIN_IMAGE_SIZE`); the
 * rest is arithmetic on the chrome a kind actually draws, taken from the same
 * theme tokens the renderer and the fit estimator read. That is what makes a
 * card at «ekstra stor» type need more room than the same card at «liten»:
 * the header really is taller, so the smallest card really is bigger.
 *
 * What this is *not* is the fit check. Fit asks whether the text that is there
 * fits the room it has (`domain/fit.ts`); this asks whether the room is enough
 * for the kind of thing at all, empty. Both gates run, and they answer with
 * different codes because the two call for different repairs: shorten the text,
 * or give the zone more room.
 */

import { BODY_LINE_HEIGHT, GEOMETRY_EPSILON, MIN_IMAGE_SIZE, MIN_TEXT_WIDTH } from './constants'
import { contentConversionRefusal, ZONE_CONTENT_KINDS } from './content'
import { themeMetrics, type ThemeMetrics } from './metrics'
import type { Rect, Size, ZoneContent, ZoneContentKind } from './types'

/** No requirement at all: whatever the geometry allows is legal. */
const NO_MINIMUM: Size = { width: 0, height: 0 }

/**
 * One line of body text, as the fit estimator counts it.
 *
 * Including the block's own bottom spacing, because that is what
 * `estimateNodeHeight` adds to a paragraph — a minimum that left it out would
 * be a minimum the fit gate immediately refuses, and the two would disagree
 * about the same empty card.
 */
function oneTextLine(tokens: ThemeMetrics): number {
  return tokens.bodyFontSize * BODY_LINE_HEIGHT + tokens.paragraphSpacing
}

/**
 * The smallest rect a kind of content can be drawn in.
 *
 * Written as a `switch` without a default on purpose: a content kind added to
 * the domain does not compile until somebody has decided how small it may be.
 */
export function minimumSizeForKind(
  kind: ZoneContentKind,
  tokens: ThemeMetrics = themeMetrics(),
): Size {
  switch (kind) {
    case 'negative-space':
      // Air. Nothing is drawn, so nothing can be hidden, so there is no floor.
      return { ...NO_MINIMUM }
    case 'container':
      // A transparent card: the text stands directly on the slide, with no
      // chrome of its own around it.
      return { width: MIN_TEXT_WIDTH, height: oneTextLine(tokens) }
    case 'untitled-card':
      return { width: MIN_TEXT_WIDTH, height: tokens.cardPadding * 2 + oneTextLine(tokens) }
    case 'titled-card':
      // Headerens egen høyde, aldri `cardBodyOffset`: hvor lite et kort kan
      // være avhenger ikke av hvordan temaet tegner tittelen, så et bytte
      // kan aldri ta en sone under minstemålet. Se `ThemeMetrics`.
      return {
        width: MIN_TEXT_WIDTH,
        height: tokens.cardHeaderHeight + tokens.cardPadding * 2 + oneTextLine(tokens),
      }
    case 'image':
      return { width: MIN_IMAGE_SIZE, height: MIN_IMAGE_SIZE }
    case 'titled-image-card':
      // The header is a line of text, so it needs a text zone's width; the
      // body is a picture, so it needs a picture's height under the header.
      return { width: MIN_TEXT_WIDTH, height: tokens.cardHeaderHeight + MIN_IMAGE_SIZE }
  }
}

/**
 * The smallest rect a leaf may occupy, given what it holds.
 *
 * An empty leaf and a negative-space leaf both answer «no minimum», and for the
 * same reason: neither draws anything a small rectangle could hide. They remain
 * two different things — a hole the editor offers a picker in and an agent
 * reads as `empty: true`, and composition the author chose — but «how small may
 * this be» is a question about what is drawn, and neither of them draws.
 */
export function minimumSizeForContent(
  content: ZoneContent | null,
  tokens: ThemeMetrics = themeMetrics(),
): Size {
  return content ? minimumSizeForKind(content.kind, tokens) : { ...NO_MINIMUM }
}

/** Whether a rect is at least this big, allowing for floating point noise. */
export function rectHolds(size: Size, rect: Rect): boolean {
  return (
    rect.width >= size.width - GEOMETRY_EPSILON && rect.height >= size.height - GEOMETRY_EPSILON
  )
}

/** Whether content of this kind can exist in this rect. */
export function contentKindFitsRect(
  kind: ZoneContentKind,
  rect: Rect,
  tokens: ThemeMetrics = themeMetrics(),
): boolean {
  return rectHolds(minimumSizeForKind(kind, tokens), rect)
}

/**
 * Why a kind cannot be used in a rect, or `null` when it can.
 *
 * One sentence and the two numbers behind it, so the same answer serves a
 * tooltip on a greyed-out button in the picker and the machine-readable
 * `details` of a refused agent call. Callers never phrase this themselves:
 * a disabled button and a `ZONE_TOO_SMALL` are the same finding.
 */
export interface ContentKindRefusal {
  message: string
  minimum: Size
  rect: Rect
}

export function contentKindRefusal(
  kind: ZoneContentKind,
  rect: Rect,
  tokens: ThemeMetrics = themeMetrics(),
): ContentKindRefusal | null {
  const minimum = minimumSizeForKind(kind, tokens)
  if (rectHolds(minimum, rect)) return null
  return {
    message: `Sonen er for liten for denne innholdstypen. Den trenger minst ${Math.ceil(
      minimum.width,
    )} × ${Math.ceil(minimum.height)} og er ${Math.round(rect.width)} × ${Math.round(rect.height)}.`,
    minimum,
    rect,
  }
}

/* ------------------------------------------------------------------ *
 * Can this zone become that kind?
 * ------------------------------------------------------------------ */

/**
 * Why a zone cannot become a kind of content, or `null` when it can.
 *
 * The whole question, in one place, because three different callers were
 * answering parts of it and drifting: the command that converts, the picker
 * that offers the choice, and the agent's `inspect_slide`, which tells a
 * caller what it may ask for. A picker that offers what the command refuses is
 * a button that fails on click; an inspection that does it is an agent sent to
 * make a call that cannot succeed.
 *
 * Three things decide it, in this order:
 *
 *  1. **The kind the zone already is** is never refused. It is the state the
 *     document is in, and the command answers «done» to it — which is what
 *     keeps a zone that is already too small for what it holds (an import, a
 *     document from before a token moved) repairable at all.
 *  2. **Is the rectangle big enough for that kind?** `contentKindRefusal`.
 *     `rect` is `null` where there is no zone to measure — nothing selected —
 *     and then this question is simply not asked.
 *  3. **Would the conversion throw something away?** Only air can, and it
 *     throws away everything — it has nowhere to put what a card was showing —
 *     so a zone with something in it has to be emptied first.
 *
 * `content` is what the zone holds *today*, and `null` for an empty zone —
 * which reduces this to the size question, exactly as placing fresh content
 * into an empty zone should.
 */
export interface ZoneKindRefusal {
  /** The code the command refuses with, so a caller reads one vocabulary. */
  code: 'ZONE_TOO_SMALL' | 'INVALID_CONTENT'
  message: string
  /** Present on `ZONE_TOO_SMALL`: the two rectangles behind the refusal. */
  minimum?: Size
  rect?: Rect
}

export function zoneKindRefusal(
  kind: ZoneContentKind,
  rect: Rect | null,
  content: ZoneContent | null,
  tokens: ThemeMetrics = themeMetrics(),
): ZoneKindRefusal | null {
  if (content?.kind === kind) return null

  const tooSmall = rect ? contentKindRefusal(kind, rect, tokens) : null
  if (tooSmall) return { code: 'ZONE_TOO_SMALL', ...tooSmall }

  const wouldLose = contentConversionRefusal(content, kind)
  if (wouldLose) return { code: 'INVALID_CONTENT', message: wouldLose }
  return null
}

/** The kinds this zone could be changed to, in the domain's own order. */
export function availableContentKinds(
  rect: Rect | null,
  content: ZoneContent | null,
  tokens: ThemeMetrics = themeMetrics(),
): ZoneContentKind[] {
  return ZONE_CONTENT_KINDS.filter((kind) => zoneKindRefusal(kind, rect, content, tokens) === null)
}
