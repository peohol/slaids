/**
 * Preparing clipboard content for a *different* presentation.
 *
 * Assets belong to the presentation that owns them and are deleted with it, so
 * pasting an image into another presentation must copy the file under a new id
 * rather than share (and silently steal) the original.
 *
 * This is an *internal* copy and deliberately does not go through
 * `domain/assetIngress.ts`. The clipboard payload names asset ids; the bytes
 * come from Slaids' own store, which means they already came through that door
 * once — as an editor upload, an agent call or a `.slaids` import. Re-running
 * the sanitiser here would validate a file against today's rules instead of the
 * rules it was stored under, so a figure that has been in a deck for a year
 * could stop being copyable for a reason its owner cannot act on. Foreign text
 * on the clipboard cannot get here at all: it fails payload validation, and a
 * payload never carries bytes.
 */

import { contentAssetIds } from '../domain/content'
import { remapContentAssetIds } from '../domain/docs'
import { newAssetId } from '../domain/ids'
import { cloneContentWithNewIds } from '../domain/layout'
import { repository } from '../persistence/activeRepository'
import type { AssetRef, Presentation, ZoneContent } from '../domain/types'

export interface PreparedClipboardContent {
  content: ZoneContent
  /** Asset metadata that must be registered on the target presentation. */
  refs: AssetRef[]
  /**
   * Assets the payload names but whose bytes are gone — the source presentation
   * was deleted, or the copy came from another browser. Their references are
   * left pointing at the original id rather than at a new id with nothing
   * behind it, and the caller is expected to say so.
   */
  missing: AssetRef[]
}

export async function materializeClipboardContent(
  payload: { content: ZoneContent; assets: AssetRef[] },
  target: Presentation,
): Promise<PreparedClipboardContent> {
  const content = cloneContentWithNewIds(payload.content)
  const referenced = [...new Set(contentAssetIds(content))]
  const owned = new Set(target.assets.map((asset) => asset.id))

  const map = new Map<string, string>()
  const refs: AssetRef[] = []
  const missing: AssetRef[] = []

  for (const assetId of referenced) {
    if (owned.has(assetId)) continue
    const stored = await repository.getAsset(assetId)
    if (!stored) {
      // Metadata without bytes cannot be copied. Minting a new id for it would
      // register an asset this presentation claims to own and can never show,
      // and export and duplication would carry the lie forward.
      const known = payload.assets.find((asset) => asset.id === assetId)
      if (known) missing.push(known)
      continue
    }

    const copyId = newAssetId()
    map.set(assetId, copyId)
    const ref: AssetRef = { ...stored.ref, id: copyId }
    refs.push(ref)
    await repository.putAsset(target.id, ref, stored.blob)
  }

  return { content: map.size > 0 ? remapContentAssetIds(content, map) : content, refs, missing }
}
