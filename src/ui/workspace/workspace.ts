/**
 * What the workspace *is*, as opposed to what device it is on.
 *
 * Slaids is desktop-first but not desktop-only, and which layout an editor gets
 * is decided by two independent facts about the surface it is drawn on — never
 * by a user agent string:
 *
 *  - **compact**: there is not enough room to keep a filmstrip, a stage and an
 *    inspector on screen at once, so the workspace shows one big surface at a
 *    time instead.
 *  - **coarse**: the pointer cannot be aimed precisely, so hit targets have to
 *    be finger-sized and nothing important may depend on hover or on dragging.
 *
 * They are deliberately orthogonal. A narrow desktop window is compact with a
 * mouse; a large tablet is roomy with a finger. Both are real, and each gets
 * what it actually needs rather than what its user agent suggests.
 *
 * Everything here is pure so the rules can be tested without a browser. The
 * subscription that feeds it lives in `WorkspaceContext.tsx`, and it is the
 * only place the browser is asked.
 */

/**
 * Below this width the three permanent columns stop fitting.
 *
 * The filmstrip and the inspector are fixed-width chrome (see
 * `--filmstrip-width` and `--inspector-width`); what is left over is the stage,
 * and below roughly this point the stage stops being the largest thing on
 * screen — which is the one property the editor exists to preserve.
 */
export const COMPACT_MAX_WIDTH = 1024

/**
 * And below this height, for the same reason turned on its side: the toolbars,
 * the text toolbar and the status bar are fixed, and a landscape phone has less
 * room under them than a 16:9 stage needs to stay readable.
 */
export const COMPACT_MAX_HEIGHT = 560

export type Orientation = 'portrait' | 'landscape'

/** What the browser is asked for. Separated out so the rules can be tested. */
export interface WorkspaceMetrics {
  /** The layout viewport — what CSS lengths are relative to. */
  width: number
  height: number
  /** The part of the layout viewport actually on screen, from `visualViewport`. */
  visibleHeight: number
  coarse: boolean
}

export interface Workspace extends WorkspaceMetrics {
  compact: boolean
  orientation: Orientation
  /**
   * How much of the layout viewport is currently covered from below — an
   * on-screen keyboard, in practice.
   *
   * A number rather than a boolean because that is what the layout needs: the
   * compact shell keeps its own height at the *visible* height, so its bottom
   * toolbar stays above the keyboard instead of behind it.
   */
  keyboardInset: number
  /** Whether something is covering the viewport from below right now. */
  keyboardOpen: boolean
}

/**
 * The keyboard has to eat more than this before anything moves.
 *
 * Browser chrome that slides away as the page scrolls changes the visual
 * viewport by a few dozen pixels all by itself, and treating that as a keyboard
 * would make the toolbars jump while somebody was merely scrolling.
 */
export const KEYBOARD_INSET_THRESHOLD = 120

export function deriveWorkspace(metrics: WorkspaceMetrics): Workspace {
  const inset = Math.max(0, Math.round(metrics.height - metrics.visibleHeight))
  const keyboardOpen = inset >= KEYBOARD_INSET_THRESHOLD
  return {
    ...metrics,
    compact: metrics.width <= COMPACT_MAX_WIDTH || metrics.height <= COMPACT_MAX_HEIGHT,
    orientation: metrics.width >= metrics.height ? 'landscape' : 'portrait',
    keyboardInset: inset,
    keyboardOpen,
  }
}

/**
 * The workspace a surface with no browser under it has.
 *
 * Used for the first render in a server or test environment, and as the value
 * a component outside the provider reads: a roomy, fine-pointer desktop, which
 * is what Slaids was before any of this existed.
 */
export const DESKTOP_WORKSPACE: Workspace = deriveWorkspace({
  width: 1600,
  height: 1000,
  visibleHeight: 1000,
  coarse: false,
})
