/**
 * Does this presentation already have these bytes?
 *
 * The same photograph dropped into a deck twice used to be stored twice, under
 * two ids, and counted twice against the deck's size. It is one file, and the
 * way to know that is its bytes — never its name, which the second upload may
 * well have changed. So every door into the asset store asks here before it
 * writes, and reuses the file it finds.
 *
 * Cheap on purpose. A file that is a copy of another is exactly as long as it,
 * and served under the same type, so only the references that match on both
 * are worth hashing — and of those, only the ones nobody has hashed before cost
 * a read. The answer is recorded on the reference (`AssetRef.contentHash`) by
 * whoever stores it, so a deck fills in its hashes as it is used.
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
  /** The reference already in the presentation, carrying the same bytes. */
  ref: AssetRef
  /** The hash both files share. */
  hash: string
}

/**
 * The reference that already holds these bytes, or `null` when none does.
 *
 * A candidate whose bytes cannot be read is skipped rather than trusted: it may
 * be the same file, but "may be" is not what a caller about to *not* store a
 * file needs to hear. Storing a copy is the safe mistake.
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
    if (candidate.contentHash) {
      if (candidate.contentHash === hash) return { ref: candidate, hash }
      continue
    }
    let stored
    try {
      stored = await repository.getAsset(candidate.id)
    } catch {
      continue
    }
    if (!stored) continue
    if ((await hashBytes(await blobToBytes(stored.blob))) === hash) return { ref: candidate, hash }
  }
  return null
}
