/**
 * Turning an HTTP request into Agent Core input.
 *
 * This is the whole of §44's "Transport av rasterassets" on the REST side. Agent
 * Core works with bytes; only a JSON request is forced to describe bytes as
 * base64, which is why the published JSON Schema mentions base64 and text and
 * nothing else. A REST upload does not have that problem, so it does not have
 * that limitation: it sends the file as a file, and this file converts it.
 *
 * Three request shapes, one result:
 *
 *  - `application/json` — the body *is* the input.
 *  - `multipart/form-data` — text parts become fields, the one file part becomes
 *    `content`, and its filename is the fallback for `name`.
 *  - anything else — the body is the file, and the fields come from the query
 *    string. This is the shape `curl --data-binary` produces, which is what an
 *    agent already has when it holds a picture.
 *
 * Nothing here knows which operation asked for which field. The parsed object
 * goes to the operation's own Zod schema, which is strict, so a request that
 * carries `content` to an operation that has no such field is rejected there —
 * by the contract, not by a list of operation names kept in the transport.
 */

import type { ApiError } from './protocol'

export type BodyResult = { ok: true; input: unknown } | { ok: false; error: ApiError }

/** The largest body the API will read at all. See `config.ts` for why. */
export interface BodyLimits {
  maxRequestBytes: number
}

const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json$/i
const MULTIPART_TYPE = /^multipart\/form-data\b/i

function mediaType(header: string | null): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

/**
 * Read the body, refusing one that is too big.
 *
 * `Content-Length` is checked first so an oversized upload is refused before it
 * is buffered, and the actual length is checked after so a missing or lying
 * header changes nothing. The platform in front of this has its own, usually
 * smaller, limit; this one exists so the answer is a Slaids error an agent can
 * read rather than whatever the platform emits.
 */
export async function readBody(request: Request, limits: BodyLimits): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; error: ApiError }
> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limits.maxRequestBytes) {
    return { ok: false, error: tooLarge(declared, limits.maxRequestBytes) }
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await request.arrayBuffer())
  } catch {
    return {
      ok: false,
      error: { code: 'MALFORMED_BODY', message: 'Kunne ikke lese forespørselens innhold.' },
    }
  }

  if (bytes.byteLength > limits.maxRequestBytes) {
    return { ok: false, error: tooLarge(bytes.byteLength, limits.maxRequestBytes) }
  }
  return { ok: true, bytes }
}

function tooLarge(byteSize: number, limit: number): ApiError {
  return {
    code: 'REQUEST_TOO_LARGE',
    message: `Forespørselen er større enn grensen på ${limit} byte.`,
    details: { byteSize, maxRequestBytes: limit },
  }
}

/**
 * Agent Core input from a request that has already been read.
 *
 * `url` carries the query string, which is where a raw binary upload puts the
 * fields that cannot be in a body that is entirely file.
 */
export async function parseOperationInput(
  contentType: string | null,
  bytes: Uint8Array,
  url: URL,
): Promise<BodyResult> {
  const type = mediaType(contentType)

  if (bytes.byteLength === 0 && (type === '' || JSON_TYPE.test(type))) {
    // No body at all is the empty object, which is exactly what an operation
    // without arguments wants to receive.
    return { ok: true, input: {} }
  }

  if (JSON_TYPE.test(type)) return parseJson(bytes)
  if (MULTIPART_TYPE.test(type)) return parseMultipart(contentType ?? '', bytes)
  if (type === 'application/x-www-form-urlencoded') {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_CONTENT_TYPE',
        message:
          'Skjemakodet innhold støttes ikke. Bruk application/json, multipart/form-data, eller send filen som ren binær med feltene i query-strengen.',
        details: { contentType: type },
      },
    }
  }
  return { ok: true, input: { ...queryFields(url), content: { encoding: 'bytes', data: bytes } } }
}

function parseJson(bytes: Uint8Array): BodyResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return { ok: false, error: { code: 'MALFORMED_BODY', message: 'Forespørselen er ikke gyldig JSON.' } }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: { code: 'MALFORMED_BODY', message: 'JSON-innholdet må være et objekt med operasjonens felter.' },
    }
  }
  return { ok: true, input: parsed }
}

/**
 * Multipart, parsed by the platform rather than by hand.
 *
 * The bytes are wrapped back into a `Response` so the runtime's own multipart
 * parser does the work: a hand-written one is a parser for a format with more
 * edge cases than it looks, and getting it subtly wrong is how a filename
 * becomes a path.
 *
 * Exactly one file part is allowed. Two would mean the request has said two
 * different things about which file to store, and picking one of them is a
 * guess — so it is refused instead.
 */
async function parseMultipart(contentType: string, bytes: Uint8Array): Promise<BodyResult> {
  let form: FormData
  try {
    form = await new Response(bytes.slice().buffer as ArrayBuffer, {
      headers: { 'Content-Type': contentType },
    }).formData()
  } catch {
    return {
      ok: false,
      error: { code: 'MALFORMED_BODY', message: 'Kunne ikke lese multipart-innholdet.' },
    }
  }

  const fields: Record<string, unknown> = {}
  let file: { bytes: Uint8Array; fileName: string } | null = null

  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      fields[key] = value
      continue
    }
    if (file) {
      return {
        ok: false,
        error: {
          code: 'MALFORMED_BODY',
          message: 'Forespørselen har mer enn én fil. Last opp én fil om gangen.',
        },
      }
    }
    file = {
      bytes: new Uint8Array(await value.arrayBuffer()),
      fileName: typeof value.name === 'string' ? value.name : '',
    }
  }

  if (!file) return { ok: true, input: fields }
  return {
    ok: true,
    input: {
      // A filename is a convenience, not an authority: an explicit `name` field
      // always wins, and the operation's schema is what decides whether either
      // is acceptable.
      ...(file.fileName ? { name: file.fileName } : {}),
      ...fields,
      content: { encoding: 'bytes', data: file.bytes },
    },
  }
}

/**
 * Query-string fields for a raw binary upload.
 *
 * Only strings, and only the last value when a key repeats — the same thing a
 * form field would have produced. Everything is handed to the operation's
 * schema unchanged; nothing here coerces a string into a number or a boolean,
 * because a transport that guesses types is a second grammar next to the one
 * the contract publishes.
 */
function queryFields(url: URL): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) fields[key] = value
  return fields
}
