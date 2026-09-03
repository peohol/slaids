/**
 * The rendered-preview contract, and nothing that can draw one.
 *
 * `IMPLEMENTATION_PLAN.md` §44 asks for visual feedback drawn by "Slaids'
 * virkelige renderer og geometri, ikke en separat agentrenderer". That renderer
 * is React, and React is exactly what Agent Core is not allowed to be built on
 * — the layer has to stay usable from a script, a test and a serverless
 * function without a DOM anywhere in sight.
 *
 * Both are true at once because the renderer is *injected*, the same way the
 * repository and the fit checkers already are. Agent Core states the shape of a
 * preview here and asks for one through `AgentContext`; `src/render/` is the
 * implementation that owns the React and browser dependency, and the deployment
 * decides whether to hand one over. A deployment that does not gets
 * `PREVIEW_UNAVAILABLE` — never a picture of nothing, and never a second,
 * approximate renderer that happens to be easier to link.
 *
 * Everything here is domain types and plain data, so this file compiles in the
 * same places the rest of Agent Core does.
 */

import type { DeckPage } from '../domain/pages'
import type { Presentation } from '../domain/types'
import type { StoredAsset } from '../persistence/repository'
import type { AgentImage } from './image'

/**
 * Where the renderer reads pictures.
 *
 * Narrowed to the one method it needs, and supplied by the operation from the
 * same store the deck was just loaded from — so a preview can never show a file
 * from somewhere the presentation is not.
 */
export interface PreviewAssetReader {
  getAsset(id: string): Promise<StoredAsset | null>
}

export interface SlidePreviewRequest {
  /** The deck as it is stored. The renderer never writes and never reloads it. */
  presentation: Presentation
  /** The page to draw, already resolved out of `deckPages`. */
  page: DeckPage
  /**
   * Pixels per logical unit of the 1600×900 design space.
   *
   * `1` is the size the audience sees. Smaller is the knob that matters for an
   * agent: a picture is tokens, and a composition is legible long before it is
   * full size.
   */
  scale: number
  assets: PreviewAssetReader
}

export interface SlidePreview {
  image: AgentImage
  /**
   * Whether every web font the theme names was usable when the picture was
   * taken.
   *
   * Reported rather than waited for indefinitely. Fonts come over the network,
   * and a preview drawn in the fallback face is still worth looking at for
   * composition — but an agent judging whether a line is too long has to know
   * that the glyphs it is looking at are not the ones the deck will use.
   */
  fontsReady: boolean
  /**
   * Anything else the agent should know about what it is looking at: a file the
   * store no longer has, a font that did not arrive. Empty when the picture is
   * exactly the deck.
   */
  warnings: string[]
}

/**
 * Why a preview could not be drawn.
 *
 * Two codes, and the distinction is the one an agent needs: `PREVIEW_UNAVAILABLE`
 * means this installation cannot draw previews at all, so stop asking and carry
 * on with the rest of the API; `PREVIEW_FAILED` means it can, and this one did
 * not work, so trying again is reasonable. Neither is a domain error — the deck
 * was fine, the drawing was not — which is why this is its own small type
 * rather than a borrowed `DomainError` with a code that nearly fits.
 */
export interface SlidePreviewFailure {
  code: 'PREVIEW_UNAVAILABLE' | 'PREVIEW_FAILED'
  message: string
  details?: Record<string, unknown>
}

export type SlidePreviewOutcome =
  | { ok: true; value: SlidePreview }
  | { ok: false; error: SlidePreviewFailure }

export type SlidePreviewRenderer = (
  request: SlidePreviewRequest,
) => Promise<SlidePreviewOutcome>

export function previewFailure(
  code: SlidePreviewFailure['code'],
  message: string,
  details?: Record<string, unknown>,
): SlidePreviewOutcome {
  return { ok: false, error: details ? { code, message, details } : { code, message } }
}
