/**
 * Sign-in screen.
 *
 * Accounts live in the Supabase project Slaids shares with Huskis, so this is
 * a sign-in form and nothing else: no registration, no password reset, no
 * account state of Slaids' own.
 */

import { useState, type FormEvent } from 'react'
import { useSessionStore } from '../../state/session'

export function SignInView() {
  const signIn = useSessionStore((state) => state.signIn)
  const signingIn = useSessionStore((state) => state.signingIn)
  const signInError = useSessionStore((state) => state.signInError)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (signingIn || !email.trim() || !password) return
    void signIn(email, password)
  }

  return (
    <div className="auth" data-testid="sign-in">
      <form className="auth__card" onSubmit={submit}>
        <h1 className="auth__title">Slaids</h1>
        <p className="auth__subtitle">Logg inn for å åpne biblioteket ditt.</p>

        <div className="field">
          <label htmlFor="auth-email">E-post</label>
          <input
            id="auth-email"
            className="input"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            data-testid="sign-in-email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="auth-password">Passord</label>
          <input
            id="auth-password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            data-testid="sign-in-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {signInError && (
          <p className="error-text" role="alert" data-testid="sign-in-error">
            {signInError}
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

        <p className="hint">
          Slaids bruker samme konto som Huskis. Kontoer opprettes ikke herfra.
        </p>
      </form>
    </div>
  )
}
