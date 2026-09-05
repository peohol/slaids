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
 *  - **who is calling.** A bearer credential, of one of two families: an agent
 *    token looked up by hash, or a Supabase OAuth access token verified against
 *    the project's key set. Both end as one `AgentPrincipal`, and nothing below
 *    this line can tell which it was — see `tokens.ts`.
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
 *   POST /api/agent/v1/mcp                  → the same operations, as MCP tools
 *
 * …plus two addresses that are not under it, and cannot be:
 *
 *   GET  /.well-known/oauth-protected-resource/api/agent/v1/mcp
 *   GET  /.well-known/oauth-protected-resource
 *
 * Those are RFC 9728's, built from the *host* root by inserting the well-known
 * segment ahead of the resource's own path, so their shape is the
 * specification's rather than ours. Both answer with the same document, because
 * a client is required to try the first and fall back to the second.
 *
 * All six are one static function on the platform (`api/agent/v1.ts`) plus
 * explicit rewrites; `deployment.test.ts` checks that the deployment really
 * sends every one of them here.
 *
 * The MCP endpoint is routed here rather than deployed beside this one because
 * everything around it is the same: the same bearer token, read by the same
 * `authenticateRequest`; the same scopes; the same audit. What both of them call
 * is `invoke.ts`, which is what makes "the same operation answers the same thing
 * over either transport" a property of the code rather than of two adapters
 * written carefully.
 *
 * It is one of the two routes this file does not authenticate for. The other is
 * the metadata document, which is public by specification: it is what a client
 * reads *because* it has no credential yet, so a 401 there would be a discovery
 * loop with no exit.
 *
 * For MCP the reason is different — on that address the answer differs per
 * JSON-RPC message rather than per route: **MCP discovery is public; Slaids' operations are authenticated and
 * scope-gated.** A client has to be able to handshake and read the tool
 * catalogue before an owner has given it a token — that is the order ChatGPT's
 * custom MCP apps and every other "scan, then connect an account" client work
 * in — while every message that can reach a deck still needs exactly what a REST
 * call needs. So the endpoint asks for itself, with this file's own helpers, and
 * `src/server/mcp/endpoint.ts` is where that boundary is written down. Nothing
 * about REST moved: every route below still answers `401` before it routes.
 *
 * Every operation is a POST, including the reads. An operation's arguments are
 * a structured object with a strict schema; splitting them between a query
 * string for some operations and a body for others would make the contract two
 * contracts, and the catalogue publishes one.
 *
 * The answer is JSON for every operation but one. `render_slide_preview`
 * produces a picture, and a picture is answered as itself: the PNG as the body,
 * with `Content-Type` saying so, rather than a few hundred kilobytes of base64
 * inside an envelope the caller then has to unwrap. Nothing about the contract
 * changes — `Accept: application/json` still gets the ordinary envelope, with
 * the image base64-encoded in the field the operation put it in — and where the
 * picture comes from is `invoke.ts`, the same function MCP calls, so neither
 * transport has its own idea of what a preview is.
 */

import { attachEncodedImage, type AgentImage } from '../../agent/image'
import { describeOperations } from '../../agent/registry'
import {
  AGENT_API_BASE_PATH,
  AGENT_API_VERSION,
  AGENT_MCP_PATH,
  MCP_PROTECTED_RESOURCE_METADATA_PATH,
  PROTECTED_RESOURCE_METADATA_PATH,
  agentApiUrl,
  canonicalMcpUrl,
} from '../../routing'
import type { AgentContext } from '../../agent/types'
import {
  auditedPresentationId,
  recordAgentCall,
  recordRefusedToken,
  type AgentAuditSink,
  type AuditSubject,
} from './audit'
import { parseOperationInput, readBody } from './body'
import { authorizeOperation, performOperation } from './invoke'
import { handleMcpRequest } from '../mcp/endpoint'
import type { OAuthResourceConfig } from './oauth'
import {
  challengeFor,
  protectedResourceMetadata,
  resourceOrigin,
} from './resourceMetadata'
import {
  agentApiHeaders,
  errorResponse,
  imageResponse,
  jsonResponse,
  prefersJsonResult,
  statusFor,
  unauthenticatedResponse,
  type ApiError,
} from './protocol'
import {
  auditSubject,
  authenticateRequest,
  type AgentPrincipal,
  type AgentTokenLookup,
} from './tokens'


/**
 * Everything the handler needs from the outside, injected.
 *
 * The point is not only testability. It is that this file cannot reach a
 * database, a clock or an environment variable on its own — so "the REST layer
 * is thin" is a property of the code rather than a promise in a comment.
 */
export interface AgentApiDeps extends AgentTokenLookup {
  /** Agent Core's context for this principal, with the repository pinned to its owner. */
  contextFor(principal: AgentPrincipal): AgentContext
  audit: AgentAuditSink
  maxRequestBytes: number
  now(): Date
  /**
   * The OAuth resource-server half, when this deployment offers one.
   *
   * Absent means agent tokens and nothing else: no metadata document, and a
   * `WWW-Authenticate` with nowhere to point. See `oauth.ts`.
   */
  oauth?: OAuthResourceConfig
  /** The origin OAuth metadata speaks about, when the deployment pins one. */
  publicOrigin?: string | null
}

