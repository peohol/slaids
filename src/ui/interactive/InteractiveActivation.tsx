/**
 * The door between a drawn cover and a running miniapp.
 *
 * A cover is drawn in many places — the filmstrip, the read-only stage, the
 * rendered preview on a server, the stage and the player — and in exactly two
 * of them may it start anything: the surfaces that mount
 * `InteractiveSlideSurface`. That surface provides this context; everything
 * else has none, and a cover with none draws its button as an inert shape.
 *
 * So "may this render start code" is never inferred from `isStatic`, from
 * `pointer-events` or from where the pointer happens to be: it is whether the
 * tree the cover sits in has been handed an activation, and only one
 * component ever hands one out.
 */

import { createContext, useContext } from 'react'

export interface InteractiveActivation {
  /** Start the app. Idempotent while one is running. */
  activate: () => void
}

/**
 * The attribute the cover puts on its live button, so the surface can hand
 * focus back to it when the app is closed — found in the DOM at that moment,
 * which is the one moment it matters, rather than carried through a ref.
 */
export const ACTIVATE_BUTTON_ATTRIBUTE = 'data-interactive-activate'

const InteractiveActivationContext = createContext<InteractiveActivation | null>(null)

export const InteractiveActivationProvider = InteractiveActivationContext.Provider

/** The activation on this surface, or `null` where nothing may run. */
export function useInteractiveActivation(): InteractiveActivation | null {
  return useContext(InteractiveActivationContext)
}
