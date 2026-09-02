/**
 * Decides what the app is allowed to show.
 *
 * In Supabase mode nothing — not the library, not the editor — is mounted
 * before there is a session, so no request is ever made without one. In local
 * mode there is no gate at all and the app behaves exactly as it did before
 * Supabase existed.
 */

import { useEffect, type ReactNode } from 'react'
import { useSessionStore, type SessionStatus } from '../../state/session'
import { SignInView } from './SignInView'

export type GateView = 'app' | 'loading' | 'sign-in' | 'unavailable' | 'misconfigured'

/**
 * The whole rule, in one place: the app is reachable only in local mode or with
 * a session. Every other state is a screen of its own.
 */
export function gateView(status: SessionStatus): GateView {
  switch (status) {
    case 'disabled':
    case 'signed-in':
      return 'app'
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

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status)
  const error = useSessionStore((state) => state.error)
  const start = useSessionStore((state) => state.start)

  useEffect(() => {
    void start()
  }, [start])

  const view = gateView(status)

  if (view === 'app') return <>{children}</>

  if (view === 'misconfigured') {
    // No retry: a missing build variable is not something this page can fix.
    return (
      <div className="auth" data-testid="auth-misconfigured">
        <div className="auth__card">
          <h1 className="auth__title">Slaids</h1>
          <p className="error-text" role="alert">
            {error ?? 'Supabase-oppsettet er ufullstendig.'}
          </p>
        </div>
      </div>
    )
  }

  if (view === 'unavailable') {
    return (
      <div className="auth" data-testid="auth-unavailable">
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
      </div>
    )
  }

  if (view === 'loading') {
    return (
      <div className="auth" data-testid="auth-loading">
        <p className="hint">Sjekker innlogging …</p>
      </div>
    )
  }

  return <SignInView />
}
