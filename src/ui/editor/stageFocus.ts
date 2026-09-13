/**
 * How close the compact stage is to the selected zone.
 *
 * Four steps, and the editor is always on exactly one of them:
 *
 *   1. the slide          – nothing focused, a press selects a zone
 *   2. a selected zone    – outlined on the page, its actions offered
 *   3. a focused zone     – the view fills the stage with that zone
 *   4. typing in it       – the focused zone is the writing surface
 *
 * Steps 3 and 4 are what this module is: step 1 is the absence of a focus and
 * step 2 is the store's selection. Going up is always a deliberate press;
 * coming down happens by itself the moment the step stops being true, which is
 * what `liveFocus` decides. There is no effect anywhere synchronising it — the
 * focus is only ever *read* through this function, so it cannot survive a
 * change that invalidates it even for one render.
 *
 * None of it is a fact about the presentation. A focus is a view transform and
 * a mode of the editor, and both die with the tab.
 */

import type { NodeId } from '../../domain/types'

export interface StageFocus {
  /** The slide it was taken on: paging away is leaving the focused zone. */
  slideId: string
  nodeId: NodeId
  /** Whether the focused zone is being typed into directly. */
  editing: boolean
}

/** What the editor is looking at right now, as the focus was asked about it. */
export interface FocusContext {
  slideId: string | null
  selectedNodeId: NodeId | null
  /** Whether the selection is a zone worth filling the stage with. */
  focusable: boolean
  /** Whether that zone holds text at all. A picture has nothing to type into. */
  hasText: boolean
}

/**
 * The focus that is still true of what is on screen, or `null`.
 *
 * Derived rather than reset: an undo that deletes the zone, a press on another
 * zone, a page turn and a rotation that swaps the shell all pass through here,
 * and every one of them lands on the step that is actually true instead of on
 * whatever was true when the focus was taken.
 */
export function liveFocus(focus: StageFocus | null, context: FocusContext): StageFocus | null {
  if (!focus || !context.focusable) return null
  if (focus.slideId !== context.slideId) return null
  if (focus.nodeId !== context.selectedNodeId) return null
  // A zone can lose its text under the focus — an undo, a content kind changed
  // from another surface. The view stays; the writing surface cannot.
  if (focus.editing && !context.hasText) return { ...focus, editing: false }
  return focus
}
