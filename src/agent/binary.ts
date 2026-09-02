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
 * Validation for the union above.
 *
 * Only the base64 and text variants survive a JSON transport; the other two
 * exist for callers that share memory with us, and are checked by identity.
 */
export const fileContentSchema: z.ZodType<AgentFileContent> = z.union([
  z.object({ encoding: z.literal('base64'), data: z.string() }),
  z.object({ encoding: z.literal('text'), data: z.string() }),
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
