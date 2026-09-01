/**
 * Supabase session state.
 *
 * Slaids has no user system of its own: accounts, passwords and tokens all
 * belong to Supabase Auth, which Slaids shares with Huskis. This store only
 * reflects what the SDK reports and makes it available to React.
 *
 * The SDK keeps the session itself, which is what survives a reload; nothing
 * here writes tokens anywhere.
 */

import { create } from 'zustand'
import type { AuthError, Session } from '@supabase/supabase-js'
import { getSupabaseClient } from '../supabase/client'
import { describeIncompleteConfig, readSupabaseConfigState } from '../supabase/config'
import { resetRepositoryCaches } from '../persistence/activeRepository'
import { clearAssetCache } from './assets'
import { LAST_OPEN_PRESENTATION_KEY, writePref } from './prefs'
import { useEditorStore } from './store'
import { notify } from './toast'

export type SessionStatus =
  /** Still working out whether there is a session. */
  | 'loading'
  /** Supabase is not configured: local mode, no sign-in. */
  | 'disabled'
  | 'signed-in'
  | 'signed-out'
  /** Configured, but Supabase could not be reached or answered with an error. */
  | 'unavailable'
  /** The build got one Supabase variable but not the other. */
  | 'misconfigured'

interface SessionState {
  status: SessionStatus
  userId: string | null
  email: string | null
  /** Why the session could not be established, for `unavailable`. */
  error: string | null
  signingIn: boolean
  signInError: string | null

  start: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export function describeAuthError(error: AuthError | null | undefined): string {
  if (!error) return 'Ukjent feil.'
  // No HTTP status means the request never got an answer.
  if (error.name === 'AuthRetryableFetchError' || !error.status) {
    return 'Fikk ikke kontakt med Supabase. Sjekk nettverket og prøv igjen.'
  }
  if (/invalid login credentials/i.test(error.message)) return 'Feil e-post eller passord.'
  if (/email not confirmed/i.test(error.message)) return 'E-postadressen er ikke bekreftet.'
  return error.message
}

/**
 * Everything that belonged to the user who just left. The library and the
 * editor are unmounted by the auth gate; this clears what lives outside React
 * so nothing from the previous session is still on screen or in a cache.
 */
function clearUserScopedState(): void {
  resetRepositoryCaches()
  clearAssetCache()
  const editor = useEditorStore.getState()
  editor.setPresentation(null)
  editor.setLoadError(null)
  editor.setLoading(false)
  writePref<string | null>(LAST_OPEN_PRESENTATION_KEY, null)
}

let unsubscribe: (() => void) | null = null

export const useSessionStore = create<SessionState>((set, get) => {
  /** Reflect a session (or the lack of one), clearing caches when the user changes. */
  const apply = (session: Session | null): void => {
    const userId = session?.user?.id ?? null
    const previous = get().userId
    // Only when we are *leaving* a user. The first sign-in of a session has no
    // predecessor to clear after, and clearing there would throw away the
    // "reopen what was last open" preference on every reload.
    if (previous !== null && previous !== userId) clearUserScopedState()
    set({
      status: userId ? 'signed-in' : 'signed-out',
      userId,
      email: session?.user?.email ?? null,
      error: null,
    })
  }

  /** Take the SDK's own answer for which session, if any, is left. */
  const adoptStoredSession = async (): Promise<void> => {
    try {
      const { data } = await getSupabaseClient().auth.getSession()
      apply(data?.session ?? null)
    } catch {
      // If even that cannot be asked, signed-out is the safer reading: this SDK
      // version removes the session locally on failure too, and claiming
      // otherwise is the one thing a reload can prove wrong.
      apply(null)
    }
  }

  return {
    status: readSupabaseConfigState().kind === 'absent' ? 'disabled' : 'loading',
    userId: null,
    email: null,
    error: null,
    signingIn: false,
    signInError: null,

    start: async () => {
      const configState = readSupabaseConfigState()
      if (configState.kind === 'absent') {
        set({ status: 'disabled' })
        return
      }
      if (configState.kind === 'incomplete') {
        // Neither mode. Nothing is mounted and nothing is written anywhere.
        set({ status: 'misconfigured', error: describeIncompleteConfig(configState.missing) })
        return
      }
      set({ status: 'loading', error: null })
      let client
      try {
        client = getSupabaseClient()
      } catch (error) {
        set({
          status: 'unavailable',
          error: error instanceof Error ? error.message : 'Kunne ikke starte Supabase-klienten.',
        })
        return
      }

      if (!unsubscribe) {
        const { data } = client.auth.onAuthStateChange((_event, session) => apply(session))
        unsubscribe = () => data.subscription.unsubscribe()
      }

      try {
        const { data, error } = await client.auth.getSession()
        // A stored session is still usable even if the refresh call failed, so
        // only a *sessionless* error means Slaids cannot be used at all.
        if (error && !data?.session) {
          set({ status: 'unavailable', error: describeAuthError(error) })
          return
        }
        apply(data?.session ?? null)
      } catch (error) {
        set({
          status: 'unavailable',
          error: error instanceof Error ? error.message : 'Fikk ikke kontakt med Supabase.',
        })
      }
    },

    signIn: async (email, password) => {
      set({ signingIn: true, signInError: null })
      try {
        const { data, error } = await getSupabaseClient().auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) {
          set({ signingIn: false, signInError: describeAuthError(error) })
          return
        }
        set({ signingIn: false, signInError: null })
        apply(data.session)
      } catch (error) {
        set({
          signingIn: false,
          signInError: error instanceof Error ? error.message : 'Innloggingen feilet.',
        })
      }
    },

    signOut: async () => {
      // `local` scope, always. Slaids shares its Auth project with Huskis, and
      // the default (`global`) revokes every refresh token the user has — which
      // would sign them out of Huskis, on every device, because they closed
      // Slaids.
      let error: AuthError | null
      try {
        ;({ error } = await getSupabaseClient().auth.signOut({ scope: 'local' }))
      } catch (thrown) {
        error = (thrown ?? null) as AuthError | null
      }

      // Follow the SDK, not the error. Since auth-js 2.110.2 it drops the
      // stored session for every scope but `others` even when the revoke call
      // fails, and it may already have emitted SIGNED_OUT before this line. So
      // the question is never "did the call succeed" but "what session is
      // left" — guessing would leave this store and the SDK disagreeing about
      // who is logged in, and the next reload would settle it against us.
      await adoptStoredSession()

      if (error) {
        // Which of the two it is, is what `adoptStoredSession` just settled.
        notify.warning(
          get().status === 'signed-in'
            ? `Utloggingen feilet: ${describeAuthError(error)} Du er fortsatt innlogget.`
            : `Du er logget ut her, men serveren bekreftet det ikke: ${describeAuthError(error)}`,
        )
      }
      set({ signInError: null })
    },
  }
})

/** Test seam: drop the auth listener so a suite can start over. */
export function stopSessionWatcher(): void {
  unsubscribe?.()
  unsubscribe = null
}
