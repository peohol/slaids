/**
 * The wire contract: what an answer looks like, and which HTTP status it gets.
 *
 * `IMPLEMENTATION_PLAN.md` §44 asks for results an agent can act on from the
 * machine-readable parts alone. So every response is one of exactly two shapes,
 * the code is the same vocabulary the domain already speaks, and the status is
 * a second, coarser reading of that same code — never a third opinion.
 *
 * The status table is a total `Record` over every code on purpose: adding an
 * error code anywhere in the domain or in this layer stops the build here until
 * somebody decides what it means over HTTP. A default branch would instead have
 * quietly answered `500` for a new fit error, which an agent would read as "the
 * server is broken" rather than "shorten the text".
 */

import type { AgentError, AgentErrorCode } from '../../agent/types'

/** Failures that belong to the transport, not to Agent Core. */
export type TransportErrorCode =
  /** No token, a token that is not one, or one the database will not honour. */
  | 'UNAUTHENTICATED'
  /** A valid token without the authority this operation needs. */
  | 'FORBIDDEN_SCOPE'
  /** No such route. Not the same as `UNKNOWN_OPERATION`, which is a real route. */
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'REQUEST_TOO_LARGE'
  | 'MALFORMED_BODY'
  /** The deployment has no Supabase to act on; see `config.ts`. */
  | 'SERVER_NOT_CONFIGURED'

export type ApiErrorCode = AgentErrorCode | TransportErrorCode

export interface ApiError {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
}

export type ApiResponseBody =
  | {
      ok: true
      operation?: string
      /**
       * The reading this answer produced, lifted out of `data` where there is
       * one. Copied rather than moved: an agent that reads the envelope and an
       * agent that reads the operation's own result both find it.
       */
      revision?: string
      data: unknown
    }
  | { ok: false; operation?: string; error: ApiError }

/**
 * Code → status.
 *
 *  - `409 CONFLICT` is the one §44 names explicitly: a stale write has to be
 *    something an agent can branch on without parsing prose, and it is the
 *    signal to read again before retrying.
 *  - `422` is the bulk of the domain: the request was understood and the rules
 *    refused it. Content that does not fit is the archetype — nothing about the
 *    request was malformed, and retrying it unchanged will fail again.
 *  - `400` is reserved for a request that was wrong on its face, so an agent
 *    can tell "I sent nonsense" from "Slaids said no".
 *  - `502` for a store that did not answer, never `500`: the API is up, the
 *    thing behind it is not, and retrying later is reasonable.
 */
export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  // Transport
  UNAUTHENTICATED: 401,
  FORBIDDEN_SCOPE: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UNSUPPORTED_CONTENT_TYPE: 415,
  REQUEST_TOO_LARGE: 413,
  MALFORMED_BODY: 400,
  SERVER_NOT_CONFIGURED: 503,

  // Agent Core
  UNKNOWN_OPERATION: 404,
  INVALID_INPUT: 400,
  PRESENTATION_NOT_FOUND: 404,
  STORAGE_FAILED: 502,
  CONFLICT: 409,
  SHARING_UNAVAILABLE: 501,
  INTERNAL_ERROR: 500,

  // Domain — addressing
  SLIDE_NOT_FOUND: 404,
  NODE_NOT_FOUND: 404,
  SUBFIELD_NOT_FOUND: 404,
  REFERENCE_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  SANDBOX_ITEM_NOT_FOUND: 404,

  // Domain — the request itself was wrong
  INVALID_ARGUMENT: 400,
  INVALID_WEIGHTS: 400,
  INVALID_CHILD_COUNT: 400,
  INVALID_CONTENT: 400,
  REFERENCE_INVALID: 400,
  SLIDE_INDEX_OUT_OF_RANGE: 400,
  INVALID_SVG: 400,
  INVALID_IMAGE: 400,
  ASSET_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNSAFE_SVG: 422,

  // Domain — understood, and refused by the rules
  CONTENT_DOES_NOT_FIT: 422,
  ZONE_TOO_SMALL: 422,
  NODE_NOT_LEAF: 422,
  NODE_NOT_SPLIT: 422,
  ROOT_CANNOT_BE_DELETED: 422,
  CANNOT_DELETE_LAST_SLIDE: 422,
  TITLE_ALREADY_PRESENT: 422,
  TITLE_ABSENT: 422,
  TARGET_OCCUPIED: 409,
  TARGET_EMPTY: 409,
}

export function statusFor(code: ApiErrorCode): number {
  return HTTP_STATUS[code] ?? 500
}

/**
 * Headers every answer carries.
 *
 * `Access-Control-Allow-Origin: *` without credentials is the right pair for a
 * bearer-token API: there is no cookie and no session for another site to ride
 * on, so a page that has no token gains nothing from being allowed to ask. What
 * would be wrong is allowing credentials, and that is exactly what is absent.
 */
export function agentApiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    ...extra,
  }
}

export function jsonResponse(body: ApiResponseBody, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: agentApiHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extra }),
  })
}

export function errorResponse(
  error: ApiError,
  options: { operation?: string; extraHeaders?: Record<string, string> } = {},
): Response {
  return jsonResponse(
    { ok: false, ...(options.operation ? { operation: options.operation } : {}), error },
    statusFor(error.code),
    options.extraHeaders,
  )
}

/** An Agent Core error, unchanged, as an API error. Codes pass straight through. */
export function fromAgentError(error: AgentError): ApiError {
  return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
}

/** The revision an operation's result reports, when it reports one. */
export function revisionOf(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const revision = (data as { revision?: unknown }).revision
  return typeof revision === 'string' ? revision : undefined
}
