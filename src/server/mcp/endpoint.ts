/**
 * MCP over HTTP, on the address the token already works at.
 *
 * The transport is **Streamable HTTP** (the 2025-06-18 revision's own), and it
 * is the stateless half of it: one POST carries one JSON-RPC message, and the
 * answer comes back as `application/json` on the same response. What that
 * leaves out is deliberate, not unfinished:
 *
 *  - **no SSE stream.** A server opens one to push notifications, progress and
 *    server-initiated requests. Slaids sends none of those — every operation is
 *    one call with one answer — so a stream would be a connection held open with
 *    nothing to say. `GET` therefore answers `405`, which is exactly what the
 *    spec prescribes for a server that does not offer one.
 *  - **no session.** No `Mcp-Session-Id` is issued, so there is none to resume
 *    and none to terminate (`DELETE` is `405` for the same reason). The bearer
 *    token is the identity on every message, and the only state between two
 *    calls — which reading a write is made against — is already in the
 *    presentation's `revision`. This is what makes the endpoint correct on a
 *    platform that may answer two messages from two cold instances.
 *  - **no batching.** Removed from the protocol in this revision; see
 *    `jsonrpc.ts`.
 *
 * Two checks happen before a single byte of the body is read, and both of them
 * are the specification's:
 *
 *  - **`Origin`, against DNS rebinding.** Streamable HTTP requires a server to
 *    validate it, and Slaids validates it by refusing every request that carries
 *    one. A non-browser client — which is every MCP client that exists — sends
 *    none and is unaffected. See `refusesEveryOrigin` below for why the
 *    seemingly obvious check is worthless and why the honest allowlist here is
 *    the empty one. That it runs before the body is read is the point: a page
 *    must not be able to reach an operation at all, never mind one that writes.
 *  - **`MCP-Protocol-Version`.** Absent is allowed, and is read as the one
 *    revision this server implements — never as the `2025-03-26` the
 *    specification names for backwards compatibility, because this server does
 *    not implement `2025-03-26` and pretending otherwise is the same lie as
 *    announcing it. Present and not that revision is a `400`: the client was
 *    told at `initialize` which one applies.
 *
 * Everything before the message is read is the REST layer's, unchanged: the
 * same bearer token, read and checked by the same `authenticateRequest`; the
 * same body limit; the same headers; the same audit sink. Transport-level
 * refusals — a wrong verb, a wrong content type, a body too large — answer with
 * Slaids' own error envelope rather than a JSON-RPC one, because at that point
 * there is no JSON-RPC message to answer *about*, and an agent that pointed a
 * plain HTTP client at this address should meet the same error vocabulary it
 * meets everywhere else in the API.
 *
 * ## Why the token is checked here rather than by the router
 *
 * **MCP discovery is public; Slaids' operations are authenticated and
 * scope-gated.** This is the one address in the API where the two halves of that
 * sentence meet, so it is the one address that authenticates for itself. Every
 * REST route still answers `401` before it routes anything, and `tools/call`
 * still needs exactly the token and the scopes a REST call needs — what changed
 * is that a client may now handshake and read the tool catalogue before an owner
 * has given it a token.
 *
 * That is not a courtesy. It is how a client is *built*: ChatGPT's custom MCP
 * apps scan the server for its tools when the app is created and store that
 * catalogue with the app, before — and independently of — any end user linking
 * their account. A server that answered `401` to `initialize` published an app
 * with an empty tool list, which is exactly the shape of the bug this endpoint
 * had: the integration connected, and offered nothing. The same order shows up
 * in every "scan the server, then connect an account" client, and in the
 * inspector tools people debug with.
 *
 * Two rules keep that from being a hole, and both are worth stating as rules
 * rather than as code:
 *
 *  1. **Only messages that cannot reach a deck are public**, and which those are
 *     is `requiresAgentToken` in `server.ts`, derived from the same map the
 *     dispatch switch is exhaustive over. A public answer is built from the
 *     operation registry, which is compiled into the bundle: the same bytes for
 *     every caller, and none of them the owner's.
 *  2. **A token that was presented is always verified**, whichever method
 *     carries it. Discovery being open is about a client that has no token yet,
 *     never about one whose token was revoked or has expired — so a bad token
 *     is a `401` on `initialize` too, and it is audited exactly as REST audits
 *     it. An anonymous message writes no audit row at all, for the same reason
 *     REST writes none for a token nobody has ever seen: the audit is the
 *     owner's, keyed on the token that acted, and there is neither here.
 */

