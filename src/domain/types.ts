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
import type { ImageDeposit } from './imageDeposit'
import type { PlannedImage } from './imagePlan'
import type { InteractiveStyleContract, TitledCardStyle } from './constants'

export type NodeId = string

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Axis = 'x' | 'y'

/**
 * A width and a height with no position.
 *
 * Here rather than in `geometry.ts` because it is the answer two modules give:
 * the geometry engine reports how small a subtree can be, and `contentSize.ts`
 * reports how small a kind of content may be drawn. One shape, so the second
 * can be fed straight into the first.
 */
export interface Size {
  width: number
  height: number
}

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
  /**
   * Absent means `DEFAULT_VERTICAL_ALIGN` — a field nobody has aligned, whether
   * it was made yesterday or before the property existed. Storing the default
   * instead would freeze it into every document and make "no choice" and "chose
   * exactly this" the same field.
   */
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
  /**
   * Which number in the deck's image deposit this panel is waiting for.
   *
   * Internal metadata, never drawn and never published: it is how a file named
   * `3.png` finds the one zone that was ordered as picture 3, without that
   * mapping depending on where the zone sits today. The panel is the element,
   * so the number lives on the element rather than in a list beside it — a
   * zone that is deleted, emptied or turned into text takes its number with
   * it, which is exactly what makes a broken deposit detectable.
   *
   * Absent on every panel that is not part of an open deposit, and stripped
   * from all of them the moment the deposit is completed or abandoned. See
   * `domain/imageDeposit.ts`.
   */
  depositIndex?: number
}

/**
 * Deliberate air: a zone that is part of the composition and draws nothing.
 *
 * It carries no fields, no title, no file and no payload of any kind, and it
 * has no minimum size — there is nothing in it that a small rectangle could
 * hide, so it may be as small as the geometry allows.
 *
 * Not the same thing as a leaf with no content, and the difference is
 * intentional. `content: null` is a hole the author has not filled: the editor
 * offers the content picker in it, and an agent reads it as `empty: true`. This
 * is a decision the author made, and the only thing either of them can do with
 * it is change their mind. The two are told apart everywhere by exactly that —
 * whether there is a content object — and never by one layer guessing from
 * what a zone happens to draw.
 */
