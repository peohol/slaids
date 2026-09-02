/**
 * Whether the open presentation is published, and to which link.
 *
 * Kept out of the `Presentation` domain object on purpose. Sharing is not a
 * property of the document — it is a fact about the row in the database — and
 * putting it in the document would make it three things it must not be:
 * undoable with Ctrl+Z, part of the autosaved payload, and something a `.slaids`
 * export or a duplicate would carry along. A copy always starts unshared, and
 * that follows from where this state lives rather than from a rule somebody has
 * to remember.
 *
 * The store never *guesses* the toggle. `shared` and `token` only ever come
 * from what the server confirmed, so the switch cannot show "on" for a
 * publication that did not happen.
 */

import { create } from 'zustand'
import { buildSharedSnapshot } from '../domain/sharing'
import { isSharingSupported, sharing } from '../persistence/activeRepository'
import { shareUrl } from '../routing'
import { useEditorStore } from './store'
import { notify } from './toast'

export type SharingStatus =
  /** Nothing loaded yet. */
  | 'idle'
  /** Local mode: there is no public backend, so there is nothing to share to. */
  | 'unsupported'
  | 'loading'
  | 'ready'
  /** The state could not be read; the toggle stays untouched rather than guessing. */
  | 'error'

export interface SharingState {
  presentationId: string | null
  status: SharingStatus
  shared: boolean
  /** Only ever set while `shared` is true. A revoked token is not a link. */
  token: string | null
  /** A publish or revoke is in flight; the toggle refuses to start a second one. */
  busy: boolean
  error: string | null

  reset: () => void
  load: (presentationId: string) => Promise<void>
  /**
   * Publish. `flush` drains the pending autosave first: the audience is shown
   * the last version that was actually stored, so publishing an unsaved editor
   * would put them behind from the first second. A flush that fails stops the
   * whole operation — nothing is published, and the toggle stays off.
   */
  enable: (flush: () => Promise<boolean>) => Promise<void>
  disable: () => Promise<void>
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export const useSharingStore = create<SharingState>((set, get) => ({
  presentationId: null,
  status: 'idle',
  shared: false,
  token: null,
  busy: false,
  error: null,

  reset: () =>
    set({
      presentationId: null,
      status: 'idle',
      shared: false,
      token: null,
      busy: false,
      error: null,
    }),

  load: async (presentationId) => {
    if (!isSharingSupported()) {
      set({
        presentationId,
        status: 'unsupported',
        shared: false,
        token: null,
        busy: false,
        error: null,
      })
      return
    }
    set({
      presentationId,
      status: 'loading',
      shared: false,
      token: null,
      busy: false,
      error: null,
    })
    try {
      const state = await sharing.readShareState(presentationId)
      // The editor may have moved on to another presentation while this was in
      // flight; a late answer must not be applied to the wrong one.
      if (get().presentationId !== presentationId) return
      set({ status: 'ready', shared: state.shared, token: state.token, error: null })
    } catch (error) {
      if (get().presentationId !== presentationId) return
      set({
        status: 'error',
        error: describe(error, 'Kunne ikke lese delingsstatusen.'),
      })
    }
  },

  enable: async (flush) => {
    const { presentationId, busy, status } = get()
    if (!presentationId || busy || status === 'unsupported') return
    set({ busy: true, error: null })

    let saved: boolean
    try {
      saved = await flush()
    } catch {
      saved = false
    }
    if (!saved) {
      const message =
        'Endringene ble ikke lagret, så presentasjonen ble ikke delt. Prøv igjen når lagringen går igjennom.'
      set({ busy: false, error: message })
      notify.error(message)
      return
    }

    // Read after the flush, so the snapshot is cut from a document that has
    // actually been written rather than from an editor that has not. A change
    // typed during the flush itself would put the snapshot a keystroke ahead of
    // the stored copy for as long as the next autosave takes — which is fine,
    // because that save republishes both together.
    const presentation = useEditorStore.getState().presentation
    if (!presentation || presentation.id !== presentationId) {
      set({ busy: false, error: 'Fant ikke presentasjonen som skulle deles.' })
      return
    }

    try {
      const next = await sharing.enableSharing(presentationId, buildSharedSnapshot(presentation))
      if (get().presentationId !== presentationId) return
      set({ status: 'ready', shared: next.shared, token: next.token, busy: false, error: null })
    } catch (error) {
      const message = describe(error, 'Kunne ikke dele presentasjonen.')
      if (get().presentationId !== presentationId) return
      set({ busy: false, error: message })
      notify.error(message)
    }
  },

  disable: async () => {
    const { presentationId, busy, status } = get()
    if (!presentationId || busy || status === 'unsupported') return
    set({ busy: true, error: null })
    try {
      const next = await sharing.disableSharing(presentationId)
      if (get().presentationId !== presentationId) return
      set({ status: 'ready', shared: next.shared, token: next.token, busy: false, error: null })
    } catch (error) {
      const message = describe(error, 'Kunne ikke slå av delingen.')
      if (get().presentationId !== presentationId) return
      set({ busy: false, error: message })
      notify.error(message)
    }
  },
}))

/** The address to hand out, or `null` when there is nothing live to hand out. */
export function currentShareUrl(state: Pick<SharingState, 'shared' | 'token'>): string | null {
  if (!state.shared || !state.token) return null
  if (typeof window === 'undefined') return null
  return shareUrl(window.location.origin, state.token)
}

/** Hook form, for the components that need the link rather than the token. */
export function useShareUrl(): string | null {
  const shared = useSharingStore((state) => state.shared)
  const token = useSharingStore((state) => state.token)
  return currentShareUrl({ shared, token })
}
