/**
 * The revision of a stored presentation.
 *
 * A revision is a short digest of the document itself: two reads that produce
 * the same bytes produce the same revision, and any commit produces a different
 * one. It exists so a caller that read a presentation can say *which* reading it
 * acted on — see `IMPLEMENTATION_PLAN.md` §44, "Samtidighet".
 *
 * It does **not** replace the optimistic lock in the repository layer, and is
 * not a second one beside it. They guard two different windows:
 *
 *  - the repository's own guard covers the moment between loading a document
 *    and writing it back, inside a single operation. That is the one that keeps
 *    a concurrent writer from being overwritten, and it is still the only thing
 *    that decides whether a write lands. A revision is what identifies the
 *    reading it is bound to: Supabase looks up the database version that
 *    reading came from, and Dexie compares the stored document directly.
 *  - a revision covers the much longer window between a caller *reading* a
 *    presentation and *deciding* what to do with it. A headless caller can
 *    inspect a slide, think, and come back a minute later; the document it
 *    reasoned about may be gone by then, and no write-time guard can see that,
 *    because the write itself is derived from a perfectly fresh read.
 *
 * So an operation that is handed an expected revision compares it against the
 * document it just loaded and refuses before running any command. The write
 * that follows is still guarded by the repository, exactly as before.
 *
 * Derived from the document rather than from a stored counter on purpose: it is
 * then the same value in Supabase mode and in local Dexie mode, where there is
 * no version column at all, and it cannot drift away from the content it
 * describes.
 */

import type { Presentation } from './types'

/**
 * A 64-bit digest over the document, as hex.
 *
 * Two independent lanes — FNV-1a and djb2 — so a collision would have to fool
 * both. A collision means one stale write slips past the precondition, which is
 * why the width is not 32 bits; it is not a security boundary and does not need
 * to be a cryptographic hash.
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

export function presentationRevision(presentation: Presentation): string {
  const digest = new Digest()
  feed(digest, presentation)
  return digest.toHex()
}
