/**
 * Global design tokens for Slaids.
 *
 * Everything geometric in the app is expressed in the fixed logical design space
 * defined here. Nothing in the codebase may hardcode these numbers.
 */

import type { TextAlign, VerticalAlign } from './types'

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

/**
 * The narrowest a column of running text may be.
 *
 * There is no longer one minimum size every zone has to clear: how small a zone
 * may be is decided by what is *in* it, and `domain/contentSize.ts` owns that
 * answer. What is left here are the two judgements that arithmetic cannot make.
 *
 * This is the first: about a dozen characters at the default type size, below
 * which a paragraph stops being a paragraph and becomes a column of hyphenated
 * fragments. It is deliberately a flat number rather than a multiple of the
 * type size — the heights a kind of content needs are chrome that really is
 * drawn and really does scale, while «how narrow before text stops reading as
 * text» is a judgement about the reader, not about the box.
 */
export const MIN_TEXT_WIDTH = 180

/**
 * The smallest square a picture is still a picture in.
 *
 * The second judgement: below this a photograph in a deck is an icon, and the
 * crop the author chose is no longer visible in it. A picture has no chrome to
 * derive a minimum from — it fills whatever frame it is given — so this is the
 * whole rule for a picture zone, and the body half of a titled picture card.
 */
export const MIN_IMAGE_SIZE = 120

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
 * One number rather than three: a section's pills, the header of a new titled
 * card and the pill a heading falls back to are the same blue, and a heading
 * that never had a colour picked for it does not store this value at all — it
 * reads whatever the governing section currently says. See
 * `SectionSlide.accentColor`.
 */
export const DEFAULT_PILL_COLOR = '#33475b'

/**
 * Section slides — the front page included, since it is the first of them.
 *
 * The heading is set in the slide title's own size, so a deck opens in the type
 * it continues in, and the subheading is one clear step below it — a step, not
 * a different class of text. Both pills are padded in `em` of their own type,
 * so the two keep the same shape at every font scale and the deterministic
 * width a fit check needs is a pure function of the type size.
 */
export const SECTION_SUBTITLE_FONT_SIZE = 30
export const SECTION_PILL_PADDING_X_EM = 0.6
export const SECTION_PILL_PADDING_Y_EM = 0.16

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
 * Hvordan et kort med tittel tegner tittelen – et temavalg, så alle slike kort
 * i et dekk ser like ut.
 *
 *  - `joined`: header og innhold er ett kort, headeren over hele bredden.
 *  - `tab`: innholdet er et eget kort, avrundet hele veien rundt, og headeren
 *    er en farget fane like bred som tittelen, som står opp bak det. Aldri
 *    bredere enn innholdet minus én hjørneradius (`CARD_RADIUS`), så
 *    innholdets avrundede hjørner alltid synes.
 *  - `floating`: headeren er et eget kort like bredt som tittelen, høyst hele
 *    bredden, ett globalt gap over innholdet.
 *
 * Det første er slik alle dekk lagret før valget fantes, ser ut.
 */
export const TITLED_CARD_STYLES = ['joined', 'tab', 'floating'] as const

export type TitledCardStyle = (typeof TITLED_CARD_STYLES)[number]

export const DEFAULT_TITLED_CARD_STYLE: TitledCardStyle = 'joined'

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
 * A picture standing in the text, as a share of the column it sits in.
 *
 * A share and not a length: 100 % is exactly the field, so a picture can never
 * grow wider than the text around it, and the height follows from the file's
 * own proportions rather than being set separately — which is what keeps a
 * picture from being squashed no matter how the handle is dragged. The floor is
 * the point below which a picture stops being one, and the default is half the
 * column, so a new picture leaves room for the words beside it.
 *
 * One place, because both doors write the same node: the resize handle in the
 * editor, and the `image` block in the agent's text format.
 */
export const INLINE_IMAGE_MIN_WIDTH_PERCENT = 10
export const INLINE_IMAGE_MAX_WIDTH_PERCENT = 100
export const INLINE_IMAGE_DEFAULT_WIDTH_PERCENT = 50

/**
 * The proportions a picture is drawn with when the document does not say.
 *
 * The same fallback the stylesheet applies (`--slaids-image-aspect` in
 * `slide.css`), so the headless estimator reserves the box the browser will
 * actually draw. A stored `aspect` always wins: it is the file's own ratio,
 * taken from the bitstream when the file was stored.
 */
export const INLINE_IMAGE_DEFAULT_ASPECT = 16 / 9

/**
 * Dividers between subfields inside a card.
 *
 * Deliberately independent of the card's header colour: a divider is structure,
 * not decoration, and tinting it made every card read as a different component.
 */
export const CARD_DIVIDER_COLOR = 'rgba(0, 0, 0, 0.14)'

/**
 * The kinds of block whose unaligned default differs: running text in a body
 * field, an accent (the heading pill), a picture in the flow, and a one-line
 * title — a slide title, a card title, a caption, a section's lines.
 */
export type AlignableBlock = 'text' | 'accent' | 'image' | 'title'

