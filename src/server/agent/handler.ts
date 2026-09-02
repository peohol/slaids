/**
 * The REST layer, and nothing but the REST layer.
 *
 * §44 spells out what this file is allowed to do: authenticate the agent,
 * validate input, convert the transport DTO into Agent Core input, call Agent
 * Core, and convert the result into a stable API format. There is no rule about
 * layout, content or persistence here, and there must never be one — a rule
 * that lives here is a rule the editor does not have.
 *
 * What is genuinely this layer's own work is the part Agent Core cannot do for
 * itself, because in-process it runs with exactly the access its caller already
 * has:
 *
 *  - **who is calling.** A bearer token, looked up by hash, checked for
 *    revocation and expiry.
 *  - **what they may do.** Scopes, enforced here and never in the client, from
 *    the same `operation.scopes` the catalogue publishes. There is no second,
 *    hand-written table of operation names to fall out of date.
 *  - **what happened.** One audit row per call: who, when, which operation,
 *    which presentation, and the error code if any. Never the content.
 *
 * Routes, all under a version prefix from the first day:
 *
 *   GET  /api/agent/v1                      → what this is, and where to look
 *   GET  /api/agent/v1/operations           → the catalogue, with JSON Schema
 *   POST /api/agent/v1/operations/<name>    → run one operation
 *
 * Every operation is a POST, including the reads. An operation's arguments are
 * a structured object with a strict schema; splitting them between a query
 * string for some operations and a body for others would make the contract two
 * contracts, and the catalogue publishes one.
 */

import {
  describeOperations,
  findOperation,
  runOperation,
  unknownOperationError,
} from '../../agent/registry'
import { AGENT_API_BASE_PATH, AGENT_API_VERSION } from '../../routing'
import type { AgentContext } from '../../agent/types'
import { auditRecord, auditedPresentationId, type AgentAuditSink, type AuditSubject } from './audit'
import { parseOperationInput, readBody } from './body'
import {
  agentApiHeaders,
  errorResponse,
  fromAgentError,
  jsonResponse,
  revisionOf,
  statusFor,
  type ApiError,
} from './protocol'
import { looksLikeAgentToken } from '../../persistence/agentTokens'
import {
  REFUSAL_CODES,
  bearerToken,
  missingScopes,
  type AgentPrincipal,
  type AuthOutcome,
} from './tokens'


/**
 * Everything the handler needs from the outside, injected.
 *
 * The point is not only testability. It is that this file cannot reach a
 * database, a clock or an environment variable on its own — so "the REST layer
 * is thin" is a property of the code rather than a promise in a comment.
 */
export interface AgentApiDeps {
  /** Resolve a presented token. Never throws; a store that is down is a failure outcome. */
  authenticate(presentedToken: string): Promise<AuthOutcome>
  /** Agent Core's context for this principal, with the repository pinned to its owner. */
  contextFor(principal: AgentPrincipal): AgentContext
  audit: AgentAuditSink
  maxRequestBytes: number
  now(): Date
}

/**
 * One answer, whatever went wrong.
 *
 * Nothing below throws out of here: a bug in the handler answers `500` with the
 * same envelope as everything else, because an agent can only act on what it
 * can parse.
 */
export async function handleAgentRequest(deps: AgentApiDeps, request: Request): Promise<Response> {
  try {
    return await route(deps, request)
  } catch (error) {
    return errorResponse({
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Forespørselen feilet uventet.',
    })
  }
}

async function route(deps: AgentApiDeps, request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: agentApiHeaders() })
  }

  const path = routePath(url.pathname)
  if (path === null) {
    return errorResponse({ code: 'NOT_FOUND', message: 'Ukjent adresse.' })
  }

  // Authentication comes before routing anything further, so an unauthenticated
  // caller cannot use 404 versus 405 to map the surface.
  const auth = await authenticate(deps, request)
  if (!auth.ok) {
    await recordRefusal(deps, auth, path)
    return unauthenticated()
  }
  const principal = auth.principal

  // Every authenticated request from here on goes through `finish`, which is
  // what writes the audit row. One row per call means all of them, including
  // the catalogue: a stolen token's first move is to ask what it can do, and
  // that is the earliest thing an owner could notice.
  const subject = auditSubject(principal)
  const started = deps.now()

  if (path === '') return finish(deps, { subject, started, operation: 'index', input: null, ...meta(request) })
  if (path === '/operations') {
    return finish(deps, { subject, started, operation: 'catalogue', input: null, ...listing(request) })
  }

  const name = operationNameIn(path)
  if (name === null) {
    return finish(deps, {
      subject,
      started,
      operation: 'unknown_route',
      input: null,
      error: { code: 'NOT_FOUND', message: 'Ukjent adresse.' },
    })
  }
  if (request.method !== 'POST') {
    return finish(deps, {
      subject,
      started,
      operation: name,
      input: null,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Bruk POST på denne adressen.' },
      headers: { Allow: 'POST, OPTIONS' },
    })
  }

  return invoke(deps, request, url, principal, name, subject, started)
}

