/**
 * The MCP server itself: which method does what.
 *
 * Five methods, and only one of them reaches Slaids. `initialize`, `ping`,
 * `tools/list` and the initialized notification are protocol; `tools/call` hands
 * the arguments to `invoke.ts` — the same two functions the REST route calls, in
 * the same order — and turns the answer into a tool result. That is the whole
 * adapter, and it is why "same operation, same result over both transports" is a
 * property of the code rather than a promise about it.
 *
 * Deliberately absent: resources, prompts, sampling, completion, logging and
 * subscriptions. Slaids' surface is a set of semantic operations, all of which
 * are tools; a resource list of presentations would be a second way to read the
 * same decks, with a second contract to keep in step. `capabilities` says so, so
 * a client never asks.
 *
 * There is no session either. The bearer token is the identity on every single
 * message, exactly as it is over REST, and there is no state between two calls
 * that the presentation's own `revision` does not already carry. That is what
 * makes the endpoint safe on a platform that may answer two messages from two
 * instances — a session held in one instance's memory would be a session the
 * next request cannot find.
 *
 * ## Which messages need a token
 *
 * MCP discovery is public; Slaids' operations are authenticated and scope-gated.
 * `METHOD_ACCESS` below is where that line is drawn, and the shape of it is the
 * argument: it is a total map over the methods this server implements, so the
 * dispatch switch cannot gain a case without the map gaining an entry, and
 * whoever adds the next method has to say which side of the line it is on.
 *
 * The line is not a taste. It follows from what a message can *reach*:
 *
 *  - `tools/call` is the only method that reaches `invoke.ts`, and therefore the
 *    only one that can read or change a deck. It needs the same token every REST
 *    route needs, and the same scopes, enforced by the same two functions.
 *  - `initialize`, `ping` and `tools/list` answer out of this file and the
 *    registry alone. The catalogue is compiled from the operation definitions —
 *    names, descriptions, JSON Schema, required scopes — so it is the same bytes
 *    for every caller and for none: product metadata, not the owner's data.
 *    `discovery.test.ts` proves the reach rather than asserting it, by answering
 *    all three from a deployment whose repository throws if anything asks.
 *  - a notification, a stray response and a malformed envelope are public by
 *    construction rather than by listing: `dispatchMcpMessage` acknowledges each
 *    of them without dispatching anything at all.
 *
 * Public discovery is what lets a client build its tool list before the owner
 * has pasted a token into it — which is how ChatGPT's custom MCP apps, and every
 * other "scan the server, then connect an account" client, are built. MCP's own
 * authorization specification is optional and lives at the transport level, so a
 * server may protect some requests and not others; what it does fix is the
 * *answer* when a request needs a token and has none, and that answer is an HTTP
 * 401. The endpoint next door gives it, before this file is reached.
 *
 * ## Where a refusal goes
 *
 * MCP has two places to put one, and which one it goes in is a fact about the
 * failure rather than a preference:
 *
 *  - **a JSON-RPC error** when the message was never a valid call: an unknown
 *    method, parameters that are not the shape the method takes, a tool that
 *    does not exist, or arguments that do not match the tool's published schema.
 *    Nothing ran, and nothing could have. The reference implementation draws the
 *    line in exactly this place — both "tool not found" and "invalid arguments
 *    for tool" are `InvalidParams` there — and drawing it anywhere else would
 *    make a schema violation look like something Slaids considered and declined.
 *  - **a tool result with `isError: true`** when a real operation ran and said
 *    no: content that does not fit, a stale revision, a presentation that is not
 *    there, a scope the token lacks. Those are answers, and an agent is supposed
 *    to read them and act — which is what most clients show a model, where a
 *    JSON-RPC error goes to the log.
 *
 * Either way the payload is Agent Core's own error object, unchanged, so the
 * code and details an agent branches on are the same ones REST returns.
 */

