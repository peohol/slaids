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

/* ------------------------------------------------------------------ *
 * Zone content
 * ------------------------------------------------------------------ */

/** What lives inside a transparent container zone. */
export type ContainerPayload =
  /**
   * A container divides into subfields exactly like a card body does — same
   * type, same commands, same dividers — because "a transparent card" is what
   * a container is. One subfield is the ordinary case.
   */
  | { type: 'fields'; body: CardBody }
  | { type: 'asset'; assetId: string; fit: 'contain' | 'cover' }

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

export interface ContainerContent {
  id: string
  kind: 'container'
  payload: ContainerPayload
  /** Only meaningful for an `asset` payload; text aligns per subfield. */
  verticalAlign?: VerticalAlign
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
  headerColor: string
  title: TitleDoc
  body: CardBody
}

export type ZoneContent = ContainerContent | UntitledCardContent | TitledCardContent

export type ZoneContentKind = ZoneContent['kind']

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

export interface Slide {
  id: string
  /** `null` means the slide has no title zone. */
  title: TitleDoc | null
  root: LayoutNode
}

export interface PresentationTheme {
  backgroundColor: string
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
 * Everything it takes to draw a deck: the authored slides, the theme they are
 * drawn in, and the references their citations point at.
 *
 * Reference numbering and the derived reference slides are computed from
 * exactly these three, and nothing else — which is what lets the private
 * `Presentation` and the sanitised `SharedPresentationSnapshot` go through the
 * same renderer without a branch anywhere in it.
 */
export interface DeckSource {
  theme: PresentationTheme
  slides: Slide[]
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
