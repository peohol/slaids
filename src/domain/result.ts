/**
 * Typed result / error plumbing for domain commands.
 *
 * Domain commands never throw for expected failures and never mutate their
 * inputs; they return `Ok` with a new value or `Err` with a typed code.
 */

export type DomainErrorCode =
  | 'NODE_NOT_FOUND'
  | 'NODE_NOT_LEAF'
  | 'NODE_NOT_SPLIT'
  | 'INVALID_WEIGHTS'
  | 'INVALID_CHILD_COUNT'
  | 'ZONE_TOO_SMALL'
  | 'CONTENT_DOES_NOT_FIT'
  | 'TARGET_OCCUPIED'
  | 'TARGET_EMPTY'
  | 'ROOT_CANNOT_BE_DELETED'
  | 'INVALID_CONTENT'
  | 'SLIDE_NOT_FOUND'
  | 'SLIDE_INDEX_OUT_OF_RANGE'
  | 'CANNOT_DELETE_LAST_SLIDE'
  | 'REFERENCE_NOT_FOUND'
  | 'REFERENCE_INVALID'
  | 'SANDBOX_ITEM_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'SUBFIELD_NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'TITLE_ALREADY_PRESENT'
  | 'TITLE_ABSENT'

export interface DomainError {
  code: DomainErrorCode
  message: string
  details?: Record<string, unknown>
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<T = never>(
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Result<T> {
  return { ok: false, error: details ? { code, message, details } : { code, message } }
}

export function isOk<T>(result: Result<T>): result is { ok: true; value: T } {
  return result.ok
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback
}

/** Norwegian, user-facing messages for the typed error codes. */
export const ERROR_MESSAGES_NB: Record<DomainErrorCode, string> = {
  NODE_NOT_FOUND: 'Fant ikke sonen.',
  NODE_NOT_LEAF: 'Sonen er delt opp og kan ikke ha innhold direkte.',
  NODE_NOT_SPLIT: 'Sonen er ikke delt opp.',
  INVALID_WEIGHTS: 'Forholdstallene er ugyldige.',
  INVALID_CHILD_COUNT: 'Antall subsoner må være mellom 2 og 10.',
  ZONE_TOO_SMALL: 'Sonen blir for liten til å brukes.',
  CONTENT_DOES_NOT_FIT: 'Innholdet får ikke plass i sonen.',
  TARGET_OCCUPIED: 'Sonen har allerede innhold.',
  TARGET_EMPTY: 'Sonen har ikke innhold.',
  ROOT_CANNOT_BE_DELETED: 'Hovedsonen kan ikke slettes.',
  INVALID_CONTENT: 'Innholdet er ugyldig.',
  SLIDE_NOT_FOUND: 'Fant ikke sliden.',
  SLIDE_INDEX_OUT_OF_RANGE: 'Ugyldig slideposisjon.',
  CANNOT_DELETE_LAST_SLIDE: 'Presentasjonen må ha minst én slide.',
  REFERENCE_NOT_FOUND: 'Fant ikke referansen.',
  REFERENCE_INVALID: 'Referansen må ha minst tittel, forfatter eller lenke.',
  SANDBOX_ITEM_NOT_FOUND: 'Fant ikke elementet i sandkassen.',
  ASSET_NOT_FOUND: 'Fant ikke filen.',
  SUBFIELD_NOT_FOUND: 'Fant ikke subfeltet.',
  INVALID_ARGUMENT: 'Ugyldig verdi.',
  TITLE_ALREADY_PRESENT: 'Sliden har allerede en overskrift.',
  TITLE_ABSENT: 'Sliden har ingen overskrift.',
}

export function describeError(error: DomainError): string {
  return error.message || ERROR_MESSAGES_NB[error.code]
}
