/**
 * An Agent Core answer, as a `tools/call` result.
 *
 * The rule this file exists to hold: **an agent must be able to act on the
 * machine-readable half alone.** So every answer carries the operation's own
 * object in `structuredContent`, unchanged and unflattened — the same value
 * REST puts in `data` — and the text block is a rendering of it rather than a
 * summary of it. A client that only shows text loses nothing; a client that
 * reads structure gets ids, rects, overflow numbers and revisions it can put
 * straight into the next call.
 *
 * A refusal is a result, not an exception. `isError: true` with the error in
 * `structuredContent` means the model sees `CONTENT_DOES_NOT_FIT` and the
 * overflow that came with it, and can shorten the text — where a JSON-RPC error
 * would have surfaced to most clients as "the tool call failed" with the useful
 * part in a corner. Protocol errors are the opposite case and stay JSON-RPC
 * errors: a message that was never a valid call to Slaids has nothing for an
 * agent to act on except "you addressed this wrong".
 */

import type { ApiError } from '../agent/protocol'
import type { OperationOutcome } from '../agent/invoke'

export interface McpTextContent {
  type: 'text'
  text: string
}

export interface McpToolResult {
  content: McpTextContent[]
  /** The operation's own answer. Objects only — the spec allows nothing else. */
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: string): McpTextContent[] {
  return [{ type: 'text', text: value }]
}

/**
 * The readable half of a refusal.
 *
 * Code first, because it is the part an agent branches on, and the details
 * verbatim underneath: which slide, which zone, how much did not fit. Those
 * numbers are the difference between "try something else" and "shorten this by
 * that much".
 */
export function errorText(error: ApiError): string {
  const details = error.details ? `\n${JSON.stringify(error.details, null, 2)}` : ''
  return `${error.code}: ${error.message}${details}`
}

export function toolResultFor(outcome: OperationOutcome): McpToolResult {
  if (outcome.error) {
    return {
      isError: true,
      content: text(errorText(outcome.error)),
      structuredContent: { error: outcome.error as unknown as Record<string, unknown> },
    }
  }

  const data = outcome.data
  return {
    content: text(JSON.stringify(data, null, 2)),
    // Every operation answers with an object today, and the guard is here for
    // the day one does not: a non-object in `structuredContent` is a response
    // a strict client rejects outright, which would lose the text block too.
    ...(isPlainObject(data) ? { structuredContent: data } : {}),
    ...(outcome.revision ? { _meta: { 'slaids/revision': outcome.revision } } : {}),
  }
}
