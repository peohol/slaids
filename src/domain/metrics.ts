/**
 * Theme-derived design tokens.
 *
 * `constants.ts` holds the base values; a theme scales them. Two dials are
 * exposed to the author:
 *
 *  - **Luft** (`spacing`) — one multiplier on every distance between things:
 *    the global gap, the slide inset, card padding, the space between
 *    subfields and the space between blocks of text. Scaling them together is
 *    what keeps the single-gap invariant true at any setting: the gap stays one
 *    distance, it is just a different one.
 *  - **Skriftstørrelse** (`fontScale`) — one multiplier on every type size,
 *    including the boxes whose height is dictated by type (the title zone and a
 *    card's header), so bigger text never lands in a box built for smaller text.
 *
 * Everything that measures, renders or validates layout reads its numbers from
 * here, so the estimator, the DOM and the geometry engine cannot drift apart.
 */

import {
  BODY_FONT_SIZE,
  BLOCK_SPACING,
  CAPTION_FONT_SIZE,
  CAPTION_SIDE_GAP,
  CARD_HEADER_FONT_SIZE,
  CARD_HEADER_HEIGHT,
  CARD_PADDING,
  SECTION_SUBTITLE_FONT_SIZE,
  G,
  HEADING_FONT_SIZE,
  HEADING_SPACING,
  LIST_INDENT,
  PARAGRAPH_SPACING,
  REFERENCE_ENTRY_GAP,
  SUBFIELD_GAP,
  TITLE_FONT_SIZE,
  titleZoneHeightFor,
} from './constants'
import type { PresentationTheme } from './types'

export interface ThemeMetrics {
  /** The single global gap, and the slide inset that equals it by definition. */
  gap: number
  cardPadding: number
  subfieldGap: number
  /** Space below a list or quote. */
  blockSpacing: number
  /** Space below an ordinary paragraph — more than `blockSpacing` gives a list or a quote. */
  paragraphSpacing: number
  /** Space below one reference-slide entry — more than `blockSpacing` gives, for visual separation between entries. */
  referenceEntryGap: number
  /** Space below a heading — the distance from a heading to the text it heads. */
  headingSpacing: number
  listIndent: number
  bodyFontSize: number
  headingFontSize: number
  titleFontSize: number
  /** A section's subheading: a step below its heading, scaled with the rest. */
  sectionSubtitleFontSize: number
  cardHeaderFontSize: number
  cardHeaderHeight: number
  titleZoneHeight: number
  /** The caption over a picture: its type, and the air beside it. */
  captionFontSize: number
  captionSideGap: number
}

/**
 * The two dials, and where they may stand.
 *
 * Both ladders have been shifted up, twice: what was «Luftig» is now the
 * tightest a deck can be put in, and the top rung is looser again than the old
 * one. The base numbers in `constants.ts` did not move — what moved is the
 * multiplier, which is the honest place to move it: a stored `spacing` still
 * means exactly what it meant, it is simply no longer offered below the new
 * floor.
 */
export const SPACING_RANGE = { min: 1.6, max: 3.2 } as const
export const FONT_SCALE_RANGE = { min: 1.3, max: 2 } as const

/** What a new deck opens in: the «Normal» rung on each ladder. */
export const DEFAULT_SPACING = 2
export const DEFAULT_FONT_SCALE = 1.45

/**
 * The multiplier that means «the base tokens, unscaled».
 *
 * It is what a deck stored before the theme had these dials was drawn at, so a
 * migration that fills them in fills in *this* — never `DEFAULT_SPACING`, which
 * is what a new deck opens in. Reproducing a stored deck and styling a new one
 * are two different jobs, and they only looked like one while the default
 * happened to be neutral.
 *
 * The ladders have since moved past it, so a deck stored before the scales
 * existed can no longer be drawn exactly as it was: `repairPresentation` clamps
 * it up to the tightest setting the theme still offers. That is a deliberate
 * consequence of shifting the floor, not an accident — and it is why the value
 * is still named: what a migration fills in is a historical fact about the
 * document, and what the clamp then does to it is a separate decision.
 */
export const NEUTRAL_SCALE = 1

/** A named setting on one of the two scales. */
export interface ThemeScalePreset {
  label: string
  value: number
}

/**
 * The settings the theme chooser offers, and the values they stand for.
 *
 * The scales themselves are continuous — `SPACING_RANGE` and `FONT_SCALE_RANGE`
 * are the real limits, and the fit guard decides what is usable inside them.
 * A person picking a theme wants four buttons rather than a slider, so these
 * are the four, named. They live here beside the ranges rather than in the
 * modal because they are not only a button layout: they are the vocabulary the
 * agent contract quotes when it tells a caller what «normal» means, and one
 * list is what keeps the two saying the same thing.
 */
