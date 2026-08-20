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

  for (const assetId of referenced) {
    if (owned.has(assetId)) continue
    const stored = await repository.getAsset(assetId)
    const sourceRef = stored?.ref ?? payload.assets.find((asset) => asset.id === assetId)
    if (!sourceRef) continue

    const copyId = newAssetId()
    map.set(assetId, copyId)
    const ref: AssetRef = { ...sourceRef, id: copyId }
    refs.push(ref)
    if (stored) await repository.putAsset(target.id, ref, stored.blob)
  }

  return { content: map.size > 0 ? remapContentAssetIds(content, map) : content, refs }
}