import type { AgentContext } from '../../agent/types'
import { statusFor, unauthenticatedError, type ApiErrorCode } from '../agent/protocol'
import { authorizeOperation, performOperation, type OperationOutcome } from '../agent/invoke'
import type { AgentPrincipal } from '../agent/tokens'
import {
  JSON_RPC_AUDIT,
  JSON_RPC_ERROR,
  jsonRpcError,
  jsonRpcResult,
  type IncomingMessage,
  type JsonRpcErrorCode,
  type JsonRpcResponse,
} from './jsonrpc'
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from './instructions'
import {
  readCallToolParams,
  readInitializeParams,
  readListToolsParams,
  type Validated,
} from './requests'
import { toolResultFor } from './result'
import { mcpTools, negotiateProtocolVersion, operationNameForTool } from './tools'

/**
 * What the transport needs to answer one message.
 *
 * Two shapes rather than a nullable principal, so the boundary above is
 * structural instead of remembered. An anonymous session has no principal *and
 * no way to build a context* — the two things every operation needs — so a
 * public method cannot reach a deck even by mistake, and a method that needs one
 * cannot be written without saying so.
 */
export type McpSession =
  | { authenticated: false }
  | {
      authenticated: true
      principal: AgentPrincipal
      /** Agent Core's context for this principal. Built per request, never shared. */
      context(): AgentContext
    }

/** A session that presented a usable token. Only one of these reaches an operation. */
type AuthenticatedSession = Extract<McpSession, { authenticated: true }>

/**
 * What the owner's audit records about one message.
 *
 * `status` is the reading of the error code, not the HTTP status of the
 * JSON-RPC envelope — which is 200 for almost everything, and would make the
 * column useless. A `CONFLICT` is 409 in the audit whether it arrived over REST
 * or over MCP, so the two transports can be read in one query.
 */
export interface McpAudited {
  operation: string
  /** Only ever read for a `presentationId`; see `auditedPresentationId`. */
  input: unknown
  data: unknown
  errorCode: string | null
  status: number
}

export interface McpOutcome {
  /** The answer, or `null` for a notification — which never gets one. */
  response: JsonRpcResponse | null
  audit: McpAudited
}

/** Protocol traffic, named so it cannot be confused with an operation. */
const MCP_AUDIT_PREFIX = 'mcp:'

function protocolAudit(method: string, error?: { code: JsonRpcErrorCode }): McpAudited {
  const refusal = error ? JSON_RPC_AUDIT[error.code] : null
  return {
    operation: `${MCP_AUDIT_PREFIX}${method}`,
    input: null,
    data: null,
    errorCode: refusal?.code ?? null,
    status: refusal?.status ?? 200,
  }
}

export async function dispatchMcpMessage(
  session: McpSession,
  message: IncomingMessage,
): Promise<McpOutcome> {
  if (message.kind === 'invalid') {
    return {
      response: jsonRpcError(message.id, message.code, message.message),
      audit: protocolAudit('invalid', { code: message.code }),
    }
  }

  // An answer to a question this server never asks. Acknowledged, not acted on.
  if (message.kind === 'response') {
    return { response: null, audit: protocolAudit('response') }
  }

  if (message.kind === 'notification') {
    // Notifications get no reply, ever — including the ones we do not know.
    return { response: null, audit: protocolAudit(message.method) }
  }

  return handleRequest(session, message)
}