export const SPACING_PRESETS: readonly ThemeScalePreset[] = [
  { label: 'Tett', value: SPACING_RANGE.min },
  { label: 'Normal', value: DEFAULT_SPACING },
  { label: 'Luftig', value: 2.4 },
  { label: 'Ekstra luftig', value: 2.8 },
]

export const FONT_SCALE_PRESETS: readonly ThemeScalePreset[] = [
  { label: 'Liten', value: FONT_SCALE_RANGE.min },
  { label: 'Normal', value: DEFAULT_FONT_SCALE },
  { label: 'Stor', value: 1.6 },
  { label: 'Ekstra stor', value: 1.75 },
]

function clamp(value: number, range: { min: number; max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, value))
}

/** Distances stay whole numbers: a fractional gap would drift under rounding. */
function scaled(base: number, factor: number): number {
  return Math.round(base * factor)
}

export function themeMetrics(theme?: Partial<PresentationTheme>): ThemeMetrics {
  const spacing = clamp(theme?.spacing ?? DEFAULT_SPACING, SPACING_RANGE, DEFAULT_SPACING)
  const font = clamp(theme?.fontScale ?? DEFAULT_FONT_SCALE, FONT_SCALE_RANGE, DEFAULT_FONT_SCALE)
  return {
    gap: Math.max(4, scaled(G, spacing)),
    cardPadding: Math.max(4, scaled(CARD_PADDING, spacing)),
    subfieldGap: Math.max(4, scaled(SUBFIELD_GAP, spacing)),
    blockSpacing: Math.max(2, scaled(BLOCK_SPACING, spacing)),
    paragraphSpacing: Math.max(2, scaled(PARAGRAPH_SPACING, spacing)),
    referenceEntryGap: Math.max(4, scaled(REFERENCE_ENTRY_GAP, spacing)),
    headingSpacing: Math.max(2, scaled(HEADING_SPACING, spacing)),
    listIndent: Math.max(8, scaled(LIST_INDENT, spacing)),
    bodyFontSize: scaled(BODY_FONT_SIZE, font),
    headingFontSize: scaled(HEADING_FONT_SIZE, font),
    titleFontSize: scaled(TITLE_FONT_SIZE, font),
    sectionSubtitleFontSize: scaled(SECTION_SUBTITLE_FONT_SIZE, font),
    cardHeaderFontSize: scaled(CARD_HEADER_FONT_SIZE, font),
    cardHeaderHeight: scaled(CARD_HEADER_HEIGHT, font),
    // The line the title is set on, and nothing more — see `TITLE_LINE_HEIGHT`.
    titleZoneHeight: titleZoneHeightFor(scaled(TITLE_FONT_SIZE, font)),
    captionFontSize: scaled(CAPTION_FONT_SIZE, font),
    captionSideGap: Math.max(4, scaled(CAPTION_SIDE_GAP, spacing)),
  }
}

/**
 * Geometry options for a section slide.
 *
 * A section has no zone tree, so what a theme moves there is the gap between
 * the two pills and the type each of them is set in — which is also everything
 * `computeSectionGeometry` needs to say how much room a line has.
 */
export function sectionGeometryForTheme(theme?: Partial<PresentationTheme>): {
  gap: number
  inset: number
  titleFontSize: number
  subtitleFontSize: number
} {
  const metrics = themeMetrics(theme)
  return {
    gap: metrics.gap,
    inset: metrics.gap,
    titleFontSize: metrics.titleFontSize,
    subtitleFontSize: metrics.sectionSubtitleFontSize,
  }
}

/**
 * Geometry options for a theme.
 *
 * The gap and the title zone are the two parts of the geometry a theme *moves*;
 * everything else about the design space is fixed. The tokens themselves ride
 * along because how small a zone may be depends on what is in it and on the
 * type the deck is set in — a card's header really is taller at a bigger font
 * scale, so the smallest card really is bigger. See `domain/contentSize.ts`.
 */
export function geometryForTheme(theme?: Partial<PresentationTheme>): {
  gap: number
  inset: number
  titleHeight: number
  metrics: ThemeMetrics
} {
  const metrics = themeMetrics(theme)
  return {
    gap: metrics.gap,
    inset: metrics.gap,
    titleHeight: metrics.titleZoneHeight,
    metrics,
  }
}
