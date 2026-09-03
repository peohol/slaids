/**
 * JSON-RPC 2.0, which is the envelope MCP speaks in.
 *
 * Nothing about Slaids is in this file. It answers one question — "what kind of
 * message is this, and is it well formed?" — and it answers it as a value, so
 * every malformed thing a client can send is a branch a test can hold on to
 * rather than an exception somewhere up the stack.
 *
 * Two deliberate narrowings against plain JSON-RPC, both of them MCP's:
 *
 *  - **no batching.** The 2025-06-18 revision removed it. An array is therefore
 *    not a batch we decline to run, it is a message shape that no longer exists,
 *    and saying so is more useful than answering the first element of it.
 *  - **no `null` id.** JSON-RPC allows a request to carry one; MCP forbids it,
 *    because `null` is what a response to an unparseable request uses and the
 *    two would be indistinguishable.
 *
 * What it does *not* narrow is which strings may be an id. The empty string is
 * one, and `readId` says so — see the note there for why that matters.
 */

export const JSONRPC_VERSION = '2.0'

/** MCP ids are a string or a number; `null` is reserved for "we could not tell". */
export type JsonRpcId = string | number

export interface JsonRpcSuccess {
  jsonrpc: typeof JSONRPC_VERSION
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: typeof JSONRPC_VERSION
  /** `null` when the message was too broken to carry an id. */
  id: JsonRpcId | null
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

/** The reserved codes. Everything above -32000 would be application specific. */
export const JSON_RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

export type JsonRpcErrorCode = (typeof JSON_RPC_ERROR)[keyof typeof JSON_RPC_ERROR]

/**
 * How a protocol-level refusal reads in the audit and in the status column.
 *
 * The audit is the owner's, and it is read across both transports: a row that
 * said only `-32601` would be a row that has to be decoded before it can be
 * compared with anything REST wrote. So a JSON-RPC code becomes a name and a
 * status here, once, next to the codes themselves.
 */
export const JSON_RPC_AUDIT: Record<JsonRpcErrorCode, { code: string; status: number }> = {
  [JSON_RPC_ERROR.PARSE_ERROR]: { code: 'MCP_PARSE_ERROR', status: 400 },
  [JSON_RPC_ERROR.INVALID_REQUEST]: { code: 'MCP_INVALID_REQUEST', status: 400 },
  [JSON_RPC_ERROR.METHOD_NOT_FOUND]: { code: 'MCP_METHOD_NOT_FOUND', status: 404 },
  [JSON_RPC_ERROR.INVALID_PARAMS]: { code: 'MCP_INVALID_PARAMS', status: 400 },
  [JSON_RPC_ERROR.INTERNAL_ERROR]: { code: 'MCP_INTERNAL_ERROR', status: 500 },
}

/** What arrived, once the envelope has been read. Never an exception. */
export type IncomingMessage =
  | { kind: 'request'; id: JsonRpcId; method: string; params: Record<string, unknown> }
  | { kind: 'notification'; method: string; params: Record<string, unknown> }
  /**
   * An answer to something the server asked. Slaids asks nothing — it has no
   * sampling, no elicitation and no roots request — so there is nothing to
   * correlate it with, and the transport acknowledges it and moves on.
   */
  | { kind: 'response'; id: JsonRpcId | null }
  | { kind: 'invalid'; code: JsonRpcErrorCode; message: string; id: JsonRpcId | null }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The id a message carries, if it carries one.
 *
 * `undefined` means there is none, and that is what makes a message a
 * notification. It is deliberately *not* `null`, because `''` is a perfectly
 * valid id: JSON-RPC requires only that one be a string or a number, so a client
 * that numbers its requests from the empty string is conforming — and folding
 * that into "absent" would quietly turn its calls into notifications, answered
 * `202` and never run.
 *
 * An explicit `null` is treated as absent. JSON-RPC allows it on a request, MCP
 * forbids it, and it is what a response to an unreadable message carries, so
 * there is nothing to answer under it either way.
 */
function readId(message: Record<string, unknown>): JsonRpcId | undefined {
  const id = message.id
  if (typeof id === 'string') return id
  // JSON cannot express a non-finite number, so this only rules out an id no
  // answer could ever be matched against.
  if (typeof id === 'number' && Number.isFinite(id)) return id
  return undefined
}

export function readJsonRpcMessage(value: unknown): IncomingMessage {
  if (Array.isArray(value)) {
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      message:
        'MCP støtter ikke JSON-RPC-batcher. Send én melding per forespørsel til dette endepunktet.',
      id: null,
    }
  }
  if (!isPlainObject(value)) {
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      message: 'Meldingen må være et JSON-RPC-objekt.',
      id: null,
    }
  }

  const id = readId(value)
  // What a refusal is addressed to. `null` is JSON-RPC's own "we could not tell
  // which call this was", which is exactly the case when there is no id.
  const answerTo = id ?? null

  if (value.jsonrpc !== JSONRPC_VERSION) {
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      message: `Feltet «jsonrpc» må være «${JSONRPC_VERSION}».`,
      id: answerTo,
    }
  }

  if (typeof value.method !== 'string' || value.method.length === 0) {
    // No method and a result or an error means this is an answer, not a call.
    if ('result' in value || 'error' in value) return { kind: 'response', id: answerTo }
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      message: 'Meldingen mangler et «method»-felt.',
      id: answerTo,
    }
  }

  // MCP is always by-name; positional parameters would be a second calling
  // convention for the same tools, and the published schemas describe only one.
  if (value.params !== undefined && !isPlainObject(value.params)) {
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_PARAMS,
      message: 'Feltet «params» må være et objekt.',
      id: answerTo,
    }
  }

  const params = isPlainObject(value.params) ? value.params : {}
  if (id === undefined) return { kind: 'notification', method: value.method, params }
  return { kind: 'request', id, method: value.method, params }
}

export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSONRPC_VERSION, id, result }
}

export function jsonRpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}
