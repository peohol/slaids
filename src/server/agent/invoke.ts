/**
 * One authorised operation call, shared by every transport.
 *
 * §44 asks that the same operation give semantically the same result over REST
 * and over MCP. That is not something two adapters can promise each other by
 * being written carefully — it is something they get by being the same code. So
 * everything that happens between "a caller named an operation" and "Agent Core
 * answered" lives here, and each transport only decides how to *serialise* the
 * two ends:
 *
 *  - is there such an operation, and may this token run it (`authorizeOperation`);
 *  - run it, and lift the reading out of the answer (`performOperation`).
 *
 * The split into two is deliberate rather than tidy. REST checks scopes before
 * it reads the body, so an unauthorised caller cannot make the server buffer
 * megabytes for it; MCP already has the arguments by the time it knows the tool
 * name, because they arrived in the same JSON-RPC message. One function that did
 * both would have forced REST to give that up.
 *
 * There is no domain rule here, and there must never be one. Scope enforcement
 * is the exception that proves it: the *requirement* is declared on the
 * operation, and this file only compares it against the token.
 */

import { findOperation, runOperation, unknownOperationError } from '../../agent/registry'
import type { AgentContext, AnyAgentOperation } from '../../agent/types'
import { fromAgentError, revisionOf, type ApiError } from './protocol'
import { missingScopes, type AgentPrincipal } from './tokens'

export type Authorization =
  | { ok: true; operation: AnyAgentOperation }
  | { ok: false; error: ApiError }

/**
 * Whether this token may run the operation with this name.
 *
 * An unknown name is Agent Core's own error, list of real names and all, so a
 * misspelling says the same thing whichever transport it arrived through. A
 * missing scope is the transport's own — Agent Core runs in-process with
 * exactly the access its caller already has, so a check it performed on itself
 * would not be one — and the requirement is read off `operation.scopes` rather
 * than out of a table kept next to the router.
 */
export function authorizeOperation(
  principal: Pick<AgentPrincipal, 'scopes'>,
  name: string,
): Authorization {
  const operation = findOperation(name)
  if (!operation) return { ok: false, error: fromAgentError(unknownOperationError(name)) }

  const lacking = missingScopes(principal, operation.scopes)
  if (lacking.length > 0) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_SCOPE',
        message: `Tokenet mangler ${lacking.join(', ')} for «${name}».`,
        details: { operation: name, required: [...operation.scopes], missing: lacking },
      },
    }
  }
  return { ok: true, operation }
}

/** What one call produced: the operation's own answer, or the error it refused with. */
export interface OperationOutcome {
  data?: unknown
  error?: ApiError
  /** The reading this answer produced, lifted out of `data` where there is one. */
  revision?: string
}

/**
 * Run it.
 *
 * `runOperation` never throws — validation, a store that refused the write and
 * an outright bug all come back as the same envelope — so this is a translation
 * and nothing else.
 */
export async function performOperation(
  context: AgentContext,
  name: string,
  input: unknown,
): Promise<OperationOutcome> {
  const result = await runOperation(context, name, input)
  if (!result.ok) return { error: fromAgentError(result.error) }

  const revision = revisionOf(result.value)
  return { data: result.value, ...(revision ? { revision } : {}) }
}
