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

/** One agent call, as it is stored. */
export interface AgentAuditRecord {
  at: string
  ownerId: string
  tokenId: string
  /** The name the owner gave the token, so a log is readable without a join. */
  tokenName: string
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

export interface AuditSubject {
  ownerId: string
  tokenId: string
  tokenName: string
}

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
  return {
    at: input.at.toISOString(),
    ownerId: input.subject.ownerId,
    tokenId: input.subject.tokenId,
    tokenName: input.subject.tokenName,
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
