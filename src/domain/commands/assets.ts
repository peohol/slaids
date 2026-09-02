/**
 * Asset metadata commands. Binary data never enters the presentation JSON; it
 * lives in the asset store and is referenced by id.
 */

import { allContent, slideContent } from '../docs'
import { contentAssetIds } from '../content'
import { touch } from '../presentation'
import { err, ok, type Result } from '../result'
import type { AssetRef, Presentation, Slide, ZoneContent } from '../types'

export function registerAsset(presentation: Presentation, asset: AssetRef): Result<Presentation> {
  const existing = presentation.assets.findIndex((entry) => entry.id === asset.id)
  const assets = [...presentation.assets]
  if (existing >= 0) assets[existing] = asset
  else assets.push(asset)
  return ok(touch({ ...presentation, assets }))
}

/**
 * Asset ids referenced from these slides. The sandbox is not consulted, which
 * is what a publishable snapshot needs: a picture parked in the sandbox is not
 * on any slide and has no business leaving the private document.
 */
export function slideAssetIds(slides: readonly Slide[]): Set<string> {
  return collectAssetIds(slideContent(slides))
}

/** Asset ids actually referenced from slides or the sandbox. */
export function usedAssetIds(presentation: Presentation): Set<string> {
  return collectAssetIds(allContent(presentation))
}

function collectAssetIds(contents: readonly ZoneContent[]): Set<string> {
  const ids = new Set<string>()
  for (const content of contents) {
    for (const id of contentAssetIds(content)) ids.add(id)
  }
  return ids
}

export function unusedAssets(presentation: Presentation): AssetRef[] {
  const used = usedAssetIds(presentation)
  return presentation.assets.filter((asset) => !used.has(asset.id))
}

export function removeAsset(presentation: Presentation, assetId: string): Result<Presentation> {
  if (!presentation.assets.some((asset) => asset.id === assetId)) {
    return err('ASSET_NOT_FOUND', 'Fant ikke filen.')
  }
  if (usedAssetIds(presentation).has(assetId)) {
    return err('INVALID_ARGUMENT', 'Filen er i bruk og kan ikke slettes.')
  }
  return ok(
    touch({ ...presentation, assets: presentation.assets.filter((asset) => asset.id !== assetId) }),
  )
}

/** Drop metadata for assets nothing references any more. */
export function pruneAssets(presentation: Presentation): {
  presentation: Presentation
  removed: AssetRef[]
} {
  const removed = unusedAssets(presentation)
  if (removed.length === 0) return { presentation, removed: [] }
  const removedIds = new Set(removed.map((asset) => asset.id))
  return {
    presentation: touch({
      ...presentation,
      assets: presentation.assets.filter((asset) => !removedIds.has(asset.id)),
    }),
    removed,
  }
}
