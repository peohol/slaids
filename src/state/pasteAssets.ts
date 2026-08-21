/**
 * Preparing clipboard content for a *different* presentation.
 *
 * Assets belong to the presentation that owns them and are deleted with it, so
 * pasting an image into another presentation must copy the file under a new id
 * rather than share (and silently steal) the original.
 */

import { contentAssetIds } from '../domain/content'
import { remapContentAssetIds } from '../domain/docs'
import { newAssetId } from '../domain/ids'
import { cloneContentWithNewIds } from '../domain/layout'
import { repository } from '../persistence/dexieRepository'
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
