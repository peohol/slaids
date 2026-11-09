/**
 * Supabase session state, and whether that session is a Slaids user.
 *
 * Supabase Auth says who someone is; Slaids' access list (`slaids_users`) says
 * whether they may use Slaids, in which role, and whether the account is still
 * active. Both answers live here, and the gate reads nothing else.
 *
 * Signing in is a six-digit code sent by email: `requestCode` asks Supabase to
 * send one (never creating an account — accounts are made by an
 * administrator), `verifyCode` turns it into a session, stored where the person
 * chose (see `supabase/authStorage.ts`).
 *
 * The SDK keeps the session itself, which is what survives a reload; nothing
 * here writes tokens anywhere.
 */

import { create } from 'zustand'
import type { AuthError, Session } from '@supabase/supabase-js'
import { getSupabaseClient } from '../supabase/client'
import { authSessionStorage } from '../supabase/authStorage'
import { classifyAuthError, describeAuthError, type AuthFailure } from '../supabase/authErrors'
import { describeIncompleteConfig, readSupabaseConfigState } from '../supabase/config'
import { resetRepositoryCaches } from '../persistence/activeRepository'
import { readUserAccess, type SlaidsRole } from '../persistence/slaidsUsers'
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

/**
 * What the access list says about the signed-in Auth user.
 *
 * `null` when nobody is signed in, and in local mode, where there are no users.
 */
export type AccessStatus =
  /** Asking the access list. */
  | 'checking'
  /** An active Slaids user. The only value that opens the app. */
  | 'member'
  /** An Auth account, perhaps another app's, that is not on Slaids' list. */
  | 'no-access'
  /** On the list, but deactivated by an administrator. */
  | 'deactivated'

export type AuthOutcome = { ok: true } | { ok: false; failure: AuthFailure }

interface SessionState {
  status: SessionStatus
  userId: string | null
  email: string | null
  /** Why the session could not be established, for `unavailable`. */
  error: string | null
  access: AccessStatus | null
  /** The member's role; `null` unless `access` is `member`. */
  role: SlaidsRole | null

  start: () => Promise<void>
  /** Email a sign-in code. Never creates an account. */
  requestCode: (email: string) => Promise<AuthOutcome>
  /** Sign in with the emailed code, keeping the session per `remember`. */
  verifyCode: (email: string, code: string, remember: boolean) => Promise<AuthOutcome>
  signOut: () => Promise<void>
  /** Read the signed-in user's own row in the access list again. */
  refreshAccess: () => Promise<void>
}

/** How Supabase stores addresses, so a stray capital or space is not a different person. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
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

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

let unsubscribe: (() => void) | null = null

/** The access read in flight, so focus, sign-in and start share one request. */
let accessCheck: { userId: string; promise: Promise<void> } | null = null

