/**
 * Global design tokens for Slaids.
 *
 * Everything geometric in the app is expressed in the fixed logical design space
 * defined here. Nothing in the codebase may hardcode these numbers.
 */

/** Logical slide width. All geometry is computed in this coordinate space. */
export const SLIDE_WIDTH = 1600
/** Logical slide height (16:9 against SLIDE_WIDTH). */
export const SLIDE_HEIGHT = 900

/**
 * The single global gap. There is exactly one distance between all visible
 * content on a slide, no matter how deeply the layout tree is nested.
 */
export const G = 24

/** Inset between the slide edge and the outermost content. Equal to G by definition. */
export const SLIDE_INSET = G

/** A zone smaller than this is not usable for content and may not be created. */
export const MIN_ZONE_WIDTH = 180
export const MIN_ZONE_HEIGHT = 120

/** Splits are limited to this many children. */
export const MIN_SPLIT_CHILDREN = 2
export const MAX_SPLIT_CHILDREN = 10

/**
 * The title zone: deterministic, content-independent, and exactly one line tall.
 *
 * The height is not a number of its own — it is the line the title is set on.
 * A zone taller than that would put slack above and below the text that is not
 * a distance anybody chose: the slide would read as having two different gaps
 * over the title and one everywhere else. Deriving it from the type also keeps
 * "bigger text never lands in a box built for smaller text" true by
 * construction rather than by two constants being kept in step.
 *
 * What is left between the glyphs and the edge of the box is the font's own
 * half-leading — a few pixels, and a property of the typeface rather than a
 * spacing decision. The line height is set just above the tallest ascent plus
 * descent among the catalogue's fonts, so an accent or a descender is never
 * clipped.
 */
export const TITLE_FONT_SIZE = 40
export const TITLE_LINE_HEIGHT = 1.15

export function titleZoneHeightFor(fontSize: number): number {
  return Math.round(fontSize * TITLE_LINE_HEIGHT)
}

/**
 * The colour every pill starts out as.
 *
 * One number rather than three: the cover's pills, the header of a new titled
 * card and the pill a heading falls back to are the same blue, and a heading
 * that never had a colour picked for it does not store this value at all — it
 * reads whatever the cover currently says. See `DeckCover.pillColor`.
 */
export const DEFAULT_PILL_COLOR = '#33475b'

/**
 * The cover.
 *
 * The title is set in the slide title's own size, so a deck opens in the type
 * it continues in, and the subtitle is one clear step below it — a step, not a
 * different class of text. Both pills are padded in `em` of their own type, so
 * the two keep the same shape at every font scale and the deterministic width
 * a fit check needs is a pure function of the type size.
 */
export const COVER_SUBTITLE_FONT_SIZE = 30
export const COVER_PILL_PADDING_X_EM = 0.6
export const COVER_PILL_PADDING_Y_EM = 0.16

/** Card typography and chrome. */
export const CARD_RADIUS = 14
export const CARD_PADDING = 16
export const CARD_HEADER_HEIGHT = 52
export const CARD_HEADER_FONT_SIZE = 26
/**
 * Card depth: an ordinary drop shadow, falling into the gap around the card.
 *
 * The containment rule is about *content* — nothing a zone holds may be painted
 * outside it — and that clip lives on `.zone-content`, which is exactly the
 * zone's box. The zone element itself therefore does not need to clip, and a
 * shadow painted outside the card's border box has the gap to fall into. It
 * costs no layout: a shadow is paint, so the card still fills its zone exactly
 * and there is still one distance between two cards.
 *
 * Kept inside `G` so two neighbouring shadows meet in the gap rather than
 * reaching each other's cards, and so a card at the slide edge keeps its shadow
 * within the slide inset.
 */
export const CARD_SHADOW = '0 5px 16px rgba(0, 0, 0, 0.28), 0 1px 3px rgba(0, 0, 0, 0.20)'

/**
 * The caption over a picture.
 *
 * A caption is chrome on a photograph rather than a paragraph on a slide, so it
 * is set a step below the body text and padded in its own type — that is what
 * keeps the box the same shape at every font scale. `SIDE_GAP` is the air
 * between the box and the walls of the picture: without it the caption would
 * meet the frame, and a caption that touches the edge reads as a band across
 * the picture rather than as a label on it.
 *
 * The tint is deliberately weak and the blur deliberately small: the point is
 * that the picture stays visible through the caption. Text is white with the
 * standard shadow whatever the tint, because 30 % of a colour over an unknown
 * photograph is not a background anything can be contrasted against.
 */
export const CAPTION_FONT_SIZE = 19
export const CAPTION_PADDING_X_EM = 0.8
export const CAPTION_PADDING_Y_EM = 0.32
export const CAPTION_SIDE_GAP = 12
export const CAPTION_RADIUS = 12
export const CAPTION_TINT_OPACITY = 0.3
export const CAPTION_BLUR_PX = 3

