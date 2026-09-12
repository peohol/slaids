/**
 * What a shell is handed.
 *
 * `EditorView` owns the presentation, the autosave, the commands and every
 * dialog, and it builds the three big surfaces — the strip, the stage, the
 * inspector — once. A shell decides only *where they go*, which is the one
 * thing that genuinely differs between a desktop with three columns and a
 * phone with one. Nothing here is a command; nothing here is a rule.
 *
 * Exactly one shell is mounted at a time, deliberately. Rendering both and
 * hiding one with CSS would put two Tiptap trees, two sets of drop targets and
 * two offscreen measurements on the page — and a hidden editor measures its
 * content as zero, which is the one answer the fit rule must never get.
 */

import type { ReactNode } from 'react'
import type { Slide } from '../../../domain/types'
import type { TopToolbarProps } from '../TopToolbar'
import type { TextTargetEntry } from '../textTarget'

/**
 * The two tool panels, as state rather than as toggles.
 *
 * A compact workspace shows one large surface at a time, so it has to be able
 * to *close* the other one rather than flip it; the desktop only ever flips.
 */
export interface EditorPanelState {
  ideasOpen: boolean
  sandboxOpen: boolean
  setIdeasOpen: (open: boolean) => void
  setSandboxOpen: (open: boolean) => void
}

export interface EditorShellProps {
  /** The page being edited, whichever kind it is. */
  slide: Slide
  /** Settled state of the theme's web fonts, published for the fit tests. */
  fontState: string
  /** The whole command surface, shared by both shells' toolbars. */
  toolbar: TopToolbarProps
  panels: EditorPanelState
  textToolbar: ReactNode
  filmstrip: ReactNode
  stage: ReactNode
  inspector: ReactNode
  statusBar: ReactNode
  ideas: ReactNode
  sandbox: ReactNode
  /** The bar that asks for a target zone, or `null` when nothing is being placed. */
  placementBar: ReactNode
  /** Open one field on the focused writing surface. */
  onEditText: (entry: TextTargetEntry) => void
  /** Whether the stage is zoomed onto the selected zone right now. */
  zoomed: boolean
  onToggleZoom: () => void
  /** True when the selected zone is small enough that zooming into it helps. */
  canZoom: boolean
  /** The keyboard reference. On the desktop the status bar offers it. */
  onShowShortcuts: () => void
}
