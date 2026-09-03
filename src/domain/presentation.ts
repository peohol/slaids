/**
 * Presentation and slide factories plus small pure queries.
 */

import { DEFAULT_BACKGROUND_COLOR, DEFAULT_PILL_COLOR } from './constants'
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT } from './fonts'
import { DEFAULT_FONT_SCALE, DEFAULT_SPACING } from './metrics'
import { newPresentationId, newSlideId } from './ids'
import { createLeaf } from './layout'
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