import type { AgentContext } from '../../agent/types'
import { readBody } from '../agent/body'
import type { OAuthResourceConfig } from '../agent/oauth'
import { challengeFor } from '../agent/resourceMetadata'
import {
  auditedPresentationId,
  recordAgentCall,
  recordRefusedToken,
  type AgentAuditSink,
  type AuditSubject,
} from '../agent/audit'
import {
  agentApiHeaders,
  errorResponse,
  statusFor,
  unauthenticatedError,
  unauthenticatedResponse,
  type ApiError,
} from '../agent/protocol'
import {
  auditSubject,
  authenticateRequest,
  type AgentPrincipal,
  type AgentTokenLookup,
} from '../agent/tokens'
import {
  JSON_RPC_AUDIT,
  JSON_RPC_ERROR,
  jsonRpcError,
  jsonRpcResult,
  readJsonRpcMessage,
  type IncomingMessage,
  type JsonRpcResponse,
} from './jsonrpc'
import { challengedToolResult } from './result'
import { dispatchMcpMessage, requiresAgentToken, type McpAudited, type McpSession } from './server'
import {
  MCP_PROTOCOL_VERSION,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  isSupportedProtocolVersion,
} from './tools'

/**
 * What the endpoint needs, described structurally rather than imported.
 *
 * `AgentApiDeps` satisfies this by shape, which keeps the dependency pointing
 * one way: the REST router knows about the MCP endpoint, and the MCP endpoint
 * knows nothing about the router.
 */
export interface McpEndpointDeps extends AgentTokenLookup {
  contextFor(principal: AgentPrincipal): AgentContext
  audit: AgentAuditSink
  maxRequestBytes: number
  now(): Date
  /** The OAuth resource-server half, when this deployment offers one. */
  oauth?: OAuthResourceConfig
  /** The origin OAuth metadata speaks about, when the deployment pins one. */
  publicOrigin?: string | null
}

const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json$/i

/** The header a client states its negotiated protocol revision in. */
const PROTOCOL_VERSION_HEADER = 'mcp-protocol-version'

function mediaType(header: string | null): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

function jsonRpcResponse(
  body: JsonRpcResponse,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: agentApiHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extra }),
  })
}

/** A notification or a response: received, nothing to say back. */
function accepted(): Response {
  return new Response(null, { status: 202, headers: agentApiHeaders() })
}


/**
 * The name a refusal that never became a message is filed under.
 *
 * Before the body is read there is no method to name, so `mcp` is the honest
 * answer — the same one every transport-level refusal here already used.
 */
const MCP_TRANSPORT_OPERATION = 'mcp'

