/**
 * A picture in an operation's answer, and the one way a transport finds it.
 *
 * Every other operation answers with an object that is already JSON. A rendered
 * preview cannot: the useful part of it is a few hundred kilobytes of pixels,
 * and there is exactly one sensible representation of those in memory — bytes.
 * So the operation puts an `AgentImage` in its result and each transport
 * serialises it the way its own protocol says pictures travel:
 *
 *  - REST answers the bytes as the response body, with the picture's own media
 *    type, and the structured half on request (`Accept: application/json`);
 *  - MCP answers an `ImageContent` block, which is base64 plus a media type,
 *    because that is the block a client hands a multimodal model.
 *
 * What keeps those two from becoming two contracts is `detachImage`. Both
 * transports call it — through `performOperation`, which is the one function
 * they share — so "there is a picture in this answer, and here is the
 * JSON-safe description of it" is decided once, in the same place, for both.
 *
 * The descriptor left behind is deliberately not the bytes in another coat. It
 * says what the picture *is* — media type, pixel size, byte count — so an agent
 * reading only `structuredContent`, or only a REST envelope, still knows what it
 * was handed and can decide whether to ask for it smaller.
 */

import { encodeBase64 } from './binary'

const AGENT_IMAGE_KIND = 'agent-image'

export interface AgentImage {
  readonly kind: typeof AGENT_IMAGE_KIND
  /** `image/png`. A media type rather than a format name: transports send this. */
  mimeType: string
  bytes: Uint8Array
  width: number
  height: number
}

/** The JSON-safe half: what the picture is, without the picture. */
export interface AgentImageDescriptor {
  mimeType: string
  width: number
  height: number
  byteLength: number
}

export function agentImage(input: {
  mimeType: string
  bytes: Uint8Array
  width: number
  height: number
}): AgentImage {
  return { kind: AGENT_IMAGE_KIND, ...input }
}

export function isAgentImage(value: unknown): value is AgentImage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === AGENT_IMAGE_KIND &&
    (value as { bytes?: unknown }).bytes instanceof Uint8Array
  )
}

export function describeAgentImage(image: AgentImage): AgentImageDescriptor {
  return {
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    byteLength: image.bytes.byteLength,
  }
}

export interface DetachedAnswer {
  /** The answer with the picture replaced by a description of it. JSON-safe. */
  json: unknown
  image: AgentImage | null
  /** Which field held it, so a transport that wants it back knows where. */
  field: string | null
}

/**
 * The answer split into what JSON can carry and what it cannot.
 *
 * Only the result's own fields are looked at, one level down, and at most one
 * picture is found. That is a limit rather than an oversight: a deep search
 * would make "where is the picture in this answer" a question about the shape of
 * every operation's output, and an answer carrying several would need a
 * transport rule for which one an MCP image block gets. One field, named by the
 * operation, is a contract both transports can implement without a table.
 *
 * An answer with no picture in it comes back untouched, which is what lets both
 * transports call this unconditionally.
 */
export function detachImage(value: unknown): DetachedAnswer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { json: value, image: null, field: null }
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const found = entries.find(([, field]) => isAgentImage(field))
  if (!found) return { json: value, image: null, field: null }

  const image = found[1] as AgentImage
  return {
    json: { ...(value as Record<string, unknown>), [found[0]]: describeAgentImage(image) },
    image,
    field: found[0],
  }
}

/**
 * The picture put back, base64-encoded, for a caller that asked for one JSON
 * body instead of the bytes.
 *
 * The descriptor stays and gains a `base64` field rather than being replaced by
 * the string: the size and the media type are what an agent needs to decide
 * whether to look at it at all, and losing them to save a line would make the
 * JSON representation strictly worse than the binary one.
 */
export function attachEncodedImage(json: unknown, field: string, image: AgentImage): unknown {
  if (typeof json !== 'object' || json === null) return json
  return {
    ...(json as Record<string, unknown>),
    [field]: { ...describeAgentImage(image), base64: encodeBase64(image.bytes) },
  }
}
