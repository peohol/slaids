/**
 * The one fact every navigation handler asks before it acts: is a miniapp
 * running right now?
 *
 * While one runs, Slaids must not turn a page, step a slide, undo an edit or
 * leave presentation mode on any key, click, wheel or swipe — not because
 * those events usually stay inside the frame (they do), but because "usually"
 * is not a rule. A press on the exit button is a key event Slaids does see, a
 * click beside the frame is a click on the page, and the only honest way to
 * cover all of them is one lock that every handler consults, in the player,
 * in the editor and in the shared view alike.
 *
 * The lock is held by the runtime component for exactly as long as its frame
 * is mounted (`InteractiveRuntime`), and released by the same component's
 * cleanup, so it cannot outlive the frame it is about. It is deliberately a
 * fact about the screen and not about the document: nothing here is
 * persisted, autosaved, shared or undone.
 */

import { create } from 'zustand'

export interface InteractiveSession {
  /** Which slide's app is running. */
  slideId: string
  /** Distinguishes this run from the next one on the same slide. */
  token: number
}

interface InteractiveRuntimeState {
  session: InteractiveSession | null
  /** Take the lock for a slide's app. Returns the token `end` needs. */
  begin: (slideId: string) => number
  /** Release the lock — only if `token` is the run that holds it. */
  end: (token: number) => void
}

let nextToken = 1

export const useInteractiveRuntime = create<InteractiveRuntimeState>((set, get) => ({
  session: null,
  begin: (slideId) => {
    const token = nextToken
    nextToken += 1
    set({ session: { slideId, token } })
    return token
  },
  end: (token) => {
    if (get().session?.token === token) set({ session: null })
  },
}))

/** Whether a miniapp is running, for handlers outside React's render. */
export function isInteractiveRuntimeActive(): boolean {
  return useInteractiveRuntime.getState().session !== null
}

/** The same fact, for a component that re-renders when it changes. */
export function useInteractiveRuntimeActive(): boolean {
  return useInteractiveRuntime((state) => state.session !== null)
}
