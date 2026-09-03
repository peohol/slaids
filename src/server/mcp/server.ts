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
 */

import type { AgentContext } from '../../agent/types'
import { statusFor, type ApiError } from '../agent/protocol'
import { authorizeOperation, performOperation } from '../agent/invoke'
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
import { toolResultFor } from './result'
import { mcpTools, negotiateProtocolVersion, operationNameForTool } from './tools'

/** What the transport needs to answer one message. */
export interface McpSession {
  principal: AgentPrincipal
  /** Agent Core's context for this principal. Built per request, never shared. */
  context(): AgentContext
}

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
  const { id, method, params } = message

  switch (method) {
    case 'initialize':
      return {
        response: jsonRpcResult(id, {
          protocolVersion: negotiateProtocolVersion(params.protocolVersion),
          // Nothing but tools, and the list never changes while a client is
          // connected: it is compiled from the registry at build time, so there
          // is no `listChanged` notification to promise.
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
          instructions: MCP_INSTRUCTIONS,
        }),
        audit: protocolAudit(method),
      }

    case 'ping':
      return { response: jsonRpcResult(id, {}), audit: protocolAudit(method) }

    case 'tools/list':
      return listTools(id, params)

    case 'tools/call':
      return callTool(session, id, params)

    default:
      return {
        response: jsonRpcError(
          id,
          JSON_RPC_ERROR.METHOD_NOT_FOUND,
          `Slaids' MCP-server har ingen metode som heter «${method}».`,
          { method, available: ['initialize', 'ping', 'tools/list', 'tools/call'] },
        ),
        audit: protocolAudit(method, { code: JSON_RPC_ERROR.METHOD_NOT_FOUND }),
      }
  }
}

/**
 * The catalogue.
 *
 * Unpaged: the whole registry is a couple of dozen tools with their schemas, far
 * inside any sensible message size, so there is no cursor to issue. A client
 * that presents one got it from somewhere else, and the spec's answer to a
 * cursor a server did not mint is to refuse it rather than to guess.
 */
function listTools(id: string | number, params: Record<string, unknown>): McpOutcome {
  if (typeof params.cursor === 'string' && params.cursor.length > 0) {
    return {
      response: jsonRpcError(
        id,
        JSON_RPC_ERROR.INVALID_PARAMS,
        'Ukjent cursor. Slaids paginerer ikke verktøylisten, så hele listen kommer i ett svar.',
      ),
      audit: protocolAudit('tools/list', { code: JSON_RPC_ERROR.INVALID_PARAMS }),
    }
  }
  return { response: jsonRpcResult(id, { tools: mcpTools() }), audit: protocolAudit('tools/list') }
}

/**
 * One operation, called the way REST calls it.
 *
 * The only thing decided here is the shape of the message: MCP puts the tool
 * name in `params.name` and the operation's own arguments in `params.arguments`.
 * Everything after that — does it exist, may this token run it, does the input
 * match the schema, what did the domain say — is `invoke.ts`, unchanged.
 */
async function callTool(
  session: McpSession,
  id: string | number,
  params: Record<string, unknown>,
): Promise<McpOutcome> {
  if (typeof params.name !== 'string' || params.name.length === 0) {
    return {
      response: jsonRpcError(
        id,
        JSON_RPC_ERROR.INVALID_PARAMS,
        'Kallet mangler «name», altså hvilket verktøy som skal kjøres.',
      ),
      audit: protocolAudit('tools/call', { code: JSON_RPC_ERROR.INVALID_PARAMS }),
    }
  }

  const name = operationNameForTool(params.name)
  // Absent arguments is the empty object, which is what an operation without
  // arguments wants to receive — the same reading REST gives an empty body.
  const input = params.arguments === undefined ? {} : params.arguments

  const authorized = authorizeOperation(session.principal, name)
  if (!authorized.ok) return refusal(id, name, input, authorized.error)

  const outcome = await performOperation(session.context(), name, input)
  return {
    response: jsonRpcResult(id, toolResultFor(outcome)),
    audit: {
      operation: name,
      input,
      data: outcome.data ?? null,
      errorCode: outcome.error ? outcome.error.code : null,
      status: outcome.error ? statusFor(outcome.error.code) : 200,
    },
  }
}

/**
 * A tool call Slaids refused before it ran.
 *
 * Still a tool *result*, not a JSON-RPC error, and for the same reason
 * `result.ts` gives: an unknown name comes back with the real names in it, and a
 * missing scope comes back with which scope — both of which an agent can act on,
 * and neither of which most clients would show it from an error envelope.
 */
function refusal(
  id: string | number,
  name: string,
  input: unknown,
  error: ApiError,
): McpOutcome {
  return {
    response: jsonRpcResult(id, toolResultFor({ error })),
    audit: { operation: name, input, data: null, errorCode: error.code, status: statusFor(error.code) },
  }
}
