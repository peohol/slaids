/**
 * What a failed Supabase Auth call means for the person in front of Slaids.
 *
 * Supabase answers in English and in its own vocabulary. This is the one place
 * that turns those answers into what happened and what to do next, so the
 * sign-in screen, the session store and the tests agree on every case.
 *
 * Supabase does not tell a wrong code from an expired one — both are
 * `otp_expired` — so neither does this: the message names both and the screen
 * offers a new code either way.
 */

export type AuthFailureKind =
  /** The request never got an answer. */
  | 'network'
  /** No Auth account for that address; Slaids never creates one on sign-in. */
  | 'unknown-email'
  /** Too soon after the last code, or the project's email quota is used up. */
  | 'email-rate-limit'
  /** Too many requests of any kind from here. */
  | 'request-rate-limit'
  /** The project's email sender will not deliver to this address. */
  | 'email-not-deliverable'
  | 'invalid-email'
  /** Wrong or expired code — Supabase does not say which. */
  | 'invalid-code'
  | 'other'

export interface AuthFailure {
  kind: AuthFailureKind
  message: string
  /** When Supabase said how long to wait, in seconds. */
  retryAfterSeconds: number | null
}

/** Which call failed: the same error code can mean different things in each. */
export type AuthStep = 'request-code' | 'verify-code' | 'session'

interface AuthErrorLike {
  name?: unknown
  status?: unknown
  code?: unknown
  message?: unknown
}

function fieldsOf(error: unknown): AuthErrorLike {
  return error && typeof error === 'object' ? (error as AuthErrorLike) : {}
}

/** «… you can only request this after 42 seconds.» */
function secondsToWait(message: string): number | null {
  const match = /after (\d+) seconds?/i.exec(message)
  return match ? Number(match[1]) : null
}

function failure(
  kind: AuthFailureKind,
  message: string,
  retryAfterSeconds: number | null = null,
): AuthFailure {
  return { kind, message, retryAfterSeconds }
}

export function classifyAuthError(error: unknown, step: AuthStep): AuthFailure {
  const { name, status, code, message: rawMessage } = fieldsOf(error)
  const message = typeof rawMessage === 'string' ? rawMessage : ''

  // No HTTP status means the request never got an answer.
  if (name === 'AuthRetryableFetchError' || typeof status !== 'number' || status === 0) {
    return failure('network', 'Fikk ikke kontakt med Supabase. Sjekk nettverket og prøv igjen.')
  }

  if (code === 'otp_disabled' || /signups? not allowed/i.test(message)) {
    return failure(
      'unknown-email',
      'Denne e-postadressen har ikke en Slaids-konto. Sjekk at den er skrevet riktig. Kontoer opprettes av en administrator.',
    )
  }

  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(message)) {
    const seconds = secondsToWait(message)
    return seconds !== null
      ? failure('email-rate-limit', `Vent ${seconds} sekunder før du ber om en ny kode.`, seconds)
      : failure(
          'email-rate-limit',
          'Det er sendt for mange e-poster på kort tid. Vent litt og prøv igjen – det kan ta opptil en time.',
        )
  }

  if (code === 'over_request_rate_limit' || status === 429) {
    return failure(
      'request-rate-limit',
      'For mange forsøk på kort tid. Vent et par minutter og prøv igjen.',
      secondsToWait(message),
    )
  }

  if (code === 'email_address_not_authorized') {
    return failure(
      'email-not-deliverable',
      'Slaids kan ikke sende e-post til denne adressen ennå. Be en administrator om hjelp.',
    )
  }

  if (step === 'verify-code' && (code === 'otp_expired' || status === 401 || status === 403)) {
    return failure(
      'invalid-code',
      'Koden stemmer ikke, eller den er utløpt. Sjekk sifrene, eller be om en ny kode.',
    )
  }

  if (code === 'email_address_invalid' || (step === 'request-code' && code === 'validation_failed')) {
    return failure('invalid-email', 'Sjekk at e-postadressen er skrevet riktig.')
  }

  if (step === 'verify-code' && code === 'validation_failed') {
    return failure('invalid-code', 'Koden stemmer ikke. Den består av seks sifre.')
  }

  return failure('other', message ? `Noe gikk galt: ${message}` : 'Noe gikk galt. Prøv igjen.')
}

/** One sentence for an Auth error outside the sign-in form (start, sign-out). */
export function describeAuthError(error: unknown): string {
  return classifyAuthError(error, 'session').message
}