/**
 * What a caller is told when the handler itself failed.
 *
 * Deliberately one fixed sentence with nothing in it. The thrown error's own
 * message is written by whatever threw — a Postgres driver, the Supabase
 * client, a URL parser — and those say things like which relation was queried,
 * which constraint failed or which host did not resolve. None of that is the
 * caller's business, and an API that repeats it is an API that maps the
 * database for whoever is probing it.
 */
export const INTERNAL_ERROR_MESSAGE =
  'Forespørselen feilet uventet. Feilen er logget serverside; prøv igjen, eller se serverloggen.'

/**
 * One answer, whatever went wrong.
 *
 * Nothing below throws out of here: a bug in the handler answers `500` with the
 * same envelope as everything else, because an agent can only act on what it
 * can parse. What it does *not* do is hand the exception's own text back — that
 * goes to the server log, where only the owner can read it.
 *
 * The errors an agent is supposed to act on never come through here: Agent Core
 * catches its own, and a repository failure is already a typed `STORAGE_FAILED`
 * with a message written for a reader. This path is for the unforeseen, and the
 * unforeseen is exactly what has not been checked for what it says.
 */
export async function handleAgentRequest(deps: AgentApiDeps, request: Request): Promise<Response> {
  try {
    return await route(deps, request)
  } catch (error) {
    console.error('slaids-agent: uventet feil i forespørselen', error)
    return errorResponse({ code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE })
  }
}

async function route(deps: AgentApiDeps, request: Request): Promise<Response> {
  // The address the caller asked for, which is not always the one the host
  // delivered: a static function plus a rewrite is the only shape whose routing
  // Vercel gets right for every operation address, and a rewrite hands the path
  // over in a parameter. `agentApiUrl` puts it back and takes the parameter out
  // again, so everything below — routing and the query-string fields a raw
  // upload carries — sees the request as it was made.
  const url = agentApiUrl(new URL(request.url))

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: agentApiHeaders() })
  }

  // The OAuth metadata document, which is public by specification: it is the
  // thing a client reads *because* it has no credential yet, so authenticating
  // it would be a discovery loop with no exit. It says nothing an owner owns —
  // an address and the name of an authorization server — and it is the same
  // bytes for every caller. See `resourceMetadata.ts`.
  //
  // Both of RFC 9728's addresses are answered, and they are recognised twice
  // over: as they were asked for, and as the platform's rewrite hands them
  // back. The first is what a host that routes by path delivers and what the
  // tests exercise; the second is Vercel, where a static function can only be
  // reached through the rewrite. Neither is a fallback for the other — they are
  // the same address seen from two sides of an edge.
  if (isResourceMetadataAddress(url.pathname)) return resourceMetadataResponse(deps, request)

  const path = routePath(url.pathname)
  if (path === null) {
    return errorResponse({ code: 'NOT_FOUND', message: 'Ukjent adresse.' })
  }

  // The one address with a public half, and it is handed over before anything is
  // authenticated *here* because on that address the answer differs per JSON-RPC
  // message rather than per route: MCP discovery is public, and every message
  // that can reach a deck needs the same token this function demands of
  // everything else. The endpoint reads the same header with the same
  // `authenticateRequest`, refuses a presented-and-bad token for every method,
  // and writes the same audit rows. See `src/server/mcp/endpoint.ts`.
  //
  // It is also the one address a caller learns nothing from: it is published, so
  // there is no 404-versus-405 to map with.
  if (path === MCP_SUBPATH) return handleMcpRequest(deps, request)

  // Authentication comes before routing anything further, so an unauthenticated
  // caller cannot use 404 versus 405 to map the surface.
  const auth = await authenticateRequest(deps, request)
  if (!auth.ok) {
    await recordRefusedToken(deps.audit, {
      at: deps.now(),
      auth,
      operation: operationNameIn(path) ?? 'authenticate',
    })
    return unauthenticatedResponse(challengeFor(deps, request, auth.reason))
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

/**
 * The MCP address, as this router sees it: everything after the version prefix.
 *
 * Derived from the full address in `src/routing.ts` rather than written out
 * again, so the rewrite, the router and the screen that tells an owner where to
 * point a client all read one string.
 */
const MCP_SUBPATH = AGENT_MCP_PATH.slice(AGENT_API_BASE_PATH.length)

/**
 * The metadata document, or a 404 when this deployment has no OAuth.
 *
 * A 404 rather than an empty document on purpose: RFC 9728 discovery is a
 * client asking "is there an authorization server for this resource?", and the
 * honest answer from a deployment that accepts only agent tokens is "no such
 * document", not one that names nobody.
 */
function resourceMetadataResponse(deps: AgentApiDeps, request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(
      { code: 'METHOD_NOT_ALLOWED', message: 'Bruk GET på denne adressen.' },
      { extraHeaders: { Allow: 'GET, OPTIONS' } },
    )
  }
  if (!deps.oauth) {
    return errorResponse({
      code: 'NOT_FOUND',
      message:
        'Denne installasjonen tilbyr ingen OAuth-autorisasjonsserver. Bruk et agenttoken («Authorization: Bearer slaids_at_…»).',
    })
  }
  const document = protectedResourceMetadata({
    canonicalResource: canonicalMcpUrl(resourceOrigin(request, deps.publicOrigin)),
    config: deps.oauth,
  })
  return new Response(JSON.stringify(document), {
    status: 200,
    headers: agentApiHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      // Public, identical for every caller, and fetched at the start of every
      // client's first connection. A short cache is politeness towards the
      // clients rather than a saving here.
      'Cache-Control': 'public, max-age=300',
    }),
  })
}