/**
 * The operation a path names, or `null` when it names none.
 *
 * One function so the router and the audit cannot disagree about what a request
 * was for — a refusal logged under a different name than the one that would
 * have run is a log that reads wrong exactly when it matters.
 */
function operationNameIn(path: string): string | null {
  const named = /^\/operations\/([^/]+)$/.exec(path)
  if (!named) return null
  try {
    return decodeURIComponent(named[1])
  } catch {
    // A malformed escape is not a name; the raw segment is what was asked for.
    return named[1]
  }
}

/** The path under the versioned base, or `null` when the request is not ours. */
function routePath(pathname: string): string | null {
  const normalised = pathname.replace(/\/+$/, '') || '/'
  if (normalised === AGENT_API_BASE_PATH) return ''
  if (!normalised.startsWith(`${AGENT_API_BASE_PATH}/`)) return null
  return normalised.slice(AGENT_API_BASE_PATH.length)
}

async function authenticate(deps: AgentApiDeps, request: Request): Promise<AuthOutcome> {
  const presented = bearerToken(request.headers.get('authorization'))
  if (!presented) return { ok: false, reason: 'missing' }
  // Shape first, so a string that cannot be one of ours never becomes a lookup.
  if (!looksLikeAgentToken(presented)) return { ok: false, reason: 'malformed' }
  return deps.authenticate(presented)
}

/**
 * One sentence for every reason.
 *
 * Missing, malformed, unknown, revoked and expired all answer the same thing.
 * Which one it was is in the server's own log and, where a token was actually
 * identified, in the audit — but never in the response: an endpoint that tells a
 * caller "that token exists, it is just revoked" is an endpoint that answers
 * questions on behalf of whoever stole it.
 */
function unauthenticated(): Response {
  return errorResponse(
    {
      code: 'UNAUTHENTICATED',
      message:
        'Mangler et gyldig agenttoken. Send det som «Authorization: Bearer slaids_at_…». Tokens lages og trekkes tilbake i Slaids-biblioteket.',
    },
    { extraHeaders: { 'WWW-Authenticate': 'Bearer realm="slaids-agent"' } },
  )
}

/**
 * A refused token that we nonetheless recognised.
 *
 * Only then: a token nobody has ever seen has no owner to attribute a row to,
 * and writing one would let an unauthenticated caller fill the table. A token
 * that *is* ours and was revoked or has expired is the opposite — "the key I
 * took away is still being used" is the single most useful thing an audit can
 * tell an owner, and the reason is recorded here even though the caller is
 * never told it.
 */
async function recordRefusal(
  deps: AgentApiDeps,
  auth: Extract<AuthOutcome, { ok: false }>,
  path: string,
): Promise<void> {
  if (!auth.identified) return
  const at = deps.now()
  try {
    await deps.audit.record(
      auditRecord({
        at,
        subject: auth.identified,
        operation: operationNameIn(path) ?? 'authenticate',
        presentationId: null,
        status: statusFor('UNAUTHENTICATED'),
        errorCode: REFUSAL_CODES[auth.reason],
        durationMs: 0,
      }),
    )
  } catch (error) {
    console.error('slaids-agent: kunne ikke skrive auditrad for avvist token', error)
  }
}

/** What this API is, for a caller that guessed the base address. */
function meta(request: Request): Answer {
  const wrong = requireRead(request)
  if (wrong) return wrong
  return {
    data: {
      api: 'slaids-agent',
      version: AGENT_API_VERSION,
      operations: `${AGENT_API_BASE_PATH}/operations`,
    },
  }
}

