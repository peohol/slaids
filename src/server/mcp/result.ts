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

import { encodeBase64 } from '../../agent/binary'
import type { ApiError } from '../agent/protocol'
import type { OperationOutcome } from '../agent/invoke'

export interface McpTextContent {
  type: 'text'
  text: string
}

/**
 * The protocol's own way of carrying a picture: base64 plus a media type.
 *
 * This block, and not a base64 string inside the text, is what makes a rendered
 * preview *visible* to the model on the other end. A client that receives
 * `ImageContent` hands it to a multimodal model as an image; the same bytes
 * pasted into a text block are half a megabyte of characters it will read as
 * characters, which is both useless and expensive. `interop.test.ts` validates
 * the shape against the official SDK's schema rather than against this comment.
 */
export interface McpImageContent {
  type: 'image'
  /** Base64, without a data-URL prefix. The spec is explicit about that. */
  data: string
  mimeType: string
}

export type McpContent = McpTextContent | McpImageContent

export interface McpToolResult {
  content: McpContent[]
  /** The operation's own answer. Objects only — the spec allows nothing else. */
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: string): McpContent[] {
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

/**
 * The prose half of a result, joined.
 *
 * A result's `content` is a list of blocks, and since a preview added a second
 * kind there is no longer such a thing as "the text block". A caller that wants
 * what a text-only client would show asks for that, rather than indexing into a
 * list whose first element is now a fact about which operation answered.
 */
export function resultText(result: McpToolResult): string {
  return result.content
    .filter((block): block is McpTextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/** The image blocks, for a caller that wants the picture rather than the prose. */
export function resultImages(result: McpToolResult): McpImageContent[] {
  return result.content.filter((block): block is McpImageContent => block.type === 'image')
}

/**
 * Where an MCP client looks for an OAuth challenge inside a tool result.
 *
 * The `mcp/` namespace is the protocol's own reserved prefix, and the value is
 * a list of complete `WWW-Authenticate` header values — the same strings the
 * HTTP header carries, because they are the same challenge said twice rather
 * than two formats.
 *
 * It exists because of the order a mixed-authentication client works in.
 * Discovery here is anonymous, so a client connects, lists tools, and only then
 * discovers — from the tool's own `securitySchemes` — that a call needs a
 * token. When such a call arrives without one, the transport answers `401` with
 * the challenge in the header, which is what the specification requires and
 * what an SDK client acts on. Some clients, ChatGPT's among them, read the
 * challenge out of the *result* instead; OpenAI's own reference server for
 * mixed auth publishes it exactly here. Carrying both costs one field and means
 * neither kind of client is left with an error it cannot act on.
 */
export const MCP_WWW_AUTHENTICATE_META = 'mcp/www_authenticate'

/**
 * A refusal that is also an invitation: this call needs a credential, and here
 * is where to get one.
 *
 * Shaped like every other refusal — `isError`, the code in `structuredContent`,
 * the readable half in the text block — so a client that has never heard of
 * OAuth still gets a Slaids error it can print, and one that has finds the
 * challenge where it looks for it.
 */
export function challengedToolResult(error: ApiError, challenge: string): McpToolResult {
  return {
    isError: true,
    content: text(errorText(error)),
    structuredContent: { error: error as unknown as Record<string, unknown> },
    _meta: { [MCP_WWW_AUTHENTICATE_META]: [challenge] },
  }
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
    // Text first, then the picture. The text is what says which page this is,
    // how big the image is and whether the web fonts had arrived — and a
    // caveat about the glyphs is worth having read before looking at them.
    content: [
      ...text(JSON.stringify(data, null, 2)),
      ...(outcome.image
        ? [
            {
              type: 'image' as const,
              data: encodeBase64(outcome.image.bytes),
              mimeType: outcome.image.mimeType,
            },
          ]
        : []),
    ],
    // Every operation answers with an object today, and the guard is here for
    // the day one does not: a non-object in `structuredContent` is a response
    // a strict client rejects outright, which would lose the text block too.
    //
    // The picture is not in here. `structuredContent` is JSON a client may log,
    // diff or hand to a non-multimodal model, and `data` already describes the
    // image — media type, pixel size, byte count — so the bytes would be a
    // second copy of the one thing that does not belong in a log.
    ...(isPlainObject(data) ? { structuredContent: data } : {}),
    ...(outcome.revision ? { _meta: { 'slaids/revision': outcome.revision } } : {}),
  }
}