export const useSessionStore = create<SessionState>((set, get) => {
  /**
   * Reflect a session (or the lack of one), clearing caches when the user
   * changes. Returns whether the access list has to be asked about it.
   */
  const apply = (session: Session | null): boolean => {
    const userId = session?.user?.id ?? null
    const { userId: previous, access } = get()
    // Only when we are *leaving* a user. The first sign-in of a session has no
    // predecessor to clear after, and clearing there would throw away the
    // "reopen what was last open" preference on every reload.
    if (previous !== null && previous !== userId) clearUserScopedState()
    const changed = previous !== userId
    set({
      status: userId ? 'signed-in' : 'signed-out',
      userId,
      email: session?.user?.email ?? null,
      error: null,
      // A new user starts unknown; the same user keeps what is known about them
      // while a token refresh or a reload passes by.
      ...(changed ? { access: userId ? 'checking' : null, role: null } : {}),
    })
    return userId !== null && (changed || access === null || access === 'checking')
  }

  /** Take the SDK's own answer for which session, if any, is left. */
  const adoptStoredSession = async (): Promise<void> => {
    let session: Session | null = null
    try {
      const { data } = await getSupabaseClient().auth.getSession()
      session = data?.session ?? null
    } catch {
      // If even that cannot be asked, signed-out is the safer reading: this SDK
      // version removes the session locally on failure too, and claiming
      // otherwise is the one thing a reload can prove wrong.
    }
    if (apply(session)) await get().refreshAccess()
  }

  const readAccess = async (userId: string): Promise<void> => {
    try {
      const access = await readUserAccess(getSupabaseClient(), userId)
      if (get().userId !== userId) return
      set({
        access: access === null ? 'no-access' : access.active ? 'member' : 'deactivated',
        role: access?.active ? access.role : null,
      })
    } catch (error) {
      if (get().userId !== userId) return
      // Only an *unanswered first* question stops the app. A member whose
      // re-check on focus hit a network blip keeps working: the database still
      // enforces the list on every request, so nothing is let through by it.
      if (get().access === 'checking') {
        set({
          status: 'unavailable',
          error: messageOf(error, 'Kunne ikke sjekke tilgangen til Slaids.'),
        })
      }
    }
  }

  return {
    status: readSupabaseConfigState().kind === 'absent' ? 'disabled' : 'loading',
    userId: null,
    email: null,
    error: null,
    access: null,
    role: null,

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
          error: messageOf(error, 'Kunne ikke starte Supabase-klienten.'),
        })
        return
      }

      if (!unsubscribe) {
        // Every event is answered by reading the stored session again rather
        // than trusting the one the event carries. Another tab's sign-in arrives
        // here too (the SDK broadcasts it), and a tab that keeps its session in
        // its own `sessionStorage` must not adopt one it does not hold. Deferred,
        // because calling back into the SDK from inside its own callback can
        // deadlock on its lock.
        const { data } = client.auth.onAuthStateChange(() => {
          setTimeout(() => void adoptStoredSession(), 0)
        })
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
        if (apply(data?.session ?? null)) await get().refreshAccess()
      } catch (error) {
        set({ status: 'unavailable', error: messageOf(error, 'Fikk ikke kontakt med Supabase.') })
      }
    },

    requestCode: async (email) => {
      try {
        const { error } = await getSupabaseClient().auth.signInWithOtp({
          email: normalizeEmail(email),
          // Slaids never makes an account on sign-in: an address without one
          // gets an error, not a new Auth user.
          options: { shouldCreateUser: false },
        })
        return error ? { ok: false, failure: classifyAuthError(error, 'request-code') } : { ok: true }
      } catch (error) {
        return { ok: false, failure: classifyAuthError(error, 'request-code') }
      }
    },

    verifyCode: async (email, code, remember) => {
      // Before the call, so the session the SDK is about to save lands in the
      // chosen storage — and is removed from the other one.
      authSessionStorage.setPersistence(remember ? 'device' : 'tab')
      try {
        const { data, error } = await getSupabaseClient().auth.verifyOtp({
          email: normalizeEmail(email),
          token: code,
          type: 'email',
        })
        if (error || !data.session) {
          return { ok: false, failure: classifyAuthError(error, 'verify-code') }
        }
        apply(data.session)
        await get().refreshAccess()
        return { ok: true }
      } catch (error) {
        return { ok: false, failure: classifyAuthError(error, 'verify-code') }
      }
    },

    refreshAccess: () => {
      const { userId } = get()
      if (!userId) return Promise.resolve()
      if (accessCheck?.userId === userId) return accessCheck.promise
      const promise = readAccess(userId).finally(() => {
        if (accessCheck?.promise === promise) accessCheck = null
      })
      accessCheck = { userId, promise }
      return promise
    },

    signOut: async () => {
      // `local` scope, always. The default (`global`) revokes every refresh
      // token the user has, which would sign them out on every other device
      // because they closed Slaids in this tab. Signing out here means this
      // browser, and nothing else.
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
      // The next sign-in chooses its own storage.
      if (get().status !== 'signed-in') authSessionStorage.reset()

      if (error) {
        // Which of the two it is, is what `adoptStoredSession` just settled.
        notify.warning(
          get().status === 'signed-in'
            ? `Utloggingen feilet: ${describeAuthError(error)} Du er fortsatt innlogget.`
            : `Du er logget ut her, men serveren bekreftet det ikke: ${describeAuthError(error)}`,
        )
      }
    },
  }
})

/** Test seam: drop the auth listener so a suite can start over. */
export function stopSessionWatcher(): void {
  unsubscribe?.()
  unsubscribe = null
  accessCheck = null
}