export async function handleMcpRequest(
  deps: McpEndpointDeps,
  request: Request,
): Promise<Response> {
  const started = deps.now()

  // Who is calling, if anyone. A token that was *presented* is verified for
  // every method — see rule 2 at the top of this file — so anything but "none
  // was sent" ends here, with the same sentence and the same audit row REST
  // would have written.
  const auth = await authenticateRequest(deps, request)
  if (!auth.ok && auth.reason !== 'missing') {
    await recordRefusedToken(deps.audit, {
      at: started,
      auth,
      operation: MCP_TRANSPORT_OPERATION,
    })
    // A credential *was* presented and is not usable. That is the case MCP's
    // error table names first — "authorization required or token invalid" — and
    // it is answered before the body is read, so a rejected caller cannot make
    // this endpoint buffer megabytes for it. The challenge carries
    // `error="invalid_token"`, which is the word that tells a client with an
    // expired token to refresh rather than to give up.
    return unauthenticatedResponse(challengeFor(deps, request, auth.reason))
  }

  const principal = auth.ok ? auth.principal : null
  const subject: AuditSubject | null = principal ? auditSubject(principal) : null

  const record = async (audit: McpAudited): Promise<void> => {
    // No subject, no row. An anonymous message has no owner to attribute and no
    // token to name, and a row invented for one would both be a lie and let an
    // unauthenticated caller fill the table — which is the rule REST already
    // follows for a token nobody has ever seen.
    if (!subject) return
    await recordAgentCall(deps.audit, {
      at: started,
      subject,
      operation: audit.operation,
      presentationId: auditedPresentationId(audit.input, audit.data),
      status: audit.status,
      errorCode: audit.errorCode,
      durationMs: deps.now().getTime() - started.getTime(),
    })
  }

  const refuse = async (error: ApiError, headers?: Record<string, string>): Promise<Response> => {
    await record({
      operation: MCP_TRANSPORT_OPERATION,
      input: null,
      data: null,
      errorCode: error.code,
      status: statusFor(error.code),
    })
    return errorResponse(error, {
      operation: MCP_TRANSPORT_OPERATION,
      ...(headers ? { extraHeaders: headers } : {}),
    })
  }

  if (request.method !== 'POST') {
    return refuse(
      {
        code: 'METHOD_NOT_ALLOWED',
        message:
          'MCP-endepunktet tar imot én JSON-RPC-melding per POST. Slaids tilbyr ingen SSE-strøm og ingen sesjon å avslutte.',
      },
      { Allow: 'POST, OPTIONS' },
    )
  }

  // Streamable HTTP requires the server to validate `Origin` against DNS
  // rebinding. Slaids validates it by refusing every request that carries one.
  //
  // The obvious check — compare the `Origin` against the request's own host — is
  // worthless here, and worse than worthless because it looks like protection.
  // In the attack it is meant to stop, *both* sides are the attacker's: the page
  // is served from `evil.example`, DNS for `evil.example` is repointed at this
  // server, and the browser then sends `Host: evil.example` together with
  // `Origin: https://evil.example`. They match, and the request goes through. A
  // check that compares a request against itself proves nothing about it; the
  // trusted set has to come from somewhere the attacker does not control.
  //
  // The usual somewhere is a configured allowlist. Slaids does not need one,
  // because it has no browser origin to allow: an MCP client is a program, not a
  // page. The official SDK over Node, Claude Desktop, an editor, a script — none
  // of them sends `Origin`, and nothing in Slaids' own browser app talks to this
  // endpoint at all (the token screen only prints the address). So the honest
  // allowlist is the empty one, and refusing every `Origin` is that allowlist
  // enforced. It is also the one shape with no configuration a deployment can
  // forget to set and thereby reopen the hole.
  //
  // If a browser-based MCP client ever becomes a requirement, this is the line
  // to change — and the trusted origins must then be read from the server
  // environment, never from the request.
  //
  // CORS preflight stays permissive, because `agentApiHeaders` is shared with
  // REST where cross-origin access is deliberate: a bearer-token API has no
  // cookie to ride on. A browser page therefore gets a successful preflight and
  // then this `403`, which is the right order — the refusal is a decision this
  // endpoint makes, not a header a browser is trusted to enforce.
  const origin = request.headers.get('origin')
  if (origin !== null) {
    return refuse({
      code: 'FORBIDDEN_ORIGIN',
      message:
        'MCP-endepunktet tar ikke imot forespørsler fra nettlesersider. En MCP-klient er et program – den offisielle SDK-en, en editor, et skript – og sender ingen Origin.',
      details: { origin },
    })
  }

  // The revision the client says it agreed to. Absent means the one revision
  // this server implements — the specification's own fallback is `2025-03-26`,
  // and naming that here would be claiming a revision this server does not have.
  // Present and different is refused: the client was told at `initialize` which
  // revision applies, so a header saying otherwise means it either ignored the
  // answer or never asked. The reference implementation refuses it the same way.
  const declaredVersion = request.headers.get(PROTOCOL_VERSION_HEADER) ?? MCP_PROTOCOL_VERSION
  if (!isSupportedProtocolVersion(declaredVersion)) {
    return refuse({
      code: 'UNSUPPORTED_PROTOCOL_VERSION',
      message: `Slaids snakker ikke MCP-versjonen «${declaredVersion}». Versjonen avtales i initialize; denne serveren svarer bare på ${SUPPORTED_MCP_PROTOCOL_VERSIONS.join(', ')}.`,
      details: { requested: declaredVersion, supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS] },
    })
  }

  const type = mediaType(request.headers.get('content-type'))
  if (!JSON_TYPE.test(type)) {
    return refuse({
      code: 'UNSUPPORTED_CONTENT_TYPE',
      message: 'MCP-meldinger sendes som application/json.',
      details: { contentType: type },
    })
  }

  const body = await readBody(request, { maxRequestBytes: deps.maxRequestBytes })
  if (!body.ok) return refuse(body.error)

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body.bytes))
  } catch {
    // A body that is not JSON never became a message, so there is no id to echo
    // and nothing the server could have run. JSON-RPC's own answer to that is a
    // parse error against a null id, and the HTTP status says the request was
    // wrong on its face.
    const refusal = JSON_RPC_AUDIT[JSON_RPC_ERROR.PARSE_ERROR]
    await record({
      operation: 'mcp:parse',
      input: null,
      data: null,
      errorCode: refusal.code,
      status: refusal.status,
    })
    return jsonRpcResponse(
      jsonRpcError(null, JSON_RPC_ERROR.PARSE_ERROR, 'Forespørselen er ikke gyldig JSON.'),
      refusal.status,
    )
  }

  const message = readJsonRpcMessage(parsed)

  // The authentication boundary itself, and the whole reason this endpoint has
  // one of its own. `requiresAgentToken` reads the message rather than the
  // address, because on this address the answer differs per message.
  //
  // The refusal is the transport's `401`, not a JSON-RPC error inside a `200`:
  // MCP puts authorization at the HTTP layer, its error table names 401 for
  // "authorization required or token invalid", and a client is required to be
  // able to read one — which is how a client whose token expired mid-session
  // learns to go and get another. A JSON-RPC error would hide that in a body.
  //
  // Nothing is audited: there is no subject to attribute it to. What an owner
  // *can* see is the case that matters — a token they revoked, presented again —
  // and that was recorded above, before the body was even read.
  if (!principal && requiresAgentToken(message)) {
    return anonymousRefusal(deps, request, message)
  }

  const session: McpSession = principal
    ? { authenticated: true, principal, context: () => deps.contextFor(principal) }
    : { authenticated: false }

  const outcome = await dispatchMcpMessage(session, message)
  await record(outcome.audit)

  if (!outcome.response) return accepted()
  // A well-formed message that the server understood is answered `200`, error
  // envelope or not: the JSON-RPC error *is* the answer. Only a message that was
  // never one at all — unparseable, or not a JSON-RPC object — is an HTTP error.
  return jsonRpcResponse(outcome.response, message.kind === 'invalid' ? 400 : 200)
}

