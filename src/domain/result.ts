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
  | 'NOT_A_CONTENT_SLIDE'
  | 'NOT_A_SECTION_SLIDE'
  | 'NOT_AN_INTERACTIVE_SLIDE'
  | 'INVALID_INTERACTIVE_FILE'
  | 'INTERACTIVE_HTML_TOO_LARGE'
  | 'INTERACTIVE_BUDGET_EXCEEDED'
  | 'FIRST_SLIDE_MUST_BE_SECTION'
  | 'REFERENCE_NOT_FOUND'
  | 'REFERENCE_INVALID'
  | 'SANDBOX_ITEM_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_IN_USE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INVALID_IMAGE'
  | 'ASSET_TOO_LARGE'
  | 'INVALID_SVG'
  | 'UNSAFE_SVG'
  | 'SUBFIELD_NOT_FOUND'
  | 'INVALID_ARGUMENT'
  /**
   * A folder id the library does not have: named by an agent, or renamed from a
   * tab that still shows a folder deleted elsewhere. A move into a folder that
   * does not exist would not be visible anywhere — not at the root, not in any
   * folder — and a rename must not bring a deleted folder back, so both are
   * refused rather than stored.
   */
  | 'FOLDER_NOT_FOUND'
  | 'TITLE_ALREADY_PRESENT'
  | 'TITLE_ABSENT'
  /**
   * Two pieces of air would meet that cannot be merged into one without
   * changing the proportions of the content beside them: the 1–10 ladder
   * cannot show that content with a single piece of air. See
   * `domain/negativeSpace.ts`.
   */
  | 'NEGATIVE_SPACE_CANNOT_MERGE'

export interface DomainError {
  code: DomainErrorCode
  message: string
  details?: Record<string, unknown>
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError }

/**
 * A refusal on its own.
 *
 * The return type of a check that answers «what is wrong with this?» rather
 * than «what is this?»: `null` when nothing is, and otherwise a value that is
 * still a `Result` and can be returned straight out of a command. Naming the
 * half is what lets the caller read `refusal.error` without narrowing a union
 * whose other branch it has already ruled out.
 */
export type Refusal = Extract<Result<never>, { ok: false }>

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/**
 * A refusal, typed as one.
 *
 * The narrow half rather than `Result<T>`: a refusal is assignable to every
 * `Result`, so a command still returns it directly, and a caller that holds one
 * can read `error` without narrowing away a success branch that cannot exist.
 */
export function err(
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Refusal {
  return { ok: false, error: details ? { code, message, details } : { code, message } }
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
  NOT_A_CONTENT_SLIDE: 'Sliden har ingen soner.',
  NOT_A_SECTION_SLIDE: 'Sliden er ikke en inndeling.',
  NOT_AN_INTERACTIVE_SLIDE: 'Sliden er ikke en miniapp.',
  INVALID_INTERACTIVE_FILE: 'Filen kan ikke brukes som miniapp.',
  INTERACTIVE_HTML_TOO_LARGE: 'HTML-filen er for stor.',
  INTERACTIVE_BUDGET_EXCEEDED: 'Presentasjonen har ikke plass til flere miniapper.',
  FIRST_SLIDE_MUST_BE_SECTION: 'Første slide må være en inndeling.',
  REFERENCE_NOT_FOUND: 'Fant ikke referansen.',
  REFERENCE_INVALID: 'Referansen må ha minst tittel, forfatter eller lenke.',
  SANDBOX_ITEM_NOT_FOUND: 'Fant ikke elementet i sandkassen.',
  ASSET_NOT_FOUND: 'Fant ikke filen.',
  ASSET_IN_USE: 'Filen vises i dekket og kan ikke slettes.',
  UNSUPPORTED_MEDIA_TYPE: 'Filtypen støttes ikke.',
  INVALID_IMAGE: 'Bildefilen er ufullstendig eller ødelagt.',
  ASSET_TOO_LARGE: 'Filen er for stor.',
  INVALID_SVG: 'SVG-en er ugyldig.',
  UNSAFE_SVG: 'SVG-en inneholder noe som ikke er trygt å lagre.',
  SUBFIELD_NOT_FOUND: 'Fant ikke subfeltet.',
  INVALID_ARGUMENT: 'Ugyldig verdi.',
  FOLDER_NOT_FOUND: 'Fant ikke mappen.',
  TITLE_ALREADY_PRESENT: 'Sliden har allerede en overskrift.',
  TITLE_ABSENT: 'Sliden har ingen overskrift.',
  NEGATIVE_SPACE_CANNOT_MERGE:
    'Luften her kan ikke slås sammen med luften ved siden av uten å endre forholdet mellom sonene.',
}

export function describeError(error: DomainError): string {
  return error.message || ERROR_MESSAGES_NB[error.code]
}
