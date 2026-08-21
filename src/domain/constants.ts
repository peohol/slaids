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

/** Deterministic, content-independent title zone. */
export const TITLE_ZONE_HEIGHT = 72
export const TITLE_FONT_SIZE = 46
export const TITLE_LINE_HEIGHT = 1.2

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