/**
 * A `tools/call` from a client that has no credential yet.
 *
 * This is the message mixed authentication exists for: discovery is public, so
 * a client reaches this point having already handshaked, listed the tools and
 * read from each one's `securitySchemes` that it needs OAuth. What it needs
 * back is not "no", it is "here is where to go".
 *
 * So the answer is both things at once, and neither is a concession to a
 * particular client:
 *
 *  - **HTTP 401 with `WWW-Authenticate`**, which is what the specification
 *    requires of a resource server and what an SDK client turns into an
 *    authorization flow. The status is unchanged from before OAuth existed; the
 *    header gained `resource_metadata`, the pointer RFC 9728 §5.1 defines.
 *  - **a JSON-RPC body carrying the same challenge** in the result's
 *    `_meta['mcp/www_authenticate']`. A client that reads the body finds a
 *    Slaids error object it can print and a challenge it can act on, instead of
 *    a status code and nothing else.
 *
 * The two do not contradict each other. HTTP says the request was not
 * authorised; the tool result says the call errored and why — which is exactly
 * what happened, and what `isError` means everywhere else in this adapter.
 *
 * Nothing is audited. There is no subject to attribute it to, which is the same
 * rule REST follows for a credential nobody has ever seen.
 */
function anonymousRefusal(
  deps: McpEndpointDeps,
  request: Request,
  message: IncomingMessage,
): Response {
  const challenge = challengeFor(deps, request, 'missing')
  if (message.kind !== 'request') return unauthenticatedResponse(challenge)
  return jsonRpcResponse(
    jsonRpcResult(message.id, challengedToolResult(unauthenticatedError(), challenge)),
    401,
    { 'WWW-Authenticate': challenge },
  )
}
