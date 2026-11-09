/**
 * Decides what the app is allowed to show.
 *
 * In Supabase mode nothing — not the library, not the editor — is mounted
 * before the signed-in Auth user is an active Slaids user, so no Slaids
 * request is ever made for someone outside the access list. The database
 * enforces the same list on every request; this gate is what lets the app say
 * so in words instead of showing an empty library. In local mode there is no
 * gate at all and the app behaves exactly as it did before Supabase existed.
 */

import { useEffect, type ReactNode } from 'react'
import { useSessionStore, type AccessStatus, type SessionStatus } from '../../state/session'
import { SignInView } from './SignInView'
import { throttleWithTrailing } from './throttle'

export type GateView =
  | 'app'
  | 'loading'
  | 'sign-in'
  | 'no-access'
  | 'deactivated'
  | 'unavailable'
  | 'misconfigured'

/**
 * How often, at most, coming back to the tab asks the access list again. A
 * deactivation reaches an open tab this quickly; the database refuses the
 * account's requests from the moment it happens either way.
 */
export const ACCESS_RECHECK_INTERVAL_MS = 15_000

/** The whole gate rule, in one place: session status first, then access. */
export function gateView(status: SessionStatus, access: AccessStatus | null): GateView {
  switch (status) {
    case 'disabled':
      return 'app'
    case 'signed-in':
      switch (access) {
        case 'member':
          return 'app'
        case 'no-access':
          return 'no-access'
        case 'deactivated':
          return 'deactivated'
        default:
          return 'loading'
      }
    case 'unavailable':
      return 'unavailable'
    case 'misconfigured':
      return 'misconfigured'
    case 'loading':
      return 'loading'
    case 'signed-out':
      return 'sign-in'
  }
}

/**
 * Ask the access list again when the person comes back to the tab — at most
 * once per interval, and a return inside the interval is answered when it ends
 * rather than ignored.
 */
function useAccessRecheck(active: boolean): void {
  const refreshAccess = useSessionStore((state) => state.refreshAccess)
  useEffect(() => {
    if (!active) return
    // Counted from now: the gate has just been let through by a fresh check.
    const throttled = throttleWithTrailing(() => void refreshAccess(), ACCESS_RECHECK_INTERVAL_MS)
    const recheck = (): void => {
      if (document.visibilityState === 'visible') throttled.call()
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      throttled.cancel()
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [active, refreshAccess])
}

/** Signed in, but not let in: who, why, and the two ways out. */
function AccessRefused({ kind }: { kind: 'no-access' | 'deactivated' }) {
  const email = useSessionStore((state) => state.email)
  const signOut = useSessionStore((state) => state.signOut)
  const refreshAccess = useSessionStore((state) => state.refreshAccess)
  const who = email ?? 'denne kontoen'
  return (
    <main className="auth" data-testid={`auth-${kind}`}>
      <div className="auth__card">
        <h1 className="auth__title">
          {kind === 'deactivated' ? 'Kontoen er deaktivert' : 'Ingen tilgang til Slaids'}
        </h1>
        <p className="auth__subtitle">
          {kind === 'deactivated'
            ? `Kontoen ${who} er deaktivert og har ikke lenger tilgang til Slaids. Ta kontakt med en administrator hvis du mener dette er feil.`
            : `Du er logget inn som ${who}, men denne adressen har ikke en Slaids-konto. Kontoer opprettes av en administrator.`}
        </p>
        <button
          type="button"
          className="btn btn--primary auth__submit"
          onClick={() => void signOut()}
          data-testid="auth-sign-out"
        >
          Logg ut
        </button>
        <button
          type="button"
          className="btn btn--ghost auth__submit"
          onClick={() => void refreshAccess()}
          data-testid="auth-recheck"
        >
          Sjekk tilgangen på nytt
        </button>
      </div>
    </main>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status)
  const access = useSessionStore((state) => state.access)
  const error = useSessionStore((state) => state.error)
  const start = useSessionStore((state) => state.start)

  useEffect(() => {
    void start()
  }, [start])

  useAccessRecheck(status === 'signed-in')

  const view = gateView(status, access)

  if (view === 'app') return <>{children}</>

  if (view === 'no-access' || view === 'deactivated') return <AccessRefused kind={view} />

  if (view === 'misconfigured') {
    // No retry: a missing build variable is not something this page can fix.
    return (
      <main className="auth" data-testid="auth-misconfigured">
        <div className="auth__card">
          <h1 className="auth__title">Slaids</h1>
          <p className="error-text" role="alert">
            {error ?? 'Supabase-oppsettet er ufullstendig.'}
          </p>
        </div>
      </main>
    )
  }

  if (view === 'unavailable') {
    return (
      <main className="auth" data-testid="auth-unavailable">
        <div className="auth__card">
          <h1 className="auth__title">Slaids</h1>
          <p className="error-text" role="alert">
            {error ?? 'Fikk ikke kontakt med Supabase.'}
          </p>
          <p className="hint">
            Slaids er satt opp mot Supabase og lagrer ikke lokalt. Prøv igjen når
            tjenesten svarer.
          </p>
          <button
            type="button"
            className="btn btn--primary auth__submit"
            onClick={() => void start()}
            data-testid="auth-retry"
          >
            Prøv igjen
          </button>
        </div>
      </main>
    )
  }

  if (view === 'loading') {
    return (
      <main className="auth" data-testid="auth-loading">
        <p className="hint">
          {status === 'signed-in' ? 'Sjekker tilgang …' : 'Sjekker innlogging …'}
        </p>
      </main>
    )
  }

  return <SignInView />
}
