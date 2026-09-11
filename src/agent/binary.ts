/**
 * File contents, in whatever shape the transport has them in.
 *
 * An MCP tool call arrives as JSON and can only carry base64; a REST upload
 * arrives as bytes; an in-process caller already holds a `Blob`. All three mean
 * the same thing, so the operations take a tagged union and normalise it here
 * once, instead of every operation growing three code paths.
 */

import { z } from 'zod'
import { err, ok, type Result } from '../domain/result'
import { blobToBytes } from '../persistence/blob'

export type AgentFileContent =
  | { encoding: 'base64'; data: string }
  | { encoding: 'bytes'; data: Uint8Array }
  | { encoding: 'blob'; data: Blob }
  | { encoding: 'text'; data: string }

/**
 * What a JSON transport can carry, and therefore what may be published as the
 * operation's schema: a string, either base64 or plain text.
 *
 * This is the *contract*. `fileContentSchema` below is what the in-process
 * function accepts, which is a superset — and the two are deliberately separate
 * values rather than one schema with unrepresentable branches, because a tool
 * definition that advertises `Blob` is advertising something no caller on the
 * other side of a wire can send.
 */
/**
 * The field's shape, spelled out for whoever reads the description.
 *
 * A tagged object is not what "base64, or a data URL" sounds like, and the
 * mistake it invites is the one an agent makes first: `content: "iVBORw0…"`,
 * which is a plain string where the schema wants `{ encoding, data }`. The
 * JSON Schema says so correctly, but a model reads the sentence too — and the
 * sentence used to describe the *payload* while the schema described the
 * *envelope*. So the envelope is named here, once, and both operations that
 * take a file say it.
 */
export const FILE_CONTENT_SHAPE =
  'Feltet er et objekt, ikke en streng: {"encoding":"base64","data":"iVBORw0KGgo…"} for binære filer, ' +
  'eller {"encoding":"text","data":"<svg …>"} for tekst. En data-URL er også gyldig som «data».'

export const transportFileContentSchema = z.union([
  z.object({
    encoding: z.literal('base64'),
    data: z.string().describe('Filens bytes som base64, eventuelt som en data-URL.'),
  }),
  z.object({
    encoding: z.literal('text'),
    data: z.string().describe('Filen som tekst. Bare for tekstformater, i praksis SVG.'),
  }),
])

/**
 * What the in-process function accepts.
 *
 * The two extra variants exist for callers that share memory with Agent Core —
 * a REST layer that has already read a multipart body into bytes, the editor,
 * a test — and they are checked by identity because there is nothing else to
 * check. A transport never sees them: it maps its own binary form to `bytes`
 * before calling in.
 */
export const fileContentSchema: z.ZodType<AgentFileContent> = z.union([
  transportFileContentSchema,
  z.object({ encoding: z.literal('bytes'), data: z.instanceof(Uint8Array) }),
  z.object({ encoding: z.literal('blob'), data: z.instanceof(Blob) }),
])

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** The bytes a caller sent, whichever way they sent them. */
export async function readFileContent(content: AgentFileContent): Promise<Result<Uint8Array>> {
  switch (content.encoding) {
    case 'bytes':
      return ok(content.data)
    case 'text':
      return ok(new TextEncoder().encode(content.data))
    case 'blob':
      return ok(await blobToBytes(content.data))
    case 'base64':
      return decodeBase64(content.data)
  }
}

function decodeBase64(raw: string): Result<Uint8Array> {
  // Data URLs are a common way for an agent to hold a picture, so the prefix is
  // stripped rather than treated as content.
  const payload = raw.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!BASE64.test(payload)) return err('INVALID_ARGUMENT', 'Innholdet er ikke gyldig base64.')

  try {
    if (typeof globalThis.atob === 'function') {
      const binary = globalThis.atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return ok(bytes)
    }
    // Node without `atob` (and any runtime that only has Buffer).
    const buffer = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } })
      .Buffer
    if (buffer) return ok(new Uint8Array(buffer.from(payload, 'base64')))
  } catch {
    return err('INVALID_ARGUMENT', 'Innholdet er ikke gyldig base64.')
  }
  return err('INVALID_ARGUMENT', 'Kjøremiljøet kan ikke dekode base64.')
}

/**
 * Bytes as base64, the other direction.
 *
 * The same two runtimes as `decodeBase64` and for the same reason: a browser
 * has `btoa`, a Node build may only have `Buffer`. It is here rather than in the
 * transport because both transports need it for the same value — a rendered
 * preview is bytes in Agent Core, base64 in an MCP image block and base64 in a
 * REST envelope a caller asked for as JSON — and two encoders would be two
 * chances to differ about padding.
 */
export function encodeBase64(bytes: Uint8Array): string {
  const buffer = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } } })
    .Buffer
  if (buffer) return buffer.from(bytes).toString('base64')
  if (typeof globalThis.btoa === 'function') {
    // In chunks: `String.fromCharCode(...bytes)` on a megabyte of pixels
    // overflows the argument limit, which is a crash rather than a slow path.
    let binary = ''
    const CHUNK = 0x8000
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
    }
    return globalThis.btoa(binary)
  }
  throw new Error('Kjøremiljøet kan ikke kode base64.')
}