/**
 * Where content sits when nobody has said otherwise, on both axes.
 *
 * Running text reads from the left: a paragraph or a list is read line by line,
 * and a ragged left edge makes every line start somewhere new. A label is the
 * opposite case. A title and an accent are a line or two set apart from the
 * text, and centring is what sets them apart — so they, and a picture standing
 * among the text, start from the middle. Vertically every field starts from the
 * middle: a field holds a few lines in a box that is usually taller than they
 * are, and text pinned to the top of it reads as an accident rather than as a
 * decision. An author who wants something else picks it, which is what stores
 * an alignment.
 *
 * Both are read as the meaning of *absent*, never written into new content:
 * that is what lets the default move without rewriting a single document, and
 * what keeps a field that was deliberately aligned aligned. The editor, the
 * static renderer and the agent's reading all resolve absent through these
 * constants, so no two of them can disagree about what an unaligned field looks
 * like.
 */
export const DEFAULT_TEXT_ALIGN: Readonly<Record<AlignableBlock, TextAlign>> = {
  text: 'left',
  accent: 'center',
  image: 'center',
  title: 'center',
}
export const DEFAULT_VERTICAL_ALIGN: VerticalAlign = 'middle'

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
/**
 * Space below an ordinary paragraph — more air than `BLOCK_SPACING` gives a
 * list or a quote, so consecutive paragraphs read as separate thoughts, but
 * short of a full blank line's worth of space.
 */
export const PARAGRAPH_SPACING = 10
export const HEADING_SPACING = 10
export const LIST_INDENT = 24

/**
 * Fallback typography for paginating reference slides.
 *
 * `REFERENCE_FONT_SIZE`/`REFERENCE_LINE_HEIGHT` are only used when no measurer
 * is supplied. The app always supplies one — a reference entry is a plain
 * paragraph in a container and renders with the deck's body typography, so
 * paginating it with numbers of its own is how a bibliography ends up one
 * entry too long for its column.
 *
 * `REFERENCE_ENTRY_GAP` has no such stand-in: it is the one base value for the
 * space below a reference entry, wider than an ordinary paragraph's so a
 * bibliography's entries stay visually separate. `themeMetrics` scales it into
 * `referenceEntryGap`, which both the real measurer (`buildReferenceSlides`)
 * and the stylesheet (`--slaids-reference-gap`) read, so pagination can never
 * plan for a gap the page draws differently.
 */
export const REFERENCE_FONT_SIZE = 18
export const REFERENCE_LINE_HEIGHT = 1.35
export const REFERENCE_ENTRY_GAP = 20
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
 * How many file pixels the optimiser keeps per logical pixel a picture is shown
 * at.
 *
 * The slide is `SLIDE_WIDTH × SLIDE_HEIGHT` logical pixels and is drawn scaled
 * to whatever screen shows it, so a picture's *required* size is its displayed
 * size in that space times this factor: two pixels per logical pixel is what a
 * high-DPI screen draws, and leaves room for a moderate later enlargement of
 * the frame. Below it a picture on such a screen would be visibly soft; far
 * above it the extra pixels are never drawn by anything. See
 * `domain/imageOptimization.ts`.
 */
export const OPTIMIZATION_PIXEL_DENSITY = 2

/**
 * The largest miniapp an interactive slide may carry, in bytes of UTF-8.
 *
 * Bytes and not characters: a file full of three-byte glyphs is three times
 * the size its `string.length` suggests, and what every transport moves is the
 * encoded form. The source is stored *inside* the presentation document rather
 * than beside it as an asset, so it rides along with every save, every share
 * snapshot and every agent call that carries the deck — which is why the number
 * is small next to `MAX_ASSET_BYTES`, and why there is a second, deck-wide
 * bound below it.
 *
 * Both are checked in one place, `domain/interactive.ts`, for every door a
 * file can come through: the upload dialog, a replacement, and the agent
 * operations.
 */
export const MAX_INTERACTIVE_HTML_BYTES = 2 * 1024 * 1024

/**
 * How much miniapp source one presentation may hold in total.
 *
 * The document is serialised whole on every autosave, published whole as the
 * share snapshot, and read whole by every agent operation — so a deck full of
 * two-megabyte apps would be a deck that saves, shares and loads slowly long
 * before any single file broke a rule. Three maximum-size apps is the budget:
 * generous for a deck, and still well inside what the row, the share endpoint
 * and the browser handle comfortably.
 */
export const MAX_INTERACTIVE_HTML_TOTAL_BYTES = 3 * MAX_INTERACTIVE_HTML_BYTES

/**
 * The progress indicator.
 *
 * Every page but the front page carries one, and it is not optional: a deck that
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

/**
 * The committed zone ratio.
 *
 * A ratio is what the author reads and types — `1 : 2 : 1`, never
 * `0.3125 : 0.625 : 0.3125` — so the numbers a finished layout is stored with
 * are integers in this range, and nothing else. The bound is what makes the
 * ladder of representable layouts finite and therefore snappable: a drag ends
 * on the nearest rung rather than wherever the pointer happened to stop, and
 * two decks that look the same are written down the same way.
 *
 * Deliberately not `MAX_SPLIT_CHILDREN`, which is also ten: how many subzones a
 * split may have and how lopsided two of them may be are two different limits
 * that happen to share a number today.
 */
