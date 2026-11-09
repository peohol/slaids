import { describe, expect, it } from 'vitest'
import { classifyAuthError, describeAuthError, type AuthFailureKind } from './authErrors'

/** The shape auth-js gives an `AuthApiError`. */
function apiError(status: number, code: string | undefined, message: string) {
  return { name: 'AuthApiError', status, code, message }
}

describe('feilmeldinger ved innlogging', () => {
  const cases: [string, unknown, 'request-code' | 'verify-code', AuthFailureKind][] = [
    ['nettverksbrudd', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'request-code', 'network'],
    ['kastet fetch-feil', new TypeError('Failed to fetch'), 'verify-code', 'network'],
    ['adresse uten konto', apiError(422, 'otp_disabled', 'Signups not allowed for otp'), 'request-code', 'unknown-email'],
    ['adresse uten konto, eldre server uten kode', apiError(422, undefined, 'Signups not allowed for otp'), 'request-code', 'unknown-email'],
    ['for kort tid siden forrige kode', apiError(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 37 seconds.'), 'request-code', 'email-rate-limit'],
    ['e-postkvoten brukt opp', apiError(429, 'over_email_send_rate_limit', 'email rate limit exceeded'), 'request-code', 'email-rate-limit'],
    ['for mange forespørsler', apiError(429, 'over_request_rate_limit', 'Request rate limit reached'), 'verify-code', 'request-rate-limit'],
    ['innebygd e-post når ikke fram', apiError(400, 'email_address_not_authorized', 'Email address not authorized'), 'request-code', 'email-not-deliverable'],
    ['ugyldig adresse', apiError(400, 'email_address_invalid', 'Email address is invalid'), 'request-code', 'invalid-email'],
    ['feil eller utløpt kode', apiError(403, 'otp_expired', 'Token has expired or is invalid'), 'verify-code', 'invalid-code'],
    ['kode med feil format', apiError(400, 'validation_failed', 'Invalid token'), 'verify-code', 'invalid-code'],
    ['noe annet', apiError(500, 'unexpected_failure', 'boom'), 'verify-code', 'other'],
  ]

  it.each(cases)('%s', (_name, error, step, kind) => {
    const failure = classifyAuthError(error, step)
    expect(failure.kind).toBe(kind)
    // Alt vises for brukeren, og Supabases engelske standardtekster skal ikke
    // være hele forklaringen.
    expect(failure.message.length).toBeGreaterThan(0)
    if (kind !== 'other') expect(failure.message).not.toMatch(/token|otp|rate limit/i)
  })

  it('bruker ventetiden Supabase oppgir', () => {
    const failure = classifyAuthError(
      apiError(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 37 seconds.'),
      'request-code',
    )
    expect(failure.retryAfterSeconds).toBe(37)
    expect(failure.message).toMatch(/37 sekunder/)
  })

  it('lover ingen bestemt ventetid når Supabase ikke oppgir en', () => {
    const failure = classifyAuthError(apiError(429, 'over_email_send_rate_limit', 'email rate limit exceeded'), 'request-code')
    expect(failure.retryAfterSeconds).toBeNull()
  })

  it('sier at koden kan være feil eller utløpt, siden Supabase ikke skiller dem', () => {
    const { message } = classifyAuthError(apiError(403, 'otp_expired', 'Token has expired or is invalid'), 'verify-code')
    expect(message).toMatch(/stemmer ikke/)
    expect(message).toMatch(/utløpt/)
    expect(message).toMatch(/ny kode/)
  })

  it('beskriver en øktfeil utenfor skjemaet med samme regel', () => {
    expect(describeAuthError({ name: 'AuthRetryableFetchError', message: 'x' })).toMatch(/Fikk ikke kontakt/)
  })
})