/**
 * The catalogue, generated from the operations themselves.
 *
 * Names, summaries, JSON Schema and required scopes all come out of
 * `describeOperations()`. That is the point: a second, hand-written copy of the
 * contract in the transport is a copy that goes stale, and the way it goes
 * stale is that an operation added later is missing from it.
 */
function listing(request: Request): Answer {
  const wrong = requireRead(request)
  if (wrong) return wrong
  return { data: { version: AGENT_API_VERSION, operations: describeOperations() } }
}

/** What a route that only reads answers to a verb that writes. */
function requireRead(request: Request): Answer | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null
  return {
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Bruk GET på denne adressen.' },
    headers: { Allow: 'GET, OPTIONS' },
  }
}

async function invoke(
  deps: AgentApiDeps,
  request: Request,
  url: URL,
  principal: AgentPrincipal,
  name: string,
  subject: AuditSubject,
  started: Date,
): Promise<Response> {
  const operation = findOperation(name)
  if (!operation) {
    // Agent Core's own answer, from the same catalogue, so an unknown name says
    // the same thing over REST as it does in process — including the list of
    // names that do exist.
    return finish(deps, {
      subject,
      started,
      operation: name,
      input: null,
      error: fromAgentError(unknownOperationError(name)),
    })
  }

  // Scopes, before the body is read: an unauthorised caller must not be able to
  // make the server buffer megabytes for it.
  const lacking = missingScopes(principal, operation.scopes)
  if (lacking.length > 0) {
    return finish(deps, {
      subject,
      started,
      operation: name,
      input: null,
      error: {
        code: 'FORBIDDEN_SCOPE',
        message: `Tokenet mangler ${lacking.join(', ')} for «${name}».`,
        details: { operation: name, required: [...operation.scopes], missing: lacking },
      },
    })
  }

  const body = await readBody(request, { maxRequestBytes: deps.maxRequestBytes })
  if (!body.ok) {
    return finish(deps, { subject, started, operation: name, input: null, error: body.error })
  }

  const parsed = await parseOperationInput(request.headers.get('content-type'), body.bytes, url)
  if (!parsed.ok) {
    return finish(deps, { subject, started, operation: name, input: null, error: parsed.error })
  }

  const result = await runOperation(deps.contextFor(principal), name, parsed.input)
  if (!result.ok) {
    return finish(deps, {
      subject,
      started,
      operation: name,
      input: parsed.input,
      error: fromAgentError(result.error),
    })
  }

  const revision = revisionOf(result.value)
  return finish(deps, {
    subject,
    started,
    operation: name,
    input: parsed.input,
    data: result.value,
    revision,
  })
}

/** What a route produced: one of the two, never both. */
interface Answer {
  data?: unknown
  error?: ApiError
  /** Anything the status alone cannot say, such as `Allow`. */
  headers?: Record<string, string>
}

function auditSubject(principal: AgentPrincipal): AuditSubject {
  return {
    ownerId: principal.ownerId,
    tokenId: principal.tokenId,
    tokenName: principal.tokenName,
  }
}

/** Record the call and answer it. The audit is written for both outcomes. */
async function finish(
  deps: AgentApiDeps,
  outcome: Answer & {
    subject: AuditSubject
    started: Date
    operation: string
    input: unknown
    revision?: string
  },
): Promise<Response> {
  const status = outcome.error ? statusFor(outcome.error.code) : 200
  const finished = deps.now()

  try {
    await deps.audit.record(
      auditRecord({
        at: outcome.started,
        subject: outcome.subject,
        operation: outcome.operation,
        presentationId: auditedPresentationId(outcome.input, outcome.data),
        status,
        errorCode: outcome.error ? outcome.error.code : null,
        durationMs: finished.getTime() - outcome.started.getTime(),
      }),
    )
  } catch (error) {
    // An audit that cannot be written must not turn a successful mutation into
    // a failure the agent will retry — the write already happened, and retrying
    // it is the more damaging of the two. It is loud in the server log instead.
    console.error('slaids-agent: kunne ikke skrive auditrad', error)
  }

  if (outcome.error) {
    return errorResponse(outcome.error, {
      operation: outcome.operation,
      ...(outcome.headers ? { extraHeaders: outcome.headers } : {}),
    })
  }
  return jsonResponse(
    {
      ok: true,
      operation: outcome.operation,
      ...(outcome.revision ? { revision: outcome.revision } : {}),
      data: outcome.data,
    },
    200,
    outcome.headers ?? {},
  )
}
