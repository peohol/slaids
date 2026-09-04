/** Shared rendering context for slide content: theme, citations and assets. */

import { createContext, useContext } from 'react'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import type { DeckProgress } from '../../domain/pages'
import type { ReferenceNumbering } from '../../domain/references'
import type { PresentationTheme } from '../../domain/types'
import { defaultTheme } from '../../domain/presentation'

export interface SlideRenderValue {
  theme: PresentationTheme
  numbering: ReferenceNumbering
  /**
   * The deck's default heading pill colour — `cover.pillColor`.
   *
   * It belongs here rather than in the theme because it is the cover's own
   * colour: a heading that stores no colour of its own is painted with it, so a
   * renderer that knows the deck knows what such a heading looks like. Colour
   * is never fit-relevant, which is why the offscreen measurer may leave it at
   * the default without measuring anything differently.
   */
  headingPillColor: string
  /**
   * Where each page of the deck sits in it — what the progress indicator draws.
   *
   * Deck-wide information a single page cannot derive on its own, exactly like
   * `numbering`: how full the bar is depends on how many pages come after this
   * one, including the reference slides and the QR page. Keeping it here rather
   * than passing it page by page is what lets the stage, the thumbnails,
   * presentation mode and a rendered preview all draw the same indicator
   * without four call sites remembering to hand it over.
   *
   * A page that is not in the map draws no indicator — which is the cover, and
   * offscreen measurement, where there is no deck to be a page of.
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

const fallback: SlideRenderValue = {
  theme: defaultTheme(),
  numbering: new Map(),
  headingPillColor: DEFAULT_PILL_COLOR,
  progress: new Map(),
  isStatic: true,
}

const SlideRenderContext = createContext<SlideRenderValue>(fallback)

export function SlideRenderProvider({
  value,
  children,
}: {
  value: SlideRenderValue
  children: React.ReactNode
}) {
  return <SlideRenderContext.Provider value={value}>{children}</SlideRenderContext.Provider>
}

export function useSlideRender(): SlideRenderValue {
  return useContext(SlideRenderContext)
}