/**
 * Whether this address is one the metadata document answers on.
 *
 * The two RFC 9728 addresses, plus the one the Vercel rewrite reconstructs —
 * `agentApiUrl` puts the forwarded path back under the version prefix, so the
 * platform's version of `/.well-known/oauth-protected-resource` arrives with the
 * prefix in front of it.
 */
function isResourceMetadataAddress(pathname: string): boolean {
  const normalised = pathname.replace(/\/+$/, '') || '/'
  return (
    normalised === PROTECTED_RESOURCE_METADATA_PATH ||
    normalised === MCP_PROTECTED_RESOURCE_METADATA_PATH ||
    normalised === `${AGENT_API_BASE_PATH}${PROTECTED_RESOURCE_METADATA_PATH}`
  )
}

/** The path under the versioned base, or `null` when the request is not ours. */
function routePath(pathname: string): string | null {
  const normalised = pathname.replace(/\/+$/, '') || '/'
  if (normalised === AGENT_API_BASE_PATH) return ''
  if (!normalised.startsWith(`${AGENT_API_BASE_PATH}/`)) return null
  return normalised.slice(AGENT_API_BASE_PATH.length)
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
      mcp: AGENT_MCP_PATH,
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
  // Does it exist, and may this token run it. Both answers come from `invoke.ts`
  // — the same call the MCP endpoint makes — so an unknown name says the same
  // thing over either transport, list of real names and all.
  //
  // It happens *before* the body is read on purpose: an unauthorised caller must
  // not be able to make the server buffer megabytes for it.
  const authorized = authorizeOperation(principal, name)
  if (!authorized.ok) {
    return finish(deps, { subject, started, operation: name, input: null, error: authorized.error })
  }

  const body = await readBody(request, { maxRequestBytes: deps.maxRequestBytes })
  if (!body.ok) {
    return finish(deps, { subject, started, operation: name, input: null, error: body.error })
  }

  // The one genuinely REST-shaped step, and the reason this layer exists: a
  // multipart or raw binary body becomes the bytes Agent Core works with. An
  // MCP client has no such body and sends base64, which Agent Core accepts on
  // its own.
  const parsed = await parseOperationInput(request.headers.get('content-type'), body.bytes, url)
  if (!parsed.ok) {
    return finish(deps, { subject, started, operation: name, input: null, error: parsed.error })
  }

  const outcome = await performOperation(deps.contextFor(principal), name, parsed.input)
  return finish(deps, {
    subject,
    started,
    operation: name,
    input: parsed.input,
    accept: request.headers.get('accept'),
    ...outcome,
  })
}

/** What a route produced: one of the two, never both. */
interface Answer {
  data?: unknown
  error?: ApiError
  /** Anything the status alone cannot say, such as `Allow`. */
  headers?: Record<string, string>
  /** The picture, when the operation produced one. See `invoke.ts`. */
  image?: AgentImage
  imageField?: string
  /** What the caller said it could read. Only a picture gives it a choice. */
  accept?: string | null
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

  await recordAgentCall(deps.audit, {
    at: outcome.started,
    subject: outcome.subject,
    operation: outcome.operation,
    presentationId: auditedPresentationId(outcome.input, outcome.data),
    status,
    errorCode: outcome.error ? outcome.error.code : null,
    durationMs: finished.getTime() - outcome.started.getTime(),
  })

  if (outcome.error) {
    return errorResponse(outcome.error, {
      operation: outcome.operation,
      ...(outcome.headers ? { extraHeaders: outcome.headers } : {}),
    })
  }

  // A picture, as itself, unless the caller asked for the envelope. The
  // structured half is not lost either way: the binary answer carries the
  // operation and the revision in headers, and the whole of it is one
  // `Accept: application/json` away.
  const image = outcome.image
  if (image && !prefersJsonResult(outcome.accept ?? null)) {
    return imageResponse(image.bytes, image.mimeType, {
      operation: outcome.operation,
      ...(outcome.revision ? { revision: outcome.revision } : {}),
      ...(outcome.headers ? { extraHeaders: outcome.headers } : {}),
    })
  }

  return jsonResponse(
    {
      ok: true,
      operation: outcome.operation,
      ...(outcome.revision ? { revision: outcome.revision } : {}),
      data:
        image && outcome.imageField
          ? attachEncodedImage(outcome.data, outcome.imageField, image)
          : outcome.data,
    },
    200,
    outcome.headers ?? {},
  )
}
