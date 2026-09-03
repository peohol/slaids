/** Shared rendering context for slide content: theme, citations and assets. */

import { createContext, useContext } from 'react'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
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
