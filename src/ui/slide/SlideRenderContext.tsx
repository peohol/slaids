/** Shared rendering context for slide content: theme, citations, colours and assets. */

import { createContext, useContext } from 'react'
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_PILL_COLOR } from '../../domain/constants'
import { renderFontStack } from '../../domain/fonts'
import type { DeckProgress, DeckSectionColors, SectionColors } from '../../domain/pages'
import type { ReferenceNumbering } from '../../domain/references'
import type { PresentationTheme } from '../../domain/types'
import { defaultTheme } from '../../domain/presentation'

export interface SlideRenderValue {
  theme: PresentationTheme
  numbering: ReferenceNumbering
  /**
   * The colours each page of the deck is drawn in — see `deckSectionColors`.
   *
   * Deck-wide information a single page cannot derive on its own, exactly like
   * `numbering` and `progress`: which section governs a page depends on every
   * page before it. Keeping it here rather than passing it page by page is what
   * lets the stage, the thumbnails, presentation mode and a rendered preview
   * all draw the same colours without four call sites remembering to hand them
   * over.
   *
   * A page that is not in the map falls back to the deck's starting colours —
   * which is offscreen measurement, where there is no deck to be a page of, and
   * where colour is never fit-relevant anyway.
   */
  sectionColors: DeckSectionColors
  /**
   * Where each page of the deck sits in it — what the progress indicator draws.
   *
   * A page that is not in the map draws no indicator — which is the front page,
   * and offscreen measurement.
   */
  progress: DeckProgress
  /** Rendering is static (presentation mode, thumbnails, measurement). */
  isStatic: boolean
  /**
   * What a click on a citation does, when anything.
   *
   * The editor opens the reference list on the reference that was clicked;
   * presentation mode, thumbnails and offscreen measurement pass nothing, so
   * the pill stays inert text there.
   */
  onCitationClick?: (referenceIds: string[]) => void
}

/** What a deck is drawn in before any section has had its say. */
export const DEFAULT_SECTION_COLORS: SectionColors = {
  accent: DEFAULT_PILL_COLOR,
  background: DEFAULT_BACKGROUND_COLOR,
}

const fallback: SlideRenderValue = {
  theme: defaultTheme(),
  numbering: new Map(),
  sectionColors: new Map(),
  progress: new Map(),
  isStatic: true,
}

const SlideRenderContext = createContext<SlideRenderValue>(fallback)

/**
 * The colours of the one page currently being drawn.
 *
 * Separate from the deck-wide context because a deck's renderers draw many
 * pages inside one provider — the filmstrip draws all of them — so "which
 * colours apply here" is a property of the subtree rather than of the deck.
 * Every page renderer opens with `PageColorsProvider`, and everything under it,
 * however deep, reads the answer instead of being handed it.
 */
const PageColorsContext = createContext<SectionColors>(DEFAULT_SECTION_COLORS)

export function SlideRenderProvider({
  value,
  children,
}: {
  value: SlideRenderValue
  children: React.ReactNode
}) {
  const headingFontFamily = renderFontStack(value.theme.headingFontFamily)
  const bodyFontFamily = renderFontStack(value.theme.bodyFontFamily)
  const renderedValue =
    headingFontFamily === value.theme.headingFontFamily && bodyFontFamily === value.theme.bodyFontFamily
      ? value
      : {
          ...value,
          theme: { ...value.theme, headingFontFamily, bodyFontFamily },
        }
  return <SlideRenderContext.Provider value={renderedValue}>{children}</SlideRenderContext.Provider>
}

export function useSlideRender(): SlideRenderValue {
  return useContext(SlideRenderContext)
}

export function PageColorsProvider({
  colors,
  children,
}: {
  colors: SectionColors
  children: React.ReactNode
}) {
  return <PageColorsContext.Provider value={colors}>{children}</PageColorsContext.Provider>
}

export function usePageColors(): SectionColors {
  return useContext(PageColorsContext)
}

/** The colours a page id inherits, or the deck's starting pair when unknown. */
export function useSectionColorsFor(pageId: string): SectionColors {
  const { sectionColors } = useSlideRender()
  return sectionColors.get(pageId) ?? DEFAULT_SECTION_COLORS
}
