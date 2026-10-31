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
import type { EditorMode } from '../../../state/store'
import type { TopToolbarProps } from '../TopToolbar'
import type { TextTargetEntry } from '../textTarget'

/** Which of the compact workspace's four surfaces is open, if any. */
export type CompactPanel = 'slides' | 'content' | 'zone' | 'tools'

/**
 * The editing mode a compact panel stands for.
 *
 * The zone panel *is* zone mode and every other surface — the slide alone
 * included — is content mode. Said once, so a tab, the panel's own × and a
 * long press into a field cannot each leave the mode somewhere different.
 */
export function modeForPanel(panel: CompactPanel | null): EditorMode {
  return panel === 'zone' ? 'zone' : 'content'
}

/**
 * The panel a compact workspace actually shows.
 *
 * Derived, never synchronised, from three facts the user set elsewhere:
 *
 * - a tool window (Ideas, the sandbox) is up — then no panel, because two big
 *   surfaces on one phone screen leave neither usable;
 * - the editing mode — zone mode *is* the zone panel, so a mode chosen on the
 *   desktop, with Ctrl+E or left with Escape shows or hides it rather than
 *   leaving outlines on the slide under a panel for the other mode;
 * - the panel last chosen.
 *
 * On a page with no zone tree (a generated page) zone mode cannot be entered,
 * and the zone panel is then simply the place that says so.
 */
export function compactPanelOnScreen(input: {
  chosen: CompactPanel | null
  mode: EditorMode
  zoneModeAvailable: boolean
  toolWindowOpen: boolean
}): CompactPanel | null {
  if (input.toolWindowOpen) return null
  if (input.mode === 'zone') return 'zone'
  if (input.chosen === 'zone' && input.zoneModeAvailable) return null
  return input.chosen
}

/**
 * The panels, as state rather than as toggles.
 *
 * A compact workspace shows one large surface at a time, so it has to be able
 * to *close* the other one rather than flip it; the desktop only ever flips.
 *
 * All of it is held by `EditorView` rather than by the shell, and that is not
 * tidiness. Which shell is mounted is a fact about the window, and a window can
 * change: rotating a tablet across the compact threshold swaps the shell, and
 * anything the shell was holding would go with it. What the user chose has to
 * outlive the layout that showed it.
 */
export interface EditorPanelState {
  ideasOpen: boolean
  sandboxOpen: boolean
  setIdeasOpen: (open: boolean) => void
  setSandboxOpen: (open: boolean) => void
  /** The compact surface the user last opened. `null` is "just the slide". */
  compactPanel: CompactPanel | null
  setCompactPanel: (panel: CompactPanel | null) => void
}

export interface EditorShellProps {
  /**
   * The page being edited, whichever kind it is — or `null` when the page on
   * screen is a derived one.
   *
   * A reference slide and the QR page are computed from the deck and are
   * read-only, so there is nothing on them to edit. `null` rather than the
   * authored slide behind them, because that slide is not what the stage is
   * showing: a panel that listed *its* fields would let somebody edit text on
   * a page they cannot see.
   */
  slide: Slide | null
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
  /** Fill the stage with the field this entry addresses, and write in it. */
  onEditText: (entry: TextTargetEntry) => void
  /**
   * One page along the deck — the same step the arrow keys and the wheel take.
   *
   * Handed down rather than taken from the store, because stepping is more
   * than `stepPage`: a generated page is a view *of* a slide and has to be
   * left on the way, which only `EditorView` can do.
   */
  onStepPage: (delta: number) => void
  /** Whether one field fills the stage, and the one way back out. */
  focus: StageFocusControls
  /** The keyboard reference. On the desktop the status bar offers it. */
  onShowShortcuts: () => void
}

/**
 * The compact stage's two states — the whole page, or one field of it filling
 * the stage and taking the caret — as the little a shell needs of them: which
 * one it is in, and the way out.
 *
 * There is no way *in* here on purpose. Focusing is a long press on the field
 * itself (see `stageFocus.ts`), so it is the stage's gesture rather than a
 * control the shell draws, and a shell that offered a button for it would be
 * offering a second way to do the one thing.
 *
 * `EditorView` owns the state behind it for the same reason it owns the panel
 * choice: a rotation that crosses the compact threshold swaps the shell, and
 * state the shell was holding would go with it.
 */
export interface StageFocusControls {
  /** Whether one field fills the stage rather than the whole page. */
  focused: boolean
  /** Whether a pinch has magnified the view beyond what is focused. */
  magnified: boolean
  /**
   * Back to the whole page in one press: the caret, the focused view and any
   * magnification taken on top of it all go together.
   */
  onExit: () => void
}
