/**
 * Signing in to Slaids: an email address, then the six-digit code Supabase
 * sends to it.
 *
 * There is no password, no registration and no «create account». Accounts are
 * made by an administrator; an address without one is told so, in words that
 * say what to do about it.
 *
 * Every failure leaves the person one obvious next step: fix the address, type
 * the code again, wait the seconds shown, or ask for a new code. Supabase does
 * not tell a wrong code from an expired one, so neither does this screen — it
 * offers a new code for both.
 *
 * The screen never navigates. On `/oauth/consent` it is drawn in place, and the
 * consent screen appears at the same address once the code is accepted.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSessionStore } from '../../state/session'
import type { AuthFailure } from '../../supabase/authErrors'
import {
  RESEND_COOLDOWN_SECONDS,
  SIGN_IN_CODE_LENGTH,
  codeDigits,
  isCompleteCode,
} from './signInCode'

type Step = { kind: 'email' } | { kind: 'code'; email: string }

/**
 * Whole seconds left of a wait, ticking once a second, and the function that
 * starts one. The clock is read in the handler that starts the wait and in the
 * timer, never in an effect body, so a new wait shows its full length at once.
 */
function useCountdown(): [number, (seconds: number) => void] {
  const [deadline, setDeadline] = useState(0)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (deadline === 0) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= deadline) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [deadline])
  const begin = (seconds: number): void => {
    const current = Date.now()
    setNow(current)
    setDeadline(current + seconds * 1000)
  }
  return [Math.max(0, Math.ceil((deadline - now) / 1000)), begin]
}

export function SignInView() {
  const requestCode = useSessionStore((state) => state.requestCode)
  const verifyCode = useSessionStore((state) => state.verifyCode)

  const [step, setStep] = useState<Step>({ kind: 'email' })
  const [email, setEmail] = useState('')
  const [remember, setRemember] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'sending' | 'verifying' | null>(null)
  const [failure, setFailure] = useState<AuthFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [secondsToResend, waitBeforeResend] = useCountdown()
  const codeInput = useRef<HTMLInputElement>(null)

  /** Ask for a code, from either step. */
  const send = async (address: string): Promise<void> => {
    setBusy('sending')
    setFailure(null)
    setNotice(null)
    const outcome = await requestCode(address)
    setBusy(null)
    if (outcome.ok) {
      setStep({ kind: 'code', email: address })
      setCode('')
      setNotice(
        step.kind === 'code'
          ? 'Ny kode sendt. Bruk koden i den nyeste e-posten – den forrige virker ikke lenger.'
          : null,
      )
      waitBeforeResend(RESEND_COOLDOWN_SECONDS)
      return
    }
    const { failure: reason } = outcome
    if (reason.kind === 'email-rate-limit' && reason.retryAfterSeconds !== null) {
      // A code went out moments ago — after a reload, say, or a double click.
      // That code still works, so the useful next step is to type it.
      setStep({ kind: 'code', email: address })
      setNotice(
        `Det ble nettopp sendt en kode til denne adressen. Bruk den, eller be om en ny om ${reason.retryAfterSeconds} sekunder.`,
      )
      waitBeforeResend(reason.retryAfterSeconds)
      return
    }
    setFailure(reason)
  }

  const verify = async (address: string, value: string): Promise<void> => {
    if (busy || !isCompleteCode(value)) return
    setBusy('verifying')
    setFailure(null)
    setNotice(null)
    const outcome = await verifyCode(address, value, remember)
    // On success the gate replaces this screen; nothing more to do here.
    if (outcome.ok) return
    setBusy(null)
    setFailure(outcome.failure)
    if (outcome.failure.kind === 'invalid-code') setCode('')
    codeInput.current?.focus()
  }

  const submitEmail = (event: FormEvent): void => {
    event.preventDefault()
    const address = email.trim()
    if (busy || !address) return
    void send(address)
  }

  const changeCode = (value: string, address: string): void => {
    const digits = codeDigits(value)
    setCode(digits)
    // The last digit is the submit: nobody types six digits and then wants to
    // look for a button.
    if (isCompleteCode(digits)) void verify(address, digits)
  }

  const error = failure && (
    <p className="error-text auth__message" role="alert" data-testid="sign-in-error">
      {failure.message}
    </p>
  )

  if (step.kind === 'email') {
    return (
      <main className="auth" data-testid="sign-in">
        <form className="auth__card" onSubmit={submitEmail} noValidate>
          <h1 className="auth__title">Slaids</h1>
          <p className="auth__subtitle">
            Logg inn med e-postadressen din. Vi sender deg en kode – du trenger ikke passord.
          </p>

          <div className="field">
            <label htmlFor="auth-email">E-postadresse</label>
            <input
              id="auth-email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
              value={email}
              aria-invalid={failure?.kind === 'invalid-email' || failure?.kind === 'unknown-email'}
              data-testid="sign-in-email"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <label className="auth__remember">
            <input
              type="checkbox"
              checked={remember}
              data-testid="sign-in-remember"
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>
              Hold meg innlogget på denne enheten
              <span className="hint auth__remember-hint">
                Ellers logges du ut når du lukker nettleseren. Ikke velg dette på en delt
                datamaskin.
              </span>
            </span>
          </label>

          {error}

          <button
            type="submit"
            className="btn btn--primary auth__submit"
            disabled={busy !== null || email.trim().length === 0}
            data-testid="sign-in-send"
          >
            {busy === 'sending' ? 'Sender kode …' : 'Send kode'}
          </button>
        </form>
      </main>
    )
  }

  const address = step.email
  return (
    <main className="auth" data-testid="sign-in">
      <form
        className="auth__card"
        onSubmit={(event) => {
          event.preventDefault()
          void verify(address, code)
        }}
      >
        <h1 className="auth__title">Sjekk e-posten din</h1>
        <p className="auth__subtitle">
          Vi har sendt en sekssifret kode til{' '}
          <strong className="auth__address" data-testid="sign-in-address">
            {address}
          </strong>
          . Skriv den inn her.
        </p>

        <div className="field">
          <label htmlFor="auth-code">Kode</label>
          <input
            id="auth-code"
            ref={codeInput}
            className="input auth__code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            autoFocus
            required
            placeholder={'0'.repeat(SIGN_IN_CODE_LENGTH)}
            value={code}
            readOnly={busy === 'verifying'}
            aria-invalid={failure?.kind === 'invalid-code'}
            aria-describedby="auth-code-hint"
            data-testid="sign-in-code"
            onChange={(event) => changeCode(event.target.value, address)}
          />
          <p className="hint" id="auth-code-hint">
            Finner du ikke e-posten? Sjekk søppelposten, eller be om en ny kode.
          </p>
        </div>

        {notice && (
          <p className="hint auth__message" role="status" data-testid="sign-in-notice">
            {notice}
          </p>
        )}
        {error}

        <button
          type="submit"
          className="btn btn--primary auth__submit"
          disabled={busy !== null || !isCompleteCode(code)}
          data-testid="sign-in-verify"
        >
          {busy === 'verifying' ? 'Logger inn …' : 'Logg inn'}
        </button>

        <div className="auth__links">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy !== null || secondsToResend > 0}
            data-testid="sign-in-resend"
            onClick={() => void send(address)}
          >
            {secondsToResend > 0 ? `Send ny kode om ${secondsToResend} s` : 'Send ny kode'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy !== null}
            data-testid="sign-in-change-email"
            onClick={() => {
              setStep({ kind: 'email' })
              setCode('')
              setFailure(null)
              setNotice(null)
            }}
          >
            Bruk en annen adresse
          </button>
        </div>
      </form>
    </main>
  )
}
