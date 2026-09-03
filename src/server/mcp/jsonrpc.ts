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
 *    two would be indistinguishable. A message that carries one is refused, not
 *    quietly demoted to a notification: a client that sent `id: null` is waiting
 *    for an answer, and `202` with silence is the one thing it cannot handle.
 *
 * What it does *not* narrow is which strings may be an id. The empty string is
 * one, and `readId` says so — see the note there for why that matters.
 *
 * This file reads the *envelope* and stops there. Which parameters a method
 * requires is `requests.ts`, because those rules are MCP's rather than
 * JSON-RPC's, and a message can be a perfectly well-formed request and still be
 * a call no method could serve.
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

/** Shared with `requests.ts`: MCP's parameters are always by name. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What a message says about which call it is.
 *
 * Three outcomes, and the difference between the first two is the whole reason
 * this is not a single nullable value:
 *
 *  - **absent** — no `id` member at all. That, and only that, is a notification.
 *  - **an id** — including `''` and `0`. JSON-RPC requires only that an id be a
 *    string or a number, so a client that numbers its requests from the empty
 *    string is conforming; folding that into "absent" would turn its calls into
 *    notifications, answered `202` and never run.
 *  - **invalid** — an `id` member that is present but is not one: `null`, a
 *    boolean, an object. MCP forbids `null` outright, and a client that sent one
 *    is waiting for an answer, so the honest reply is a refusal it can read
 *    rather than an acknowledgement it cannot act on.
 */
type IdReading =
  | { kind: 'absent' }
  | { kind: 'id'; id: JsonRpcId }
  | { kind: 'invalid' }

function readId(message: Record<string, unknown>): IdReading {
  if (!('id' in message)) return { kind: 'absent' }
  const id = message.id
  if (typeof id === 'string') return { kind: 'id', id }
  // JSON cannot express a non-finite number, so this only rules out an id no
  // answer could ever be matched against.
  if (typeof id === 'number' && Number.isFinite(id)) return { kind: 'id', id }
  return { kind: 'invalid' }
}

/** The id to address a refusal to, when the message may not have a usable one. */
function answerTo(reading: IdReading): JsonRpcId | null {
  return reading.kind === 'id' ? reading.id : null
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

  const reading = readId(value)
  // What a refusal is addressed to. `null` is JSON-RPC's own "we could not tell
  // which call this was", which is exactly the case when there is no usable id.
  const addressee = answerTo(reading)

  if (value.jsonrpc !== JSONRPC_VERSION) {
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      message: `Feltet «jsonrpc» må være «${JSONRPC_VERSION}».`,
      id: addressee,
    }
  }

  if (typeof value.method !== 'string' || value.method.length === 0) {
    // No method and a result or an error means this is an answer, not a call —
    // and an answer legitimately carries `id: null` when the peer could not read
    // what it was answering, so this is checked before the id is judged.
    if ('result' in value || 'error' in value) return { kind: 'response', id: addressee }
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      message: 'Meldingen mangler et «method»-felt.',
      id: addressee,
    }
  }

  if (reading.kind === 'invalid') {
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      message:
        'Feltet «id» må være en streng eller et tall. MCP tillater ikke null som id på en forespørsel.',
      id: null,
    }
  }

  // MCP is always by-name; positional parameters would be a second calling
  // convention for the same tools, and the published schemas describe only one.
  if (value.params !== undefined && !isPlainObject(value.params)) {
    return {
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_PARAMS,
      message: 'Feltet «params» må være et objekt.',
      id: addressee,
    }
  }

  const params = isPlainObject(value.params) ? value.params : {}
  if (reading.kind === 'absent') return { kind: 'notification', method: value.method, params }
  return { kind: 'request', id: reading.id, method: value.method, params }
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
