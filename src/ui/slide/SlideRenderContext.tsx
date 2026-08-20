/** Shared rendering context for slide content: theme, citations and assets. */

import { createContext, useContext } from 'react'
import type { ReferenceNumbering } from '../../domain/references'
import type { PresentationTheme } from '../../domain/types'
import { defaultTheme } from '../../domain/presentation'

export interface SlideRenderValue {
  theme: PresentationTheme
  numbering: ReferenceNumbering
  /** Rendering is static (presentation mode, thumbnails, measurement). */
  isStatic: boolean
}

const fallback: SlideRenderValue = {
  theme: defaultTheme(),
  numbering: new Map(),
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
