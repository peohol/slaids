/**
 * Deciding whether a request is authenticated, and to what.
 *
 * Pure by design: a token's shape, its validity and the scopes it is short of
 * are all decisions, and decisions are what a test can hold on to. What a token
 * *is* and where it is stored lives in `src/persistence/agentTokens.ts`, shared
 * with the browser that creates them; the database round trip lives in
 * `supabase.ts`.
 */

import type { AgentScope } from '../../agent/types'
import type { AgentTokenRecord } from '../../persistence/agentTokens'
import type { AuditSubject } from './audit'

/** Who is calling, once a token has been accepted. */
export interface AgentPrincipal {
  tokenId: string
  tokenName: string
  ownerId: string
  scopes: readonly AgentScope[]
}

/**
 * Why a request is not authenticated.
 *
 * Told apart internally so the server log can be specific. The *answer* is
 * deliberately not: every one of these produces the same 401 and the same
 * sentence, because "this token exists, it has just expired" is something only
 * the owner should learn, and an endpoint that says it answers questions on
 * behalf of whoever stole the token.
 */
export type AuthFailure =
  | 'missing'
  | 'malformed'
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'no-scopes'
  /** The token store itself did not answer. Not the caller's fault, same answer. */
  | 'unavailable'

export type AuthOutcome =
  | { ok: true; principal: AgentPrincipal }
  | {
      ok: false
      reason: AuthFailure
      /**
       * Set when the presented token *was* found — revoked, expired or left
       * without usable scopes. It is what lets the refusal be audited: the
       * owner needs to be able to see that a token they took away is still
       * being presented, and by which agent. A token nobody recognises has
       * nobody to attribute, and writes no row.
       */
      identified?: AuditSubject
    }

/**
 * The token out of an `Authorization` header.
 *
 * One way in, on purpose. A second accepted header is a second thing to get
 * right, and `Bearer` is what every HTTP client already knows how to send.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim())
  return match ? match[1] : null
}

/**
 * Whether a stored token may act, right now.
 *
 * Order matters only for the log — all of these answer the same thing outward —
 * and revocation is checked before expiry because "the owner took this away" is
 * the more useful thing to see there.
 */
export function tokenValidity(record: AgentTokenRecord | null, now: Date): AuthOutcome {
  if (!record) return { ok: false, reason: 'unknown' }
  const identified: AuditSubject = {
    ownerId: record.ownerId,
    tokenId: record.id,
    tokenName: record.name,
  }
  if (record.revokedAt) return { ok: false, reason: 'revoked', identified }
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) {
    return { ok: false, reason: 'expired', identified }
  }
  // A token whose stored scopes are all unrecognised can do nothing. Refusing it
  // here rather than letting it through to fail per operation is the fail-closed
  // direction: an unknown scope is never treated as authority.
  if (record.scopes.length === 0) return { ok: false, reason: 'no-scopes', identified }
  return {
    ok: true,
    principal: {
      tokenId: record.id,
      tokenName: record.name,
      ownerId: record.ownerId,
      scopes: record.scopes,
    },
  }
}

/**
 * How a refusal is recorded in the owner's own log.
 *
 * The *caller* is told only `UNAUTHENTICATED`, always. These codes exist for the
 * audit, where "the token you revoked was presented again" is the whole point of
 * having one — and where there is no attacker to leak it to, because only the
 * owner can read it.
 */
export const REFUSAL_CODES: Record<AuthFailure, string> = {
  missing: 'TOKEN_MISSING',
  malformed: 'TOKEN_MALFORMED',
  unknown: 'TOKEN_UNKNOWN',
  revoked: 'TOKEN_REVOKED',
  expired: 'TOKEN_EXPIRED',
  'no-scopes': 'TOKEN_WITHOUT_SCOPES',
  unavailable: 'TOKEN_STORE_UNAVAILABLE',
}

/** The scopes an operation asks for that this principal does not hold. */
export function missingScopes(
  principal: Pick<AgentPrincipal, 'scopes'>,
  required: readonly AgentScope[],
): AgentScope[] {
  return required.filter((scope) => !principal.scopes.includes(scope))
}
