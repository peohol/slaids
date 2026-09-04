/**
 * Asset metadata commands. Binary data never enters the presentation JSON; it
 * lives in the asset store and is referenced by id.
 */

import { allContent, slideContent } from '../docs'
import { contentAssetIds, contentDocs, imagePanelOf } from '../content'
import { touch } from '../presentation'
import { collectDocAssetIds } from '../richdoc'
import { err, ok, type Result } from '../result'
import type { AssetRef, Presentation, Slide, ZoneContent } from '../types'

export function registerAsset(presentation: Presentation, asset: AssetRef): Result<Presentation> {
  const existing = presentation.assets.findIndex((entry) => entry.id === asset.id)
  const assets = [...presentation.assets]
  if (existing >= 0) assets[existing] = asset
  else assets.push(asset)
  return ok(touch({ ...presentation, assets }))
}

/** Whether this presentation holds the file with that id. */
export function hasAsset(presentation: Presentation, assetId: string): boolean {
  return presentation.assets.some((asset) => asset.id === assetId)
}

/**
 * Which of these ids the presentation does not hold.
 *
 * The mirror of `unknownReferenceIds`, and used by every write that can point
 * at a file: a zone or a paragraph referencing a file that is not in the
 * presentation renders a hole, so it is refused at the door rather than found
 * later by `validate_presentation`. Assets belong to one presentation, so this
 * is also what stops a caller from naming a file that belongs to another one.
 */
export function unknownAssetIds(
  presentation: Presentation,
  ids: readonly string[],
): string[] {
  return [...new Set(ids)].filter((id) => !hasAsset(presentation, id))
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

/**
 * How many times, and in what way, one file is shown.
 *
 * There are two ways to show a picture and two places to show it in, and the
 * four answers call for four different next moves: a zone whose *content* is
 * the file is emptied with `clear_zone`, a picture sitting inline in a
 * paragraph is removed by rewriting that text, and either of those can be
 * parked in the sandbox instead of standing on a slide — where the fix is to
 * throw the sandbox item away. So a refusal that only said "in use" would be
 * true and useless, and this is what makes it actionable.
 *
 * Counts, never locations. `delete_asset` is an `assets:write` operation (see
 * `src/agent/operations/assets.ts`), and naming the slides and zones would hand
 * a token that may only store files a map of a deck it may not read. A caller
 * that holds `presentations:read` finds them with `list_assets` and
 * `inspect_slide`; one that does not, may not.
 */
export interface AssetUsageCounts {
  /** The file *is* the zone's content. */
  zoneContent: number
  /** The file sits inline inside a rich-text document. */
  inlineText: number
}

export interface AssetUsageSummary {
  /** Every occurrence, wherever it is. Zero means the file can be deleted. */
  total: number
  slides: AssetUsageCounts
  sandbox: AssetUsageCounts
}

function countUses(contents: readonly ZoneContent[], assetId: string): AssetUsageCounts {
  let zoneContent = 0
  let inlineText = 0
  for (const content of contents) {
    if (imagePanelOf(content)?.assetId === assetId) zoneContent += 1
    for (const doc of contentDocs(content)) {
      inlineText += collectDocAssetIds(doc).filter((id) => id === assetId).length
    }
  }
  return { zoneContent, inlineText }
}

/**
 * Where this file is shown, counted.
 *
 * Built on the same traversals `usedAssetIds` uses, so "is it used?" and "where
 * is it used?" can never disagree — one of them saying no while the other
 * points somewhere is exactly the bug that would let a deletion break a slide.
 */
export function summarizeAssetUsage(
  presentation: Presentation,
  assetId: string,
): AssetUsageSummary {
  const slides = countUses(slideContent(presentation.slides), assetId)
  const sandbox = countUses(
    presentation.sandbox.map((item) => item.content),
    assetId,
  )
  return {
    total: slides.zoneContent + slides.inlineText + sandbox.zoneContent + sandbox.inlineText,
    slides,
    sandbox,
  }
}

/**
 * Drop one file's metadata, refusing while anything still shows it.
 *
 * The refusal is the point: removing an `AssetRef` a zone or a paragraph points
 * at would leave the document referencing a file that is not in it — a slide
 * that renders a hole, and an issue `validate_presentation` would report about
 * a deck nobody edited. So the file is only ever removed once the deck itself
 * says nothing shows it, which is what makes deleting the bytes afterwards safe.
 */
export function removeAsset(presentation: Presentation, assetId: string): Result<Presentation> {
  if (!hasAsset(presentation, assetId)) {
    return err('ASSET_NOT_FOUND', 'Fant ikke filen.', { assetId })
  }
  const usage = summarizeAssetUsage(presentation, assetId)
  if (usage.total > 0) {
    return err(
      'ASSET_IN_USE',
      'Filen vises i dekket og kan ikke slettes. Fjern den fra innholdet først.',
      { assetId, usage },
    )
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