async function handleRequest(
  session: McpSession,
  message: Extract<IncomingMessage, { kind: 'request' }>,
): Promise<McpOutcome> {
  const { id, params } = message

  // A method this server does not implement is answered before anything else,
  // and it is answered publicly: the list in the refusal is the four names the
  // specification already publishes, and nothing ran. It has to stay that way —
  // clients are known to ask for `resources/list` whether or not the server
  // announced the capability, and a 401 there would read as "this whole server
  // is locked" to a client that is only probing.
  const method = message.method
  if (!isSupportedMethod(method)) {
    return {
      response: jsonRpcError(
        id,
        JSON_RPC_ERROR.METHOD_NOT_FOUND,
        `Slaids' MCP-server har ingen metode som heter «${method}».`,
        { method, available: [...SUPPORTED_METHODS] },
      ),
      audit: protocolAudit(method, { code: JSON_RPC_ERROR.METHOD_NOT_FOUND }),
    }
  }

  switch (method) {
    case 'initialize': {
      const read = readInitializeParams(params)
      if (!read.ok) return refusedParams(id, method, read)
      return {
        response: jsonRpcResult(id, {
          // What the client asked for only if this server implements it; the
          // one revision it does implement otherwise. It never answers with a
          // version it does not speak — see `negotiateProtocolVersion`.
          protocolVersion: negotiateProtocolVersion(read.value.protocolVersion),
          // Nothing but tools, and the list never changes while a client is
          // connected: it is compiled from the registry at build time, so there
          // is no `listChanged` notification to promise.
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
          instructions: MCP_INSTRUCTIONS,
        }),
        audit: protocolAudit(method),
      }
    }

    // `ping` takes no parameters of its own, and the specification allows a
    // `_meta` on any of them, so there is nothing here to be strict about that
    // would not be strictness against the protocol rather than for it.
    case 'ping':
      return { response: jsonRpcResult(id, {}), audit: protocolAudit(method) }

    case 'tools/list': {
      const read = readListToolsParams(params)
      if (!read.ok) return refusedParams(id, method, read)
      return { response: jsonRpcResult(id, { tools: mcpTools() }), audit: protocolAudit(method) }
    }

    case 'tools/call': {
      // Unreachable through the endpoint, which answers an anonymous
      // `tools/call` with the transport's own 401 before this file is called at
      // all. It is written anyway because the type asks for it, and that is the
      // point: the refusal exists before a second caller of
      // `dispatchMcpMessage` ever does.
      if (!session.authenticated) {
        const error = unauthenticatedError()
        return {
          response: jsonRpcError(id, JSON_RPC_ERROR.INVALID_REQUEST, error.message, error),
          audit: {
            operation: `${MCP_AUDIT_PREFIX}${method}`,
            input: null,
            data: null,
            errorCode: error.code,
            status: statusFor(error.code),
          },
        }
      }
      const read = readCallToolParams(params)
      if (!read.ok) return refusedParams(id, method, read)
      return callTool(session, id, read.value.name, read.value.arguments)
    }
  }

  // Exhaustive: `method` is `never` here. A method added to `METHOD_ACCESS`
  // without a case above stops the build, which is what makes the map the one
  // place the public half of the surface is decided.
  const unhandled: never = method
  throw new Error(`Uhåndtert MCP-metode: ${String(unhandled)}`)
}

/**
 * Which methods this server implements, and which of them need a token.
 *
 * One map, two jobs, and that is the design: the switch above is exhaustive over
 * its keys, so a method cannot be implemented without being classified, and it
 * cannot be classified without being implemented. A hand-kept list of "public
 * methods" beside a switch would be the second contract this whole directory is
 * built to avoid — and the way it goes wrong is the quiet way, with a method
 * added to the switch and forgotten here, born public.
 *
 * The reasoning behind each entry is at the top of this file.
 */
const METHOD_ACCESS = {
  initialize: 'public',
  ping: 'public',
  'tools/list': 'public',
  'tools/call': 'authenticated',
} as const satisfies Record<string, 'public' | 'authenticated'>

type McpMethod = keyof typeof METHOD_ACCESS

/** Every method this server answers. Published in a method-not-found, so a
 * client that misspelled one can see the real ones without a second request. */
const SUPPORTED_METHODS: readonly McpMethod[] = Object.keys(METHOD_ACCESS) as McpMethod[]

/** `Object.hasOwn`, not `in`: `'constructor' in METHOD_ACCESS` is true. */
function isSupportedMethod(method: string): method is McpMethod {
  return Object.hasOwn(METHOD_ACCESS, method)
}

