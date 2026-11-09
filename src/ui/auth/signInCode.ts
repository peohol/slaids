/**
 * The sign-in code, as Slaids asks for it.
 *
 * The length is Supabase's «Email OTP length» setting for the project, set to
 * six (`docs/MULTI_USER_PLAN.md` § 6). The wait between two codes mirrors
 * Supabase's own minimum interval per address; when Supabase names a different
 * wait, the screen follows Supabase instead (`AuthFailure.retryAfterSeconds`).
 */

export const SIGN_IN_CODE_LENGTH = 6

export const RESEND_COOLDOWN_SECONDS = 60

/**
 * The digits of what was typed or pasted, at most a whole code. A code pasted
 * from an email often arrives as «123 456» or with a trailing line break.
 */
export function codeDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, SIGN_IN_CODE_LENGTH)
}

export function isCompleteCode(code: string): boolean {
  return code.length === SIGN_IN_CODE_LENGTH && /^\d+$/.test(code)
}
