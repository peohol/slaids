/**
 * Presentation and slide factories plus small pure queries.
 */

import { DEFAULT_BACKGROUND_COLOR, DEFAULT_PILL_COLOR } from './constants'
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT } from './fonts'
import { DEFAULT_FONT_SCALE, DEFAULT_SPACING } from './metrics'
import { remapAssetIds } from './docs'
import { newAssetId, newPresentationId, newSandboxId, newSlideId } from './ids'
import { mapDeckSlides } from './deckSlides'
import { cloneContentWithNewIds, cloneSubtreeWithNewIds, createLeaf } from './layout'
import { titleDoc } from './richdoc'
import { CURRENT_SCHEMA_VERSION } from './schema'
import type {
  ContentSlide,
  DeckSlides,
  LayoutNode,
  Presentation,
  PresentationSummary,
  PresentationTheme,
  SectionSlide,
  Slide,
} from './types'

export function defaultTheme(): PresentationTheme {
  return {
    headingFontFamily: DEFAULT_HEADING_FONT,
    bodyFontFamily: DEFAULT_BODY_FONT,
    spacing: DEFAULT_SPACING,
    fontScale: DEFAULT_FONT_SCALE,
  }
}

export interface CreateSectionInput {
  title?: string
  subtitle?: string
  /** Defaults to the deck's starting colours — see `addSection` for inheritance. */
  accentColor?: string
  backgroundColor?: string
}

/**
 * A section slide.
 *
 * The heading is what a section is for, so it is the one line a caller is
 * expected to supply; the subheading is left empty because nobody has written
 * it yet. Both are ordinary documents from there on.
 */
export function createSection(input: CreateSectionInput = {}): SectionSlide {
  return {
    id: newSlideId(),
    kind: 'section',
    title: titleDoc(input.title ?? ''),
    subtitle: titleDoc(input.subtitle ?? ''),
    accentColor: input.accentColor ?? DEFAULT_PILL_COLOR,
    backgroundColor: input.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
  }
}

export function createSlide(
  options: { hasTitle?: boolean; root?: LayoutNode; title?: string } = {},
): ContentSlide {
  const hasTitle = options.hasTitle ?? true
  return {
    id: newSlideId(),
    kind: 'content',
    title: hasTitle ? titleDoc(options.title ?? '') : null,
    root: options.root ?? createLeaf(),
  }
}

export { asDeckSlides, isContentSlide, isSectionSlide, mapDeckSlides } from './deckSlides'

/**
 * The section whose colours a slide is drawn in: itself, or the nearest one
 * before it.
 *
 * Total, because the deck's first slide is a section — the same guarantee
 * `deckSectionColors` leans on for the pages a deck renders. This is the
 * lookup for the places that hold a slide id rather than a page list: the
 * editor chrome, a new section inheriting from the one before it.
 */
export function sectionGoverning(presentation: Presentation, slideId: string): SectionSlide {
  const index = slideIndexOf(presentation, slideId)
  const upTo = index < 0 ? presentation.slides.length : index + 1
  for (let i = upTo - 1; i >= 0; i -= 1) {
    const slide = presentation.slides[i]
    if (slide.kind === 'section') return slide
  }
  return presentation.slides[0]
}

export interface CreatePresentationInput {
  title: string
  theme?: Partial<PresentationTheme>
  folderId?: string | null
  firstSlideHasTitle?: boolean
  /**
   * The deck's front page — its first section. The title defaults to the
   * presentation's own name, which is the one line the author has demonstrably
   * already written.
   */
  frontTitle?: string
  frontSubtitle?: string
  /** The colours the first section sets, and every slide after it inherits. */
  accentColor?: string
  backgroundColor?: string
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
    slides: [
      createSection({
        title: input.frontTitle ?? title,
        subtitle: input.frontSubtitle,
        accentColor: input.accentColor,
        backgroundColor: input.backgroundColor,
      }),
      createSlide({ hasTitle: input.firstSlideHasTitle ?? true }),
    ],
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
    slides: cloneSlides(source.slides),
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

/** Every slide copied, with every identity inside it made new. */
function cloneSlides(slides: DeckSlides): DeckSlides {
  return mapDeckSlides(slides, { section: cloneSection, content: cloneContentSlide })
}

function cloneSection(slide: SectionSlide): SectionSlide {
  return {
    ...slide,
    id: newSlideId(),
    title: structuredClone(slide.title),
    subtitle: structuredClone(slide.subtitle),
  }
}

function cloneContentSlide(slide: ContentSlide): ContentSlide {
  return {
    ...slide,
    id: newSlideId(),
    title: slide.title ? structuredClone(slide.title) : null,
    root: cloneSubtreeWithNewIds(slide.root),
  }
}

export function findSlide(presentation: Presentation, slideId: string): Slide | null {
  return presentation.slides.find((slide) => slide.id === slideId) ?? null
}

/** The slide, when it is one with zones. Sections have none of the above. */
export function findContentSlide(
  presentation: Presentation,
  slideId: string,
): ContentSlide | null {
  const slide = findSlide(presentation, slideId)
  return slide && slide.kind === 'content' ? slide : null
}

export function findSectionSlide(
  presentation: Presentation,
  slideId: string,
): SectionSlide | null {
  const slide = findSlide(presentation, slideId)
  return slide && slide.kind === 'section' ? slide : null
}

export function slideIndexOf(presentation: Presentation, slideId: string): number {
  return presentation.slides.findIndex((slide) => slide.id === slideId)
}

/** Return a copy with a fresh `updatedAt`. Every command funnels through this. */
export function touch(presentation: Presentation): Presentation {
  return { ...presentation, updatedAt: new Date().toISOString() }
}

/**
 * Replace one slide, preserving order, and bump `updatedAt`.
 *
 * A replacement keeps the slide's kind — that is what the signature says — so
 * this cannot be the way the first page stops being a section. Turning one kind
 * of slide into another is not an edit to a slide; it would be a command of its
 * own, and there is none.
 */
export function withSlide(presentation: Presentation, slide: Slide): Presentation {
  const index = slideIndexOf(presentation, slide.id)
  if (index < 0) return presentation
  const [first, ...rest] = presentation.slides
  if (index === 0) {
    // The narrowing *is* the rule: a first slide that is not a section cannot
    // be written down, so no cast stands between the check and the result.
    if (slide.kind !== 'section') return presentation
    return touch({ ...presentation, slides: [slide, ...rest] })
  }
  if (rest[index - 1].kind !== slide.kind) return presentation
  const tail = [...rest]
  tail[index - 1] = slide
  return touch({ ...presentation, slides: [first, ...tail] })
}
