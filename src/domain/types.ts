/**
 * Core domain model.
 *
 * Invariants enforced everywhere in the codebase:
 *  - a `split` node has children and never content
 *  - a `leaf` node may have content and never children
 *  - `children.length === weights.length`
 *  - a split has 2..10 children and all weights are finite and > 0
 */

import type { IdeaRow } from './ideas'

export type NodeId = string

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Axis = 'x' | 'y'

/* ------------------------------------------------------------------ *
 * Rich text (ProseMirror / Tiptap JSON)
 * ------------------------------------------------------------------ */

export interface RichMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface RichNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RichNode[]
  marks?: RichMark[]
  text?: string
}

export interface RichDoc {
  type: 'doc'
  content?: RichNode[]
}

/**
 * Titles use the same storage format but a restricted schema: one paragraph,
 * plain text and citations only, never manual line breaks or formatting.
 */
export type TitleDoc = RichDoc

/**
 * Where a block sits across the width it was given.
 *
 * A property of the line rather than of the words in it, which is why it is
 * stored as `textAlign` on the block node — a paragraph, a heading, or a
 * picture standing in the flow between them.
 */
export type TextAlign = 'left' | 'center' | 'right'

/* ------------------------------------------------------------------ *
 * Zone content
 * ------------------------------------------------------------------ */

/** Where content sits when it does not fill the height it is given. */
export type VerticalAlign = 'top' | 'middle' | 'bottom'

export interface Subfield {
  id: string
  doc: RichDoc
  /** Defaults to `top` when absent, which is what every older document means. */
  verticalAlign?: VerticalAlign
}

/** Body of a card. Subfields have their own internal layout semantics. */
export interface CardBody {
  axis: Axis
  weights: number[]
  subfields: Subfield[]
}

/**
 * A container divides into subfields exactly like a card body does — same type,
 * same commands, same dividers — because "a transparent card" is what a
 * container is. One subfield is the ordinary case.
 */
export interface ContainerContent {
  id: string
  kind: 'container'
  body: CardBody
}

/* ------------------------------------------------------------------ *
 * Pictures
 * ------------------------------------------------------------------ */

/** Where a caption hangs inside the picture it belongs to. */
export type CaptionPosition = 'top' | 'middle' | 'bottom'

/**
 * A caption over a picture.
 *
 * One line of text that wraps — the same restricted schema a title uses, so it
 * cannot grow lists, headings or line breaks it has no room for — in a tinted,
 * blurred box that hangs from the top edge, floats in the middle, or stands on
 * the floor of the picture.
 *
 * `color` is `null` by default and means "whatever this picture's own title
 * panel is painted with" for a `titled-image-card` — so recolouring that
 * panel's header repaints its caption too, the same inheritance a title
 * panel's header takes from its section — and the governing section's accent
 * colour directly for a plain `image`, which has no header to read. Either
 * way, a caption that was given a colour of its own keeps it regardless of
 * what the header or the section does later.
 */
export interface ImageCaption {
  doc: TitleDoc
  position: CaptionPosition
  color: string | null
}

/**
 * A picture that fills the box it is given, edge to edge.
 *
 * It always covers: the box is the frame, and whatever of the picture does not
 * fit the frame's proportions is hidden rather than letterboxed. Nothing is
 * thrown away — `focus` says which part of the picture the frame is over, from
 * `0` (top/left edge) through `0.5` (centred) to `1` (bottom/right edge), so
 * the crop is a view onto the file and can be moved at any time.
 *
 * `assetId` is `null` for a picture panel that has been created but not filled
 * yet, exactly as an empty text field is a field with nothing in it.
 */
export interface ImagePanel {
  assetId: string | null
  focus: { x: number; y: number }
  caption: ImageCaption | null
}

export interface UntitledCardContent {
  id: string
  kind: 'untitled-card'
  backgroundColor: string
  body: CardBody
}

export interface TitledCardContent {
  id: string
  kind: 'titled-card'
  /**
   * `null` means the panel carries no colour of its own and takes the governing
   * section's accent colour instead, the same way a heading with no stored
   * colour does. A card that *was* given a colour keeps it regardless of what
   * the section does later.
   */
  headerColor: string | null
  title: TitleDoc
  body: CardBody
}

/** A picture filling a whole zone: a card whose entire face is the picture. */
export interface ImageContent {
  id: string
  kind: 'image'
  image: ImagePanel
}

/**
 * A titled card whose body is a picture instead of text.
 *
 * The header is a titled card's header, down to the colour inheritance; what
 * changes is what sits under it. The picture fills the body completely — no
 * padding, no letterboxing — so the card reads as a title panel over a
 * photograph. Its caption cannot hang from the top, because the header is
 * already there.
 */
export interface TitledImageCardContent {
  id: string
  kind: 'titled-image-card'
  headerColor: string | null
  title: TitleDoc
  image: ImagePanel
}

export type ZoneContent =
  | ContainerContent
  | UntitledCardContent
  | TitledCardContent
  | ImageContent
  | TitledImageCardContent

export type ZoneContentKind = ZoneContent['kind']

/** The content kinds whose face is a picture rather than text. */
export type ImageZoneContent = ImageContent | TitledImageCardContent