export interface NegativeSpaceContent {
  id: string
  kind: 'negative-space'
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
  | NegativeSpaceContent
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

/**
 * An interactive slide: one self-contained miniapp, delivered as a single
 * `.html` file with everything it needs — markup, styles and scripts —
 * embedded in it.
 *
 * It is a slide of its own kind rather than a content slide with a special
 * zone, because nothing about it is a zone: there is no layout tree to split,
 * no text to fit and no title zone. What the deck stores is the file's source
 * as ordinary data, and *only* as data. Slaids never parses `html` into its own
 * document, never evaluates it, and never serves it from its own origin — a
 * miniapp runs only inside a sandboxed frame that the audience has expressly
 * activated, and only on a surface built for that (see
 * `src/ui/interactive/`). Everywhere else — thumbnails, the editor's stage
 * before activation, the rendered preview, an export — the slide is a static
 * cover: its name, a badge saying what it is, and the button that would start
 * it.
 *
 * `html` is a bounded field: `MAX_INTERACTIVE_HTML_BYTES` of UTF-8 per slide,
 * and `MAX_INTERACTIVE_HTML_TOTAL_BYTES` across the deck, measured as bytes and
 * never as string length. `name` is what the cover shows and `fileName` is
 * what was uploaded; both are plain text and are drawn as text.
 */
export interface InteractiveSlide {
  id: string
  kind: 'interactive'
  name: string
  fileName: string
  /** The complete file, decoded as UTF-8. Data, never markup Slaids renders. */
  html: string
  /**
   * The design contract the file was written against.
   *
   * Stored rather than assumed, so Slaids can change what an unstyled miniapp
   * looks like without changing how one that already exists looks. See
   * `INTERACTIVE_STYLE_CONTRACTS`.
   */
  styleContract: InteractiveStyleContract
}

export type Slide = ContentSlide | SectionSlide | InteractiveSlide

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
  /**
   * Whether cards, pictures, section pills and miniapp frames cast a drop
   * shadow (`CARD_SHADOW`). Paint only: it moves nothing and hides nothing.
   */
  boxShadows: boolean
  /** How a card with a title draws it. See `TITLED_CARD_STYLES`. */
  titledCardStyle: TitledCardStyle
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

/**
 * One planned picture: see `domain/imagePlan.ts`, which owns the rules about
 * what the entries mean and how they become a brief.
 */
export type { PlannedImage } from './imagePlan'

/**
 * The state of the deck's image deposit: see `domain/imageDeposit.ts`, which
 * owns the rules about when it may be opened, broken and closed.
 */
export type { ImageDeposit } from './imageDeposit'

/** Asset metadata. Binary data lives in the asset store, never in the JSON. */
export interface AssetRef {
  id: string
  name: string
  mimeType: string
  byteSize: number
  width: number
  height: number
  isVector: boolean
  /**
   * SHA-256 of the stored bytes, as hex, once somebody has computed it — see
   * `domain/assetHash.ts`. Absent on a file nobody has hashed yet, and never
   * proof of anything on its own: a reader that has to know whether two files
   * are the same reads the stored bytes, and uses this only to skip a candidate
   * it rules out. So a document from before the field existed is exactly as
   * good as one written today, and a stale value is harmless.
   */
  contentHash?: string
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
  /**
   * The visual premise every picture in this deck shares.
   *
   * One piece of editorial text for the whole presentation — how the pictures
   * should look, not what they should show — which becomes the «FELLES
   * BILDEKONTEKST» section of the deck's one generated image brief. It is
   * never drawn on a slide and never published: like the sandbox and the ideas
   * list, it is the working copy's, not the audience's.
   *
   * Absent means the deck has none. Stored as "missing" rather than as an empty
   * string so that adding the field wrote nothing into a single existing
   * document — the same reason `AssetRef.contentHash` is optional.
   */
  imageContext?: string
  /**
   * What each planned picture in this deck is supposed to show.
   *
   * The structured half of the image workflow: `imageContext` is the one shared
   * context, this is one entry per reserved picture zone, and the copy-paste
   * brief the author hands an image generator is composed from the two plus
   * the zones' own geometry — see `domain/imagePlan.ts`. Nothing here is drawn
   * and nothing here is published.
   *
   * Absent means nothing has been planned, for the same reason `imageContext` is
   * optional: adding the field wrote nothing into a document that exists.
   */
  imagePlan?: PlannedImage[]
  /**
   * Where the deck is in handing its planned pictures over to a person.
   *
   * The plan says what the pictures are; this says whether Slaids is still
   * expecting the files. `pending` is a deck whose picture zones carry deposit
   * numbers and can be filled in one go from a folder of `1.png`, `2.jpg`, …;
   * `completed` and `abandoned` are both final, and neither can become
   * `pending` again — see `domain/imageDeposit.ts`.
   *
   * Absent means the deck never had one, which is not the same as `abandoned`:
   * a deck that never planned pictures has nothing to abandon.
   */
  imageDeposit?: ImageDeposit
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
  /**
   * How much room the presentation takes in the store: the document itself and
   * every file it lists. See `presentationByteSize`.
   */
  byteSize: number
  createdAt: string
  updatedAt: string
  /**
   * When it was moved to the trash, or `null` while it is in the library.
   *
   * Storage metadata rather than a field of the document, deliberately: the
   * editor saves the document it holds, and a trashed deck that is still open
   * in another tab must not come back out of the trash because that tab
   * autosaved. So the stores keep it beside the document, and a save never
   * writes it.
   */
  deletedAt: string | null
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
