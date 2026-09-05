/**
 * What an agent call leaves behind.
 *
 * §44 asks for agent mutations to be distinguishable from the owner's own, and
 * lists what has to be traceable: which token, when, which operation, which
 * presentation, whether it worked and which error code. It also says what must
 * *not* be logged uncritically — slide content, binary files and whole payloads.
 *
 * So the record below is a closed shape rather than a bag: there is no field a
 * payload could be put in, and `auditRecord` is the only thing that builds one.
 * A test asserts that a record made from a request full of text carries none of
 * that text — which is a rule that can only be checked because the shape is
 * fixed here rather than assembled at each call site.
 *
 * The token is identified by its row id and its name. The token itself is never
 * part of a record, and neither is its hash: an audit trail is read far more
 * often than it is written, and it must not become a place credentials are kept.
 */

import { statusFor } from './protocol'
import { REFUSAL_CODES, type AgentCredentialKind, type AuthOutcome } from './tokens'

/** One agent call, as it is stored. */
export interface AgentAuditRecord {
  at: string
  ownerId: string
  /**
   * Which credential family made the call.
   *
   * Added when OAuth was, and it is the reason the two columns below became
   * nullable rather than the reason a fake token row got invented for an OAuth
   * call. An owner reading their log has to be able to see "this came from the
   * ChatGPT connector" as distinct from "this came from the token I minted for
   * my build script", and neither of those is knowable from an operation name.
   */
  principalKind: AgentCredentialKind
  /** The agent token's row id, or `null` for a call that used none. */
  tokenId: string | null
  /** The name the owner gave the token, so a log is readable without a join. */
  tokenName: string
  /**
   * The OAuth client the owner approved, or `null` for an agent-token call.
   *
   * A `client_id` is a public identifier — it travels in the authorization
   * request, in the browser's address bar — so it is the one OAuth value that
   * belongs in a log. The access token, the refresh token, the code and the
   * verifier are not here and there is nowhere to put them.
   */
  clientId: string | null
  operation: string
  presentationId: string | null
  success: boolean
  errorCode: string | null
  status: number
  durationMs: number
}

/** Where records go. Injected so the handler can be tested without a database. */
export interface AgentAuditSink {
  record(entry: AgentAuditRecord): Promise<void>
}

/**
 * Who a row is attributed to.
 *
 * The same union `AgentPrincipal` is, minus the authority: an audit says who
 * acted, never what they were allowed to do.
 */
export type AuditSubject =
  | { kind: 'agent_token'; ownerId: string; tokenId: string; tokenName: string }
  | { kind: 'oauth'; ownerId: string; clientId: string }

/**
 * Build the record for one call.
 *
 * Everything it is allowed to know is a parameter, and every parameter is a
 * scalar. That is the whole defence: there is no path from a request body to a
 * stored row, because nothing here takes one.
 */
export function auditRecord(input: {
  at: Date
  subject: AuditSubject
  operation: string
  presentationId: string | null
  status: number
  errorCode: string | null
  durationMs: number
}): AgentAuditRecord {
  const subject = input.subject
  return {
    at: input.at.toISOString(),
    ownerId: subject.ownerId,
    principalKind: subject.kind,
    tokenId: subject.kind === 'agent_token' ? subject.tokenId : null,
    tokenName: subject.kind === 'agent_token' ? subject.tokenName : '',
    clientId: subject.kind === 'oauth' ? subject.clientId : null,
    // The name comes off the URL, so it is as long as a caller wants it to be
    // and the column is not. Bounded here rather than left to fail the insert:
    // a nonsense name should cost a truncated audit row, not a missing one.
    operation: input.operation.slice(0, 100),
    presentationId: input.presentationId,
    success: input.errorCode === null,
    errorCode: input.errorCode,
    status: input.status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
  }
}

/**
 * Which presentation a call was about.
 *
 * Read from the request's own `presentationId` when it has one, and otherwise
 * from the answer — `create_presentation` is told nothing and returns the id it
 * minted, and a log that could not say which deck an agent created would be
 * missing the one call that matters most.
 *
 * Deliberately narrow: it reads a single string field by name from two places
 * and copies nothing else. It never walks the object.
 */
export function auditedPresentationId(input: unknown, data: unknown): string | null {
  return stringField(input, 'presentationId') ?? stringField(data, 'presentationId') ?? null
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const field = (value as Record<string, unknown>)[key]
  // Bounded, because this ends up in a database column and an id is short. A
  // caller that sends a novel as an id gets it truncated, not stored.
  return typeof field === 'string' && field.length > 0 && field.length <= 200 ? field : null
}

/**
 * Write one row, and never let the writing of it fail the call.
 *
 * An audit that cannot be written must not turn a successful mutation into a
 * failure the agent will retry — the write already happened, and retrying it is
 * the more damaging of the two. It is loud in the server log instead.
 *
 * Shared by both transports for the same reason `invoke.ts` is: "one row per
 * authenticated call" is a property of the API, not of REST, and a second copy
 * of this try/catch is a second place the swallowing could go missing.
 */
export async function recordAgentCall(
  sink: AgentAuditSink,
  entry: Parameters<typeof auditRecord>[0],
): Promise<void> {
  try {
    await sink.record(auditRecord(entry))
  } catch (error) {
    console.error('slaids-agent: kunne ikke skrive auditrad', error)
  }
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
 *
 * Shared by both transports, and by the same reasoning that put `recordAgentCall`
 * here: which refusals are worth a row is a rule about the API rather than about
 * REST, and the MCP endpoint — which now decides for itself when a token is
 * required — must not be able to answer it differently.
 */
export async function recordRefusedToken(
  sink: AgentAuditSink,
  input: { at: Date; auth: Extract<AuthOutcome, { ok: false }>; operation: string },
): Promise<void> {
  const identified = input.auth.identified
  if (!identified) return
  await recordAgentCall(sink, {
    at: input.at,
    subject: identified,
    operation: input.operation,
    presentationId: null,
    status: statusFor('UNAUTHENTICATED'),
    errorCode: REFUSAL_CODES[input.auth.reason],
    durationMs: 0,
  })
}