/* ------------------------------------------------------------------ *
 * Layout tree
 * ------------------------------------------------------------------ */

export interface SplitNode {
  id: NodeId
  kind: 'split'
  axis: Axis
  weights: number[]
  children: LayoutNode[]
}

export interface LeafNode {
  id: NodeId
  kind: 'leaf'
  content: ZoneContent | null
}

export type LayoutNode = SplitNode | LeafNode

/* ------------------------------------------------------------------ *
 * Slides and presentations
 * ------------------------------------------------------------------ */

/**
 * An ordinary slide: a title zone that may be absent, and a tree of zones.
 *
 * `kind` is stored rather than inferred from which fields are present, so the
 * two slide kinds are told apart the same way everywhere — the schema, the
 * renderer, the commands — instead of each one guessing from a field.
 */
export interface ContentSlide {
  id: string
  kind: 'content'
  /** `null` means the slide has no title zone. */
  title: TitleDoc | null
  root: LayoutNode
}

/**
 * A section: the page that opens a part of the deck, and the page every deck
 * opens with.
 *
 * It is a slide, but not one with zones. Two lines of heading type in pills,
 * centred as one block — the heading is what a section is *for*, and the
 * subheading is optional, so a section with only a heading centres that one
 * line and a section with both centres the pair. Both lines are centred by
 * construction, which is why neither carries an alignment, and neither may
 * cite: a citation gets its number from first occurrence among the slides, and
 * a section is where the reader has not met the content yet.
 *
 * The two colours are the reason a section is more than a divider. They are
 * the deck's defaults *from here on*: every page from this section up to the
 * next one is drawn on `backgroundColor`, and every heading pill, card header
 * and caption that never had a colour picked for it is painted
 * `accentColor`. So an author restyles a whole part of a deck by recolouring
 * its section, without a single stored document changing.
 */
export interface SectionSlide {
  id: string
  kind: 'section'
  title: TitleDoc
  subtitle: TitleDoc
  /** Pills, card headers and headings that carry no colour of their own. */
  accentColor: string
  /** The page colour for this section and every slide that follows it. */
  backgroundColor: string
}

export type Slide = ContentSlide | SectionSlide

export type SlideKind = Slide['kind']

/**
 * The slides of a deck: at least one, and the first is always a section.
 *
 * "Every presentation opens with a front page" is a property of this type
 * rather than a rule each command has to remember, exactly as it was when the
 * cover was a field of its own: nothing can construct a deck whose first page
 * is not a section, because there is no value of this type that is not one.
 * What changed is that the front page is now an ordinary section slide — the
 * first of however many the deck has — so it is addressed, coloured and
 * measured by the same code as the rest.
 */
export type DeckSlides = readonly [SectionSlide, ...Slide[]]

/**
 * What is set once for the whole deck.
 *
 * The page colour is deliberately not here: it is a section's, so a deck can
 * change ground colour partway through. What is left is genuinely global —
 * two typefaces and the two scales that move every distance and every type
 * size together.
 */
export interface PresentationTheme {
  headingFontFamily: string
  bodyFontFamily: string
  /** Luft: one multiplier on every distance. See `domain/metrics.ts`. */
  spacing: number
  /** Skriftstørrelse: one multiplier on every type size. */
  fontScale: number
}

export interface Reference {
  id: string
  title: string
  authors: string
  url: string
  year: string
}

export interface SandboxItem {
  id: string
  content: ZoneContent
  createdAt: string
  note: string
}

/**
 * The ideas list is one ordered tree, one level deep: see `src/domain/ideas.ts`.
 * A category is a row in the same list as the loose ideas, so an idea that
 * belongs to nothing can sit between two categories.
 */
export type { Idea, IdeaCategory, IdeaRow } from './ideas'

/** Asset metadata. Binary data lives in the asset store, never in the JSON. */
export interface AssetRef {
  id: string
  name: string
  mimeType: string
  byteSize: number
  width: number
  height: number
  isVector: boolean
}

/**
 * Everything it takes to draw a deck: the authored slides — sections and
 * content alike, the first of them always a section — the theme they are drawn
 * in, and the references their citations point at.
 *
 * Reference numbering and the derived reference slides are computed from
 * exactly these, and nothing else — which is what lets the private
 * `Presentation` and the sanitised `SharedPresentationSnapshot` go through the
 * same renderer without a branch anywhere in it.
 */
export interface DeckSource {
  theme: PresentationTheme
  slides: DeckSlides
  references: Reference[]
}

export interface Presentation extends DeckSource {
  schemaVersion: number
  id: string
  title: string
  folderId: string | null
  sandbox: SandboxItem[]
  ideas: IdeaRow[]
  assets: AssetRef[]
  createdAt: string
  updatedAt: string
}

export interface PresentationSummary {
  id: string
  title: string
  folderId: string | null
  slideCount: number
  createdAt: string
  updatedAt: string
}

export interface Folder {
  id: string
  name: string
  createdAt: string
}

/** Layout-only template. Templates never contain slide content. */
export interface LayoutTemplate {
  id: string
  name: string
  hasTitle: boolean
  root: LayoutNode
  createdAt: string
}
