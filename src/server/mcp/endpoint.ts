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
 * same bearer token, checked by the same `authenticate`; the same body limit;
 * the same headers; the same audit sink, one row per message. Transport-level
 * refusals — a wrong verb, a wrong content type, a body too large — answer with
 * Slaids' own error envelope rather than a JSON-RPC one, because at that point
 * there is no JSON-RPC message to answer *about*, and an agent that pointed a
 * plain HTTP client at this address should meet the same error vocabulary it
 * meets everywhere else in the API.
 */

import type { AgentContext } from '../../agent/types'
import { readBody } from '../agent/body'
import {
  auditedPresentationId,
  recordAgentCall,
  type AgentAuditSink,
  type AuditSubject,
} from '../agent/audit'
import { agentApiHeaders, errorResponse, statusFor, type ApiError } from '../agent/protocol'
import type { AgentPrincipal } from '../agent/tokens'
import {
  JSON_RPC_AUDIT,
  JSON_RPC_ERROR,
  jsonRpcError,
  readJsonRpcMessage,
  type JsonRpcResponse,
} from './jsonrpc'
import { dispatchMcpMessage, type McpAudited } from './server'
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
export interface McpEndpointDeps {
  contextFor(principal: AgentPrincipal): AgentContext
  audit: AgentAuditSink
  maxRequestBytes: number
  now(): Date
}

const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json$/i

/** The header a client states its negotiated protocol revision in. */
const PROTOCOL_VERSION_HEADER = 'mcp-protocol-version'

function mediaType(header: string | null): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

function jsonRpcResponse(body: JsonRpcResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: agentApiHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  })
}

/** A notification or a response: received, nothing to say back. */
function accepted(): Response {
  return new Response(null, { status: 202, headers: agentApiHeaders() })
}


export async function handleMcpRequest(
  deps: McpEndpointDeps,
  request: Request,
  principal: AgentPrincipal,
  subject: AuditSubject,
): Promise<Response> {
  const started = deps.now()

  const record = async (audit: McpAudited): Promise<void> => {
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
      operation: 'mcp',
      input: null,
      data: null,
      errorCode: error.code,
      status: statusFor(error.code),
    })
    return errorResponse(error, { operation: 'mcp', ...(headers ? { extraHeaders: headers } : {}) })
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
  const outcome = await dispatchMcpMessage(
    { principal, context: () => deps.contextFor(principal) },
    message,
  )
  await record(outcome.audit)

  if (!outcome.response) return accepted()
  // A well-formed message that the server understood is answered `200`, error
  // envelope or not: the JSON-RPC error *is* the answer. Only a message that was
  // never one at all — unparseable, or not a JSON-RPC object — is an HTTP error.
  return jsonRpcResponse(outcome.response, message.kind === 'invalid' ? 400 : 200)
}
