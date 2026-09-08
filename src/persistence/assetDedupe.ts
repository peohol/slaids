/**
 * Does this presentation already have these bytes?
 *
 * The same photograph dropped into a deck twice used to be stored twice, under
 * two ids, and counted twice against the deck's size. It is one file, and the
 * way to know that is its bytes — never its name, which the second upload may
 * well have changed. So every door into the asset store asks here before it
 * writes, and reuses the file it finds.
 *
 * **Identity is the stored bytes, and only the stored bytes.** A reference
 * carries `contentHash`, but the reference lives in the document and the bytes
 * live in the store, and nothing ties the two together hard enough to let one
 * stand in for the other: a blob replaced or damaged under an unchanged
 * reference would otherwise make two different files "identical", and the
 * price of that mistake is a picture that is never stored, or one that is
 * merged away and deleted. So a recorded hash is only ever used in the safe
 * direction — a hash that *differs* rules a candidate out without a read, and
 * the worst a stale one can do there is let a copy be stored — while a match is
 * never taken on the reference's word: the candidate's bytes are read and
 * compared, byte for byte, before it is answered.
 *
 * Cheap where it can be. A copy is exactly as long as its original and served
 * under the same type, so only the references that match on both are
 * candidates at all, and of those, a recorded hash that disagrees costs no
 * read. The hash of the incoming file is recorded on its reference by whoever
 * stores it, so a deck fills in its hashes as it is used.
 *
 * Within one presentation only. Files belong to the presentation that owns them
 * and are deleted with it, so a file shared *between* presentations would be
 * one deletion away from a hole in the other deck. Two decks holding the same
 * bytes hold two files, by design.
 */

import { hashBytes } from '../domain/assetHash'
import type { AssetRef, Presentation } from '../domain/types'
import { blobToBytes } from './blob'
import type { SlaidsRepository } from './repository'

export interface IncomingFile {
  /** Exactly the bytes that would be stored. */
  bytes: Uint8Array
  /** The type they would be stored under. */
  mimeType: string
  /** Their hash, when the caller has it already; computed otherwise. */
  hash?: string
}

export interface IdenticalAsset {
  /** The reference already in the presentation, whose stored bytes are these bytes. */
  ref: AssetRef
  /** The hash of those bytes, for the caller to record. */
  hash: string
}

/**
 * The reference whose stored bytes are exactly these, or `null` when none is.
 *
 * A candidate whose bytes cannot be read is skipped rather than trusted: it may
 * be the same file, but "may be" is not what a caller about to *not* store a
 * file needs to hear. Storing a copy is the safe mistake, and it is the only
 * mistake this function can make.
 */
export async function findIdenticalAsset(
  repository: SlaidsRepository,
  presentation: Presentation,
  incoming: IncomingFile,
): Promise<IdenticalAsset | null> {
  const candidates = presentation.assets.filter(
    (asset) => asset.byteSize === incoming.bytes.byteLength && asset.mimeType === incoming.mimeType,
  )
  if (candidates.length === 0) return null

  const hash = incoming.hash ?? (await hashBytes(incoming.bytes))
  for (const candidate of candidates) {
    // The one thing a recorded hash may decide: that this is *not* the file.
    if (candidate.contentHash && candidate.contentHash !== hash) continue
    let stored
    try {
      stored = await repository.getAsset(candidate.id)
    } catch {
      continue
    }
    if (!stored) continue
    // The bytes themselves, never the reference's account of them.
    if (bytesEqual(await blobToBytes(stored.blob), incoming.bytes)) return { ref: candidate, hash }
  }
  return null
}

/** Whether two byte sequences are the same, byte for byte. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false
  return true
}
