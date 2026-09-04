/**
 * Presentation and slide factories plus small pure queries.
 */

import { DEFAULT_BACKGROUND_COLOR, DEFAULT_PILL_COLOR } from './constants'
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT } from './fonts'
import { DEFAULT_FONT_SCALE, DEFAULT_SPACING } from './metrics'
import { remapAssetIds } from './docs'
import { newAssetId, newPresentationId, newSandboxId, newSlideId } from './ids'
import { cloneContentWithNewIds, cloneSubtreeWithNewIds, createLeaf } from './layout'
import { titleDoc } from './richdoc'
import { CURRENT_SCHEMA_VERSION } from './schema'
import type {
  DeckCover,
  LayoutNode,
  Presentation,
  PresentationSummary,
  PresentationTheme,
  Slide,
} from './types'

export function defaultTheme(): PresentationTheme {
  return {
    backgroundColor: DEFAULT_BACKGROUND_COLOR,
    headingFontFamily: DEFAULT_HEADING_FONT,
    bodyFontFamily: DEFAULT_BODY_FONT,
    spacing: DEFAULT_SPACING,
    fontScale: DEFAULT_FONT_SCALE,
  }
}

/**
 * The cover a deck starts with.
 *
 * The deck's own name is the obvious first cover title — it is the one piece of
 * text the author has already written — and the subtitle is left empty because
 * nobody has written it yet. Both are ordinary documents from there on.
 */
export function createCover(title = '', subtitle = ''): DeckCover {
  return {
    title: titleDoc(title),
    subtitle: titleDoc(subtitle),
    pillColor: DEFAULT_PILL_COLOR,
  }
}

export function createSlide(options: { hasTitle?: boolean; root?: LayoutNode; title?: string } = {}): Slide {
  const hasTitle = options.hasTitle ?? true
  return {
    id: newSlideId(),
    title: hasTitle ? titleDoc(options.title ?? '') : null,
    root: options.root ?? createLeaf(),
  }
}

export interface CreatePresentationInput {
  title: string
  theme?: Partial<PresentationTheme>
  folderId?: string | null
  firstSlideHasTitle?: boolean
  /** Defaults to the presentation's own title. */
  coverTitle?: string
  coverSubtitle?: string
}

export function createPresentation(input: CreatePresentationInput): Presentation {
  const now = new Date().toISOString()
  const title = input.title.trim() || 'Uten tittel'
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newPresentationId(),
    title,
    folderId: input.folderId ?? null,
    theme: { ...defaultTheme(), ...input.theme },
    cover: createCover(input.coverTitle ?? title, input.coverSubtitle),
    slides: [createSlide({ hasTitle: input.firstSlideHasTitle ?? true })],
    references: [],
    sandbox: [],
    // No seeded categories: an empty list says what it is for, and a category
    // is something you make when you have enough notes to want one.
    ideas: [],
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** What a copy is called when nobody named it. */
export function copyTitleFor(title: string): string {
  return `${title} (kopi)`
}

export interface DuplicatedPresentation {
  presentation: Presentation
  /**
   * Source asset id → the copy's own asset id.
   *
   * Handed out rather than kept inside, because the document is only half of a
   * duplication: somebody has to move the bytes too, and the map is the only
   * thing that says which file becomes which. See `persistence/library.ts`.
   */
  assetIds: Map<string, string>
}

/**
 * A deck copied whole, with every identity inside it made new.
 *
 * Pure: it produces a document and a map, writes nothing and reads nothing. The
 * two writes a real duplication needs — the document, then the files — are the
 * repository's half of the job.
 *
 * Two rules decide what is renewed and what is kept, and they are not the same
 * rule:
 *
 *  - **Asset ids are renewed because they are global.** An asset row is keyed by
 *    its id alone, whichever presentation it belongs to, and files are deleted
 *    with the deck that owns them. A copy that pointed at the original's files
 *    would be one deletion away from a deck full of missing pictures, so the
 *    files are copied and the document is remapped onto the copies.
 *  - **Everything inside the document is renewed because a copy is a separate
 *    object.** Slides, zones, content, subfields and sandbox items all get fresh
 *    ids, so nothing an editor or an agent addresses in one deck can be the same
 *    thing in the other. It is stricter than storage requires — those ids are
 *    only ever looked up within one document — and the strictness is the point:
 *    "no identity is shared with the original" is a property that can be checked,
 *    where "shared, but only where it happens not to matter" is one that has to
 *    be re-argued every time either side grows a feature.
 *
 * Reference and idea ids are the deliberate exception. A citation names its
 * reference by id from inside rich text, so renewing one means rewriting every
 * citation that points at it — the copy would be identical either way, and the
 * only thing gained is a rename that can go wrong.
 */
export function duplicatePresentationDocument(
  source: Presentation,
  options: { title?: string } = {},
): DuplicatedPresentation {
  const now = new Date().toISOString()
  const assetIds = new Map(source.assets.map((asset) => [asset.id, newAssetId()]))
  const title = options.title?.trim() || copyTitleFor(source.title)

  const copy: Presentation = {
    ...source,
    id: newPresentationId(),
    title,
    createdAt: now,
    updatedAt: now,
    // Cloned rather than shared: two documents that point at one cover object
    // are one edit away from being the same cover.
    cover: structuredClone(source.cover),
    slides: source.slides.map((slide) => ({
      ...slide,
      id: newSlideId(),
      title: slide.title ? (structuredClone(slide.title) as typeof slide.title) : null,
      root: cloneSubtreeWithNewIds(slide.root),
    })),
    sandbox: source.sandbox.map((item) => ({
      ...item,
      id: newSandboxId(),
      content: cloneContentWithNewIds(item.content),
    })),
  }

  // Last, and over the whole document: the remap has to reach the sandbox and
  // the inline images in rich text as well as the zones, and it is the same
  // function import and paste use for exactly that reason.
  return { presentation: remapAssetIds(copy, assetIds), assetIds }
}

export function summarize(presentation: Presentation): PresentationSummary {
  return {
    id: presentation.id,
    title: presentation.title,
    folderId: presentation.folderId,
    slideCount: presentation.slides.length,
    createdAt: presentation.createdAt,
    updatedAt: presentation.updatedAt,
  }
}

export function findSlide(presentation: Presentation, slideId: string): Slide | null {
  return presentation.slides.find((slide) => slide.id === slideId) ?? null
}

export function slideIndexOf(presentation: Presentation, slideId: string): number {
  return presentation.slides.findIndex((slide) => slide.id === slideId)
}

/** Return a copy with a fresh `updatedAt`. Every command funnels through this. */
export function touch(presentation: Presentation): Presentation {
  return { ...presentation, updatedAt: new Date().toISOString() }
}

/** Replace the cover and bump `updatedAt`. */
export function withCover(presentation: Presentation, cover: DeckCover): Presentation {
  return touch({ ...presentation, cover })
}

/** Replace one slide, preserving order, and bump `updatedAt`. */
export function withSlide(presentation: Presentation, slide: Slide): Presentation {
  const index = slideIndexOf(presentation, slide.id)
  if (index < 0) return presentation
  const slides = [...presentation.slides]
  slides[index] = slide
  return touch({ ...presentation, slides })
}
