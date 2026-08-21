/**
 * Presentation and slide factories plus small pure queries.
 */

import { DEFAULT_BACKGROUND_COLOR } from './constants'
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT } from './fonts'
import { DEFAULT_FONT_SCALE, DEFAULT_SPACING } from './metrics'
import { newIdeaCategoryId, newPresentationId, newSlideId } from './ids'
import { createLeaf } from './layout'
import { titleDoc } from './richdoc'
import { CURRENT_SCHEMA_VERSION } from './schema'
import type {
  IdeaCategory,
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

export function defaultIdeaCategories(): IdeaCategory[] {
  return [
    { id: newIdeaCategoryId(), name: 'Idéer', color: '#4d6b8c' },
    { id: newIdeaCategoryId(), name: 'Å gjøre', color: '#8c6b4d' },
  ]
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
}

export function createPresentation(input: CreatePresentationInput): Presentation {
  const now = new Date().toISOString()
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newPresentationId(),
    title: input.title.trim() || 'Uten tittel',
    folderId: input.folderId ?? null,
    theme: { ...defaultTheme(), ...input.theme },
    slides: [createSlide({ hasTitle: input.firstSlideHasTitle ?? true })],
    references: [],
    sandbox: [],
    ideas: [],
    ideaCategories: defaultIdeaCategories(),
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

/** Replace one slide, preserving order, and bump `updatedAt`. */
export function withSlide(presentation: Presentation, slide: Slide): Presentation {
  const index = slideIndexOf(presentation, slide.id)
  if (index < 0) return presentation
  const slides = [...presentation.slides]
  slides[index] = slide
  return touch({ ...presentation, slides })
}