export const MIN_ZONE_RATIO = 1
export const MAX_ZONE_RATIO = 10

/**
 * Which version of Slaids' design contract a miniapp was written against.
 *
 * A miniapp is drawn *inside* a presentation, so Slaids gives it the deck's
 * colours, type and spacing as CSS custom properties and a base stylesheet
 * built from them — see `ui/interactive/styleContract.ts` and
 * `docs/INTERACTIVE_MINIAPPS.md`. That is a published surface: an app written
 * against it has real CSS depending on what those variables are called and on
 * what an unstyled `<button>` looks like.
 *
 * So it is versioned, and the version is stored on the slide rather than
 * assumed. When the default CSS has to change in a way an existing app would
 * notice, the change is a *new* version: v1's sheet stays exactly as it is and
 * keeps being served to every slide that says `1`, and only a deliberate
 * upgrade moves a slide to the new one. Nothing about a stored app changes
 * under it, which is the whole point — the file is the author's, and Slaids
 * does not rewrite it.
 *
 * Adding a version is therefore: a number in this list, a stylesheet under it
 * in the contract registry, and a migration only if the *stored* shape changes.
 */
export const INTERACTIVE_STYLE_CONTRACTS = [1] as const

export type InteractiveStyleContract = (typeof INTERACTIVE_STYLE_CONTRACTS)[number]

/** What a slide made today is written against. */
export const CURRENT_INTERACTIVE_STYLE_CONTRACT: InteractiveStyleContract = 1

/* ------------------------------------------------------------------ *
 * Editorial text: the deck's image brief and its image plan
 * ------------------------------------------------------------------ */

/**
 * The longest the deck's shared image context may be, in characters.
 *
 * One context per presentation — the shared visual premise every picture in
 * the deck is made against — so it is a paragraph or two, not a style guide.
 * The bound is here because the text rides inside the presentation document on
 * every save and every agent call, exactly like a miniapp's source, and because
 * a field with no bound is a field somebody eventually pastes a book into.
 * Characters rather than bytes: this is prose a person writes and reads back,
 * and the number is what a refusal has to be able to state in the same unit the
 * writer counts in.
 */
export const MAX_IMAGE_CONTEXT_CHARS = 8000

/**
 * The longest one field of a planned picture may be, in characters.
 *
 * A planned picture is four short paragraphs — motif, framing, requirements,
 * things to avoid — and the same reasoning as `MAX_IMAGE_CONTEXT_CHARS` applies
 * to each of them: they ride inside the document, and an unbounded field is a
 * field somebody pastes a book into.
 */
export const MAX_PLANNED_IMAGE_FIELD_CHARS = 2000

/**
 * The text fields of a planned picture, in the order the brief prints them.
 */
export const PLANNED_IMAGE_FIELDS = ['subject', 'composition', 'requirements', 'avoid'] as const

export type PlannedImageField = (typeof PLANNED_IMAGE_FIELDS)[number]

/**
 * The two a planned picture cannot be without, and why exactly these two.
 *
 * The motif is what the entry *is*: it is the field that has to differ between
 * two pictures, and an entry without one numbers a picture with nothing to
 * show. The composition is what the zone's shape is checked against — without
 * it `ASPECT_MISMATCH` has nothing to read, so the plan cannot be checked
 * against the deck at all, which is the one thing that model exists to do.
 *
 * The other two are legitimately empty. Demanding them would produce «ingenting
 * spesielt å unngå» in every entry, which is filler that makes the brief longer
 * and says less.
 *
 * Here rather than in `imagePlan.ts` because three surfaces enforce it and one
 * of them is the persisted document's schema, which everything else loads
 * before `imagePlan.ts` exists. See `plannedImagesRefusal`, `plannedImageSchema`
 * and `plan_deck_images`.
 */
export const REQUIRED_PLANNED_IMAGE_FIELDS: readonly PlannedImageField[] = [
  'subject',
  'composition',
]

/** Whether a required field actually says something. Whitespace is not something. */
export function plannedImageFieldIsBlank(value: string): boolean {
  return value.trim() === ''
}

/**
 * What each field is, in one short phrase, for a refusal that has to name one.
 *
 * A `Record` over every field rather than only the required ones, and that is
 * the point: adding a field to `PLANNED_IMAGE_FIELDS` is a type error here
 * until it is named, so a refusal can never end up with nothing to say about a
 * field somebody later made required.
 */
export const PLANNED_IMAGE_FIELD_LABELS: Record<PlannedImageField, string> = {
  subject: 'et motiv',
  composition: 'komposisjon og utsnitt',
  requirements: 'faglige krav',
  avoid: 'hva som skal unngås',
}

/**
 * The most pictures one deck may plan.
 *
 * A bound rather than a design rule: the brief is one message an author pastes
 * into a chat window, and a plan past this is a plan no image generator is
 * going to execute in one go anyway.
 */
export const MAX_PLANNED_IMAGES = 60
