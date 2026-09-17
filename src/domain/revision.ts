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
 * describes. The digest itself is `domain/digest.ts`, shared with the one other
 * thing in the domain that needs a stable short name for a value.
 */

import { stableDigest } from './digest'
import type { Presentation } from './types'

export function presentationRevision(presentation: Presentation): string {
  return stableDigest(presentation)
}