/**
 * Whether this message may only be answered to a caller with an agent token.
 *
 * Asked by the transport, before dispatch, so the refusal is an HTTP 401 with
 * the challenge on it rather than a JSON-RPC error a client would have to look
 * inside — MCP puts authorization at the transport level, and 401 is the answer
 * its error table names for "authorization required or token invalid".
 *
 * Only a request can be one: a notification and a stray response are
 * acknowledged and never acted on, and an invalid envelope never became a call.
 * That is read off the message kind rather than off a list of notification
 * names, because it is a property of `dispatchMcpMessage` above — it dispatches
 * nothing for any of the three — instead of a fact about the three that someone
 * has to keep true.
 */
export function requiresAgentToken(message: IncomingMessage): boolean {
  if (message.kind !== 'request') return false
  return isSupportedMethod(message.method) && METHOD_ACCESS[message.method] === 'authenticated'
}

/** Parameters that were not the shape the method takes. Nothing ran. */
function refusedParams(
  id: string | number,
  method: string,
  refusal: Extract<Validated<unknown>, { ok: false }>,
): McpOutcome {
  return {
    response: jsonRpcError(id, refusal.code, refusal.message, { method }),
    audit: protocolAudit(method, { code: refusal.code }),
  }
}

/**
 * The codes that mean this was never a valid call to a tool.
 *
 * `UNKNOWN_OPERATION` is a tool that does not exist, and `INVALID_INPUT` is
 * arguments that do not match the one it named — neither of which is something
 * Slaids weighed and declined, so neither is a *result*. The reference
 * implementation classifies exactly these two as `InvalidParams`, and matching
 * it is what makes an agent's error handling portable between servers.
 *
 * Everything else an operation can answer stays a tool result. The line is
 * "did a real operation get to decide", not "how bad was it": a missing scope is
 * a decision about a tool that exists, so it is an answer an agent can act on.
 */
const NEVER_A_VALID_CALL: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  'UNKNOWN_OPERATION',
  'INVALID_INPUT',
])

/**
 * One operation, called the way REST calls it.
 *
 * The only thing decided here is where the answer goes. Everything that decides
 * *what* the answer is — does the tool exist, may this token run it, do the
 * arguments match the schema, what did the domain say — is `invoke.ts`,
 * unchanged and shared with REST.
 */
async function callTool(
  session: AuthenticatedSession,
  id: string | number,
  toolName: string,
  input: Record<string, unknown>,
): Promise<McpOutcome> {
  const name = operationNameForTool(toolName)

  const authorized = authorizeOperation(session.principal, name)
  if (!authorized.ok) return answer(id, name, input, { error: authorized.error })

  return answer(id, name, input, await performOperation(session.context(), name, input))
}

/**
 * One outcome, in whichever of MCP's two envelopes it belongs.
 *
 * The audit is written the same way for both, under the operation's own name and
 * with the status the code would have had over HTTP — so a refusal reads the
 * same in the owner's log whichever envelope carried it, and whichever transport
 * it arrived on.
 */
function answer(
  id: string | number,
  name: string,
  input: unknown,
  outcome: OperationOutcome,
): McpOutcome {
  const error = outcome.error
  const audit: McpAudited = {
    operation: name,
    input,
    data: outcome.data ?? null,
    errorCode: error ? error.code : null,
    status: error ? statusFor(error.code) : 200,
  }

  if (error && NEVER_A_VALID_CALL.has(error.code)) {
    // A protocol error, with Agent Core's own error object as its `data`: the
    // envelope is MCP's, the payload is the one REST returns, so an agent reads
    // the same code and the same details either way.
    return { response: jsonRpcError(id, JSON_RPC_ERROR.INVALID_PARAMS, error.message, error), audit }
  }
  return { response: jsonRpcResult(id, toolResultFor(outcome)), audit }
}
