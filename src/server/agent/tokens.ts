/**
 * Deciding whether a request is authenticated, and to what.
 *
 * Pure by design: a credential's shape, its validity and the scopes it is short
 * of are all decisions, and decisions are what a test can hold on to. What an
 * agent token *is* and where it is stored lives in
 * `src/persistence/agentTokens.ts`, shared with the browser that creates them;
 * the database round trip lives in `supabase.ts`; and what an OAuth access
 * token is lives in `oauth.ts`.
 *
 * ## Two credential families, one principal
 *
 * There are two ways to be a caller, and they exist for two different kinds of
 * client rather than as a choice:
 *
 *  - an **agent token** (`slaids_at_…`), which the owner mints in the library
 *    and pastes into anything that can be handed a static string;
 *  - a **Supabase OAuth access token**, for a client that cannot be handed one
 *    — ChatGPT's custom MCP apps authorise over OAuth or not at all.
 *
 * What matters is where the difference *stops*. It stops here: both families
 * end as an `AgentPrincipal`, and every question after that — may this
 * principal run this operation, whose decks does it see, what does the audit
 * say — is asked once, of one value, by code that cannot tell which family it
 * came from. Two authorisation systems behind one API is the failure this
 * shape exists to make impossible; the discriminant below is for the audit,
 * not for a second set of rules.
 */

import type { AgentScope } from '../../agent/types'
import { looksLikeAgentToken, type AgentTokenRecord } from '../../persistence/agentTokens'
import type { AuditSubject } from './audit'
import { looksLikeJwt } from './oauth'

/** Which credential family authenticated a call. */
export type AgentCredentialKind = 'agent_token' | 'oauth'

/**
 * Who is calling, once a credential has been accepted.
 *
 * A union rather than a widened record with optional fields, because the two
 * families do not identify a caller with the same thing and pretending they do
 * is how a fake token row gets invented for an OAuth call. An agent token has a
 * row id and a name the owner chose; an OAuth token has the client the owner
 * approved. `ownerId` and `scopes` are what everything downstream reads, and
 * both families have them for real.
 */
export type AgentPrincipal =
  | {
      kind: 'agent_token'
      ownerId: string
      scopes: readonly AgentScope[]
      tokenId: string
      tokenName: string
    }
  | {
      kind: 'oauth'
      ownerId: string
      scopes: readonly AgentScope[]
      /** The OAuth client the owner approved. Public by construction, never a secret. */
      clientId: string
    }

/**
 * Why a request is not authenticated.
 *
 * Told apart internally so the server log can be specific. The *answer* is
 * deliberately not: every one of these produces the same 401 and the same
 * sentence, because "this token exists, it has just expired" is something only
 * the owner should learn, and an endpoint that says it answers questions on
 * behalf of whoever stole the token. That holds across both credential
 * families, and it is why the OAuth reasons below are as fine-grained as they
 * are: the detail is for the log, and the log is the owner's.
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
  /** Not a JWT, not an algorithm this resource verifies, or not readable JSON. */
  | 'oauth-malformed'
  /** The signature did not check out against the authorization server's keys. */
  | 'oauth-invalid'
  /** No published key with that `kid`, even after a refetch. */
  | 'oauth-unknown-key'
  /** The key set could not be fetched. Not the caller's fault, same answer. */
  | 'oauth-unavailable'
  /** Signed by a different authorization server than this deployment's. */
  | 'oauth-issuer'
  /** Issued for a different resource than this one. */
  | 'oauth-audience'
  /**
   * A token that is not a delegation: no `client_id`, so it never went through
   * an authorization-code flow — a plain browser session token, replayed.
   */
  | 'oauth-not-delegated'
  /** A registered client this deployment does not accept. */
  | 'oauth-client'
  /** Past `exp`. */
  | 'oauth-expired'
  /** A real user of the project, and not one this deployment lets into Slaids. */
  | 'oauth-unknown-owner'
  /** The deployment offers no OAuth at all, and something JWT-shaped arrived. */
  | 'oauth-unconfigured'

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
 * What this request presents, and whether it is good.
 *
 * The whole of "who is calling" for every transport, in one function, because
 * the two of them do not agree about *when* to ask and must not be allowed to
 * disagree about *what the answer means*. REST asks once, before it routes
 * anything; MCP asks before it reads the message and then decides per method
 * whether an answer of `missing` is allowed to stand. Both read the same header,
 * apply the same shape check and reach the same store.
 *
 * `missing` is the one outcome that is not a refusal on its own — nothing was
 * presented, so nothing was wrong — and it is what makes a public MCP method
 * possible without weakening anything. Every other outcome means a token *was*
 * presented and is not usable, and that is a refusal wherever it happens.
 */
