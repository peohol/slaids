/**
 * Sign-in screen for Slaids' single personal account.
 *
 * There is deliberately no account picker, registration or account-related
 * product copy here. Slaids only asks for the password for its one allowed
 * Supabase Auth user.
 */

import { useState, type FormEvent } from 'react'
import { useSessionStore } from '../../state/session'
import { SLAIDS_OWNER_EMAIL } from '../../supabase/access'

export function SignInView() {
  const signIn = useSessionStore((state) => state.signIn)
  const signingIn = useSessionStore((state) => state.signingIn)
  const signInError = useSessionStore((state) => state.signInError)

  const [password, setPassword] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (signingIn || !password) return
    void signIn(SLAIDS_OWNER_EMAIL, password)
  }

  const visibleError =
    signInError === 'Feil e-post eller passord.' ? 'Feil passord.' : signInError

  return (
    <div className="auth" data-testid="sign-in">
      <form className="auth__card" onSubmit={submit}>
        <h1 className="auth__title">Slaids</h1>
        <p className="auth__subtitle">Logg inn for å åpne biblioteket ditt.</p>

        <div className="field">
          <label htmlFor="auth-password">Passord</label>
          <input
            id="auth-password"
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            data-testid="sign-in-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {visibleError && (
          <p className="error-text" role="alert" data-testid="sign-in-error">
            {visibleError}
          </p>
        )}

        <button
          type="submit"
          className="btn btn--primary auth__submit"
          disabled={signingIn}
          data-testid="sign-in-submit"
        >
          {signingIn ? 'Logger inn …' : 'Logg inn'}
        </button>
      </form>
    </div>
  )
}
