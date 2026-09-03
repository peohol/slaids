/**
 * What each MCP method requires of its parameters.
 *
 * The JSON-RPC parser next door answers "is this a well-formed message?" and
 * stops there, because that is all JSON-RPC has an opinion about. MCP has more:
 * `initialize` without `clientInfo` is a valid JSON-RPC request and an invalid
 * MCP one, and a server that shrugged and carried on would be answering a
 * handshake that never happened.
 *
 * So every method's parameters are read here, once, before anything is
 * dispatched. Three properties are worth stating, because they are what make
 * this worth a file rather than a few inline `if`s:
 *
 *  - **a refusal is a value.** Nothing throws; each reader returns either the
 *    typed parameters or the JSON-RPC error to answer with, so the dispatcher
 *    has one shape to handle and the tests have one thing to assert on.
 *  - **it is hand-written on purpose.** `@modelcontextprotocol/sdk` has schemas
 *    for exactly these shapes, and they are used — as the *oracle* in
 *    `requests.test.ts`, which checks that everything these readers accept, the
 *    specification's own schemas accept too. The SDK stays a development
 *    dependency; the runtime keeps no dependency it does not need.
 *  - **it is strict where the specification is, and no stricter.** An unknown
 *    field is not an error (MCP is explicitly extensible, and `_meta` may appear
 *    anywhere), and a tool name is not required to be non-empty — an empty one
 *    simply names no tool, which the registry already answers for.
 */

import { JSON_RPC_ERROR, isPlainObject, type JsonRpcErrorCode } from './jsonrpc'

/** Parameters that were acceptable, or the refusal to answer with. */
export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; code: JsonRpcErrorCode; message: string }

function invalid<T>(message: string): Validated<T> {
  return { ok: false, code: JSON_RPC_ERROR.INVALID_PARAMS, message }
}

/* ------------------------------------------------------------------ *
 * initialize
 * ------------------------------------------------------------------ */

export interface InitializeParams {
  /** What the client asks to speak. Negotiated, never trusted as given. */
  protocolVersion: string
  capabilities: Record<string, unknown>
  clientInfo: { name: string; version: string }
}

/**
 * The handshake.
 *
 * All three fields are required by the specification, and each of them means
 * something here: the version is what `negotiateProtocolVersion` answers, and
 * the other two are how a server knows who it is talking to. Accepting a
 * handshake without them would be accepting a session whose other half never
 * said what it was.
 */
export function readInitializeParams(params: Record<string, unknown>): Validated<InitializeParams> {
  if (typeof params.protocolVersion !== 'string' || params.protocolVersion.length === 0) {
    return invalid('initialize krever «protocolVersion» som en streng.')
  }
  if (!isPlainObject(params.capabilities)) {
    return invalid('initialize krever «capabilities» som et objekt.')
  }
  const clientInfo = params.clientInfo
  if (!isPlainObject(clientInfo)) {
    return invalid('initialize krever «clientInfo» som et objekt.')
  }
  if (typeof clientInfo.name !== 'string' || typeof clientInfo.version !== 'string') {
    return invalid('«clientInfo» må ha «name» og «version» som strenger.')
  }

  return {
    ok: true,
    value: {
      protocolVersion: params.protocolVersion,
      capabilities: params.capabilities,
      clientInfo: { name: clientInfo.name, version: clientInfo.version },
    },
  }
}

/* ------------------------------------------------------------------ *
 * tools/list
 * ------------------------------------------------------------------ */

export interface ListToolsParams {
  /** Only ever present when a client made one up: Slaids issues none. */
  cursor?: string
}

/**
 * The catalogue request.
 *
 * A cursor of the wrong type is refused rather than ignored. Ignoring it would
 * answer the *first* page to a client that asked for a later one, which is the
 * failure mode a pagination bug is made of — and this server has no pages, so
 * any cursor at all is a client that is confused about which server it is
 * talking to.
 */
export function readListToolsParams(params: Record<string, unknown>): Validated<ListToolsParams> {
  if (params.cursor === undefined) return { ok: true, value: {} }
  if (typeof params.cursor !== 'string') {
    return invalid('«cursor» må være en streng.')
  }
  if (params.cursor.length > 0) {
    return invalid(
      'Ukjent cursor. Slaids paginerer ikke verktøylisten, så hele listen kommer i ett svar.',
    )
  }
  return { ok: true, value: { cursor: params.cursor } }
}

/* ------------------------------------------------------------------ *
 * tools/call
 * ------------------------------------------------------------------ */

export interface CallToolParams {
  name: string
  /** Absent is the empty object — the same reading REST gives an empty body. */
  arguments: Record<string, unknown>
}

/**
 * A tool call, as MCP shapes it.
 *
 * This checks the *envelope of the call*, not the tool's own contract: that
 * `name` is a string and that `arguments`, if present, is an object. Whether
 * such a tool exists, and whether those arguments match its published schema,
 * are the registry's and the operation's answers — both of which land as
 * protocol errors too, but only after this has established that there was a call
 * to look up at all.
 */
export function readCallToolParams(params: Record<string, unknown>): Validated<CallToolParams> {
  if (typeof params.name !== 'string') {
    return invalid('tools/call krever «name», altså hvilket verktøy som skal kjøres.')
  }
  if (params.arguments !== undefined && !isPlainObject(params.arguments)) {
    return invalid('«arguments» må være et objekt med operasjonens felter.')
  }
  return {
    ok: true,
    value: { name: params.name, arguments: params.arguments ?? {} },
  }
}
