/**
 * A short, deterministic digest of a value.
 *
 * Two things in the domain need «the same input produces the same short
 * string»: a presentation's revision (`revision.ts`) and a plan entry's stable
 * identity (`imagePlan.ts`). They ask it of different values, but they must not
 * ask it with two different hashes — a second implementation is a second set of
 * collision properties and a second normalisation of the same JSON, and the
 * first divergence would show up as an id that changes for no reason.
 *
 * Not a cryptographic hash, and not load-bearing as one. What it has to be is
 * stable across the three runtimes the document travels through — the browser,
 * the worker and the Node process behind the agent API — which is why it is
 * plain arithmetic rather than WebCrypto: `assetHash.ts` needs the real thing
 * and can afford to be async, and neither caller here can.
 */

/**
 * A 64-bit digest, as hex.
 *
 * Two independent lanes — FNV-1a and djb2 — so a collision would have to fool
 * both. For a revision a collision means one stale write slips past a
 * precondition, which is why the width is not 32 bits.
 */
class Digest {
  private fnv = 0x811c9dc5
  private djb = 5381

  update(text: string): void {
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i)
      this.fnv = Math.imul(this.fnv ^ code, 0x01000193)
      this.djb = Math.imul(this.djb, 33) ^ code
    }
  }

  toHex(): string {
    return (
      (this.fnv >>> 0).toString(16).padStart(8, '0') +
      (this.djb >>> 0).toString(16).padStart(8, '0')
    )
  }
}

/**
 * Feed a value to the digest as the document that will be *stored*.
 *
 * Two deliberate normalisations, both of them things storage does anyway:
 *
 *  - **Key order is ignored.** A JSONB column can hand the same document back
 *    with its keys in a different order than IndexedDB did. That is not a new
 *    revision.
 *  - **`undefined` is treated the way JSON treats it** — dropped from an
 *    object, `null` inside an array. Every repository writes the document
 *    through `JSON.parse(JSON.stringify(…))`, so a field explicitly set to
 *    `undefined` in memory is simply absent once stored. Without this, a
 *    mutation would answer with a revision that the very next read disagreed
 *    with, and the chain of mutations §44 describes would break on the first
 *    optional field somebody assigned `undefined` to.
 *
 * Everything else is part of the identity, so types and boundaries are written
 * out explicitly: `{ a: 1 }` and `{ a: '1' }` differ, and so do `['a', 'b']`
 * and `['ab']`.
 */
function feed(digest: Digest, value: unknown): void {
  if (value === null || value === undefined) {
    digest.update('null')
    return
  }
  if (Array.isArray(value)) {
    digest.update('[')
    for (const item of value) {
      feed(digest, item)
      digest.update(',')
    }
    digest.update(']')
    return
  }
  if (typeof value === 'object') {
    digest.update('{')
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item === undefined) continue
      digest.update(JSON.stringify(key))
      digest.update(':')
      feed(digest, item)
      digest.update(',')
    }
    digest.update('}')
    return
  }
  digest.update(JSON.stringify(value) ?? 'null')
}

/** The digest of a value, as 16 hex characters. */
export function stableDigest(value: unknown): string {
  const digest = new Digest()
  feed(digest, value)
  return digest.toHex()
}