/**
 * How close to the middle a crop has to be dragged before it snaps there.
 *
 * In logical pixels of the picture's own overflow, so the pull feels the same
 * whether the hidden part is a sliver or half the file. Centred is the crop a
 * picture starts at and the one it is hardest to find again by hand, so it is
 * the one position that is given a magnet.
 */
export const IMAGE_FOCUS_SNAP_PX = 10

/**
 * Dividers between subfields inside a card.
 *
 * Deliberately independent of the card's header colour: a divider is structure,
 * not decoration, and tinting it made every card read as a different component.
 */
export const CARD_DIVIDER_COLOR = 'rgba(0, 0, 0, 0.14)'

/** Body typography inside cards and containers. */
export const BODY_FONT_SIZE = 21
export const BODY_LINE_HEIGHT = 1.45
export const HEADING_FONT_SIZE = 24

/** Gap between subfields inside a single card body (independent of the slide gap). */
export const SUBFIELD_GAP = 14
export const SUBFIELD_DIVIDER_THICKNESS = 2

/**
 * Space below a block of text, and the wider space below a heading.
 *
 * Both are scaled by the theme's `spacing`; `metrics.ts` owns the derivation and
 * the stylesheet reads the result as a custom property, so the estimator and
 * the DOM always agree about how much room a paragraph takes.
 */
export const BLOCK_SPACING = 6
export const HEADING_SPACING = 10
export const LIST_INDENT = 24

/**
 * Fallback typography for paginating reference slides.
 *
 * Only used when no measurer is supplied. The app always supplies one — a
 * reference entry is a plain paragraph in a container and renders with the
 * deck's body typography, so paginating it with numbers of its own is how a
 * bibliography ends up one entry too long for its column.
 */
export const REFERENCE_FONT_SIZE = 18
export const REFERENCE_LINE_HEIGHT = 1.35
export const REFERENCE_ENTRY_GAP = 10
export const REFERENCE_MAX_COLUMNS = 3

/**
 * The rendered citation pill, in `em` of the surrounding body text.
 *
 * These mirror `.rd-citation` in `styles/slide.css` and exist so the headless
 * estimator can model a citation label the same way the browser draws it —
 * a citation that renders as `10` is wider than one that renders as `9`, and
 * the fit gate has to see that. Keep the two in sync.
 */
export const CITATION_FONT_SCALE = 0.58
export const CITATION_MIN_WIDTH_EM = CITATION_FONT_SCALE * 1.55
export const CITATION_PADDING_EM = CITATION_FONT_SCALE * 0.7
export const CITATION_MARGIN_EM = 0.12

/** Tolerance used for floating point geometry comparisons. */
export const GEOMETRY_EPSILON = 1e-6

/**
 * How many logical pixels of overflow count as "still fits".
 *
 * Sub-pixel rounding in the browser makes an exact zero unreachable, so every
 * fit consumer — the estimator, the DOM measurer and the regression guard —
 * shares this one tolerance rather than inventing its own.
 */
export const FIT_TOLERANCE = 0.75

/** Default presentation background (from the original vision: #678). */
export const DEFAULT_BACKGROUND_COLOR = '#667788'

/**
 * The largest file Slaids accepts as an asset.
 *
 * One number for every door into the asset store — the upload dialog and the
 * agent operations — because "how big may a picture be" is a property of the
 * product, not of whoever happens to be uploading.
 */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024

/**
 * The progress indicator.
 *
 * Every page but the cover carries one, and it is not optional: a deck that
 * could be laid out without it and have it switched on later would be a deck
 * whose slides suddenly lost a strip of room they were already full of. Making
 * it unconditional is what lets the geometry engine reserve the strip once, for
 * every slide, before any content is ever placed.
 *
 * The bar is flush with the bottom edge and with both sides — it has no gap
 * below it and none beside it — and exactly one gap above it, which is the
 * deck's own `G`. That is why the reservation is `PROGRESS_BAR_HEIGHT` and not
 * `PROGRESS_BAR_HEIGHT + G`: the gap above it is the bottom inset the content
 * area already had.
 *
 * The height is a thickness rather than a distance between two things, so the
 * theme's `spacing` does not scale it, exactly as it does not scale a card's
 * radius or a divider's stroke.
 */
export const PROGRESS_BAR_HEIGHT = 10
/** The track behind the fill: the same colour, carrying less of it. */
export const PROGRESS_TRACK_OPACITY = 0.3
/** How long the fill takes to reach the position a page turn gave it. */
export const PROGRESS_TRANSITION_MS = 600
