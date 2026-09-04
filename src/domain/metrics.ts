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
  CARD_HEADER_FONT_SIZE,
  CARD_HEADER_HEIGHT,
  CARD_PADDING,
  COVER_SUBTITLE_FONT_SIZE,
  G,
  HEADING_FONT_SIZE,
  HEADING_SPACING,
  LIST_INDENT,
  SUBFIELD_GAP,
  TITLE_FONT_SIZE,
  TITLE_ZONE_HEIGHT,
} from './constants'
import type { PresentationTheme } from './types'

export interface ThemeMetrics {
  /** The single global gap, and the slide inset that equals it by definition. */
  gap: number
  cardPadding: number
  subfieldGap: number
  /** Space below a paragraph, list or quote. */
  blockSpacing: number
  /** Space below a heading — the distance from a heading to the text it heads. */
  headingSpacing: number
  listIndent: number
  bodyFontSize: number
  headingFontSize: number
  titleFontSize: number
  /** The cover's subtitle: a step below the title, scaled with everything else. */
  coverSubtitleFontSize: number
  cardHeaderFontSize: number
  cardHeaderHeight: number
  titleZoneHeight: number
}

export const SPACING_RANGE = { min: 0.6, max: 2 } as const
export const FONT_SCALE_RANGE = { min: 0.7, max: 1.6 } as const

export const DEFAULT_SPACING = 1
export const DEFAULT_FONT_SCALE = 1

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
  { label: 'Tett', value: 0.75 },
  { label: 'Normal', value: DEFAULT_SPACING },
  { label: 'Luftig', value: 1.3 },
  { label: 'Ekstra luftig', value: 1.6 },
]

export const FONT_SCALE_PRESETS: readonly ThemeScalePreset[] = [
  { label: 'Liten', value: 0.85 },
  { label: 'Normal', value: DEFAULT_FONT_SCALE },
  { label: 'Stor', value: 1.15 },
  { label: 'Ekstra stor', value: 1.3 },
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
    headingSpacing: Math.max(2, scaled(HEADING_SPACING, spacing)),
    listIndent: Math.max(8, scaled(LIST_INDENT, spacing)),
    bodyFontSize: scaled(BODY_FONT_SIZE, font),
    headingFontSize: scaled(HEADING_FONT_SIZE, font),
    titleFontSize: scaled(TITLE_FONT_SIZE, font),
    coverSubtitleFontSize: scaled(COVER_SUBTITLE_FONT_SIZE, font),
    cardHeaderFontSize: scaled(CARD_HEADER_FONT_SIZE, font),
    cardHeaderHeight: scaled(CARD_HEADER_HEIGHT, font),
    titleZoneHeight: scaled(TITLE_ZONE_HEIGHT, font),
  }
}

/**
 * Geometry options for the cover.
 *
 * The cover has no zone tree, so what a theme moves there is the gap between
 * the two pills and the type each of them is set in — which is also everything
 * `computeCoverGeometry` needs to say how much room a line has.
 */
export function coverGeometryForTheme(theme?: Partial<PresentationTheme>): {
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
    subtitleFontSize: metrics.coverSubtitleFontSize,
  }
}

/**
 * Geometry options for a theme.
 *
 * The gap and the title zone are the two parts of the geometry a theme moves;
 * everything else about the design space is fixed.
 */
export function geometryForTheme(theme?: Partial<PresentationTheme>): {
  gap: number
  inset: number
  titleHeight: number
} {
  const metrics = themeMetrics(theme)
  return { gap: metrics.gap, inset: metrics.gap, titleHeight: metrics.titleZoneHeight }
}