export async function authenticateRequest(
  lookup: AgentTokenLookup,
  request: Request,
): Promise<AuthOutcome> {
  const presented = bearerToken(request.headers.get('authorization'))
  if (!presented) return { ok: false, reason: 'missing' }

  // Which family this is, decided by shape alone and before anything reaches a
  // database or a network. The two shapes cannot be confused for one another —
  // `slaids_at_` plus 43 base64url characters is not three dot-separated
  // segments — so this is a total split rather than a guess, and a string that
  // is neither is refused without a lookup.
  if (looksLikeAgentToken(presented)) return lookup.authenticate(presented)
  if (looksLikeJwt(presented)) {
    return lookup.authenticateOAuth
      ? lookup.authenticateOAuth(presented)
      : { ok: false, reason: 'oauth-unconfigured' }
  }
  return { ok: false, reason: 'malformed' }
}

/**
 * Resolving a presented credential. Never throws; a store that is down is an
 * outcome.
 *
 * `authenticateOAuth` is optional because OAuth is: a deployment that has not
 * been given an owner allowlist offers no authorization server, publishes no
 * metadata, and answers a JWT the same way it answers any other string that is
 * not an agent token.
 */
export interface AgentTokenLookup {
  authenticate(presentedToken: string): Promise<AuthOutcome>
  authenticateOAuth?(presentedToken: string): Promise<AuthOutcome>
}

/**
 * How the owner's log identifies whoever made a call.
 *
 * One branch, and it is the only place in the API where the two families are
 * told apart after authentication. That is deliberate: the audit is the one
 * thing that genuinely has to know which credential acted — §44 asks for agent
 * activity to be attributable — and inventing a token row for an OAuth call
 * would have made the log say something false rather than say less.
 */
export function auditSubject(principal: AgentPrincipal): AuditSubject {
  return principal.kind === 'agent_token'
    ? {
        kind: 'agent_token',
        ownerId: principal.ownerId,
        tokenId: principal.tokenId,
        tokenName: principal.tokenName,
      }
    : { kind: 'oauth', ownerId: principal.ownerId, clientId: principal.clientId }
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
    kind: 'agent_token',
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
      kind: 'agent_token',
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
  'oauth-malformed': 'OAUTH_TOKEN_MALFORMED',
  'oauth-invalid': 'OAUTH_SIGNATURE_INVALID',
  'oauth-unknown-key': 'OAUTH_UNKNOWN_KEY',
  'oauth-unavailable': 'OAUTH_KEYS_UNAVAILABLE',
  'oauth-issuer': 'OAUTH_WRONG_ISSUER',
  'oauth-audience': 'OAUTH_WRONG_AUDIENCE',
  'oauth-not-delegated': 'OAUTH_NOT_A_DELEGATION',
  'oauth-client': 'OAUTH_CLIENT_NOT_ALLOWED',
  'oauth-expired': 'OAUTH_TOKEN_EXPIRED',
  'oauth-unknown-owner': 'OAUTH_UNKNOWN_OWNER',
  'oauth-unconfigured': 'OAUTH_NOT_CONFIGURED',
}

/** The scopes an operation asks for that this principal does not hold. */
export function missingScopes(
  principal: Pick<AgentPrincipal, 'scopes'>,
  required: readonly AgentScope[],
): AgentScope[] {
  return required.filter((scope) => !principal.scopes.includes(scope))
}
