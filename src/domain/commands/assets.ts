/**
 * Asset metadata commands. Binary data never enters the presentation JSON; it
 * lives in the asset store and is referenced by id.
 */

import {
  allContent,
  makeAssetNodeRewriter,
  mapContentDocs,
  mapPresentationContent,
  remapContentAssetIds,
  slideContent,
} from '../docs'
import {
  CENTRED_FOCUS,
  contentAssetIds,
  contentDocs,
  imagePanelOf,
  withImagePanel,
} from '../content'
import { findLeaf, replaceNode } from '../layout'
import { findContentSlide, touch, withSlide } from '../presentation'
import { remapThemeAssetIds, themeAssetIds, type LogoDeck } from '../logo'
import { collectDocAssetIds } from '../richdoc'
import { err, ok, type Result } from '../result'
import type { AssetRef, Presentation, RichNode, Slide, ZoneContent } from '../types'

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

/**
 * Filene et dekk viser for publikum: det som står på sidene, og temaets logo.
 * Det delte øyeblikksbildet og hver headless side snevres inn med dette.
 */
export function deckAssetIds(deck: LogoDeck): Set<string> {
  const ids = slideAssetIds(deck.slides)
  for (const id of themeAssetIds(deck.theme)) ids.add(id)
  return ids
}

/** Asset ids actually referenced from slides, the sandbox or the theme's logo. */
export function usedAssetIds(presentation: Presentation): Set<string> {
  const ids = collectAssetIds(allContent(presentation))
  for (const id of themeAssetIds(presentation.theme)) ids.add(id)
  return ids
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
  /** 1 når filen er temaets logo. Den fjernes i temaet, ikke i innholdet. */
  theme: number
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
  const theme = themeAssetIds(presentation.theme).filter((id) => id === assetId).length
  return {
    total:
      slides.zoneContent + slides.inlineText + sandbox.zoneContent + sandbox.inlineText + theme,
    slides,
    sandbox,
    theme,
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
      usage.total === usage.theme
        ? 'Filen er logoen i temaet og kan ikke slettes. Fjern logoen i temaet først.'
        : 'Filen vises i dekket og kan ikke slettes. Fjern den fra innholdet først.',
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

/* ------------------------------------------------------------------ *
 * Replacing a file with another
 * ------------------------------------------------------------------ */

/**
 * What it takes to put one file where another was.
 *
 * `to` is registered by this command — it is the file that now exists — and
 * `fromId` stays registered exactly as long as something still shows it. That
 * is what makes the same command serve both halves of the optimiser: replacing
 * a file everywhere (after which the old one is unreferenced and goes), and
 * forking it for one panel (after which both are still shown, and both stay).
 */
export interface AssetReplacementInput {
  /** The file being replaced. */
  fromId: string
  /** The file taking its place. Registered by this command. */
  to: AssetRef
  /**
   * Only the picture panel of this zone. Every use of `fromId` — panels,
   * inline pictures, the sandbox — when absent.
   */
  only?: { slideId: string; nodeId: string }
  /**
   * Centre the crop of every panel that now shows `to`.
   *
   * After a permanent crop the file *is* the frame's shape, so `cover` has
   * nothing left to hide and the stored offset would frame a part of the
   * picture that no longer exists outside the frame. Centred is the one focus
   * that means "show all of it".
   */
  recentre?: boolean
}

/**
 * Show `to` wherever `fromId` was shown — or in one panel only — and keep the
 * document's file list true to what is shown.
 *
 * Three things happen in one commit, because separately they would each leave
 * the document describing files it does not have: the references move, the
 * new file's metadata is registered, and the old file's metadata is dropped if
 * nothing points at it any more. An inline picture also takes the new file's
 * proportions, because `aspect` is documented as the file's own ratio and a
 * downscale rounds it.
 *
 * No fit gate. Swapping the file behind a panel cannot change what fits — the
 * frame is the frame and the caption is untouched — and an inline picture's box
 * moves by the fraction of a pixel a rounded aspect moves it, well inside the
 * tolerance every measurement already allows for.
 */
export function replaceAssetUses(
  presentation: Presentation,
  input: AssetReplacementInput,
): Result<Presentation> {
  const { fromId, to } = input
  if (!hasAsset(presentation, fromId)) {
    return err('ASSET_NOT_FOUND', 'Fant ikke filen som skulle erstattes.', { assetId: fromId })
  }
  if (to.id === fromId) {
    return err('INVALID_ARGUMENT', 'En fil kan ikke erstattes med seg selv.', { assetId: fromId })
  }

  const swapPanel = (content: ZoneContent): ZoneContent => {
    const panel = imagePanelOf(content)
    if (!panel || panel.assetId !== fromId) return content
    return withImagePanel(content, {
      ...panel,
      assetId: to.id,
      focus: input.recentre ? { ...CENTRED_FOCUS } : panel.focus,
    })
  }

  let next: Presentation
  if (input.only) {
    const slide = findContentSlide(presentation, input.only.slideId)
    if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
    const leaf = findLeaf(slide.root, input.only.nodeId)
    if (!leaf?.content) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')
    if (imagePanelOf(leaf.content)?.assetId !== fromId) {
      return err('INVALID_CONTENT', 'Sonen viser ikke den filen.', { assetId: fromId })
    }
    const root = replaceNode(slide.root, leaf.id, { ...leaf, content: swapPanel(leaf.content) })
    next = withSlide(presentation, { ...slide, root })
  } else {
    const aspect = to.width > 0 && to.height > 0 ? to.width / to.height : null
    const rewriteInline = makeAssetNodeRewriter((node, assetId) =>
      assetId === fromId ? inlineNodePointingAt(node, to.id, aspect) : node,
    )
    next = mapPresentationContent(presentation, (content) =>
      mapContentDocs(swapPanel(content), rewriteInline),
    )
  }

  const stillShown = usedAssetIds(next).has(fromId)
  const assets = next.assets
    .filter((asset) => stillShown || asset.id !== fromId)
    .filter((asset) => asset.id !== to.id)
  return ok(touch({ ...next, assets: [...assets, to] }))
}

/** A picture node re-pointed at another file, carrying that file's proportions. */
function inlineNodePointingAt(node: RichNode, assetId: string, aspect: number | null): RichNode {
  const attrs: Record<string, unknown> = { ...node.attrs, assetId }
  // Only a node that stored a ratio gets the new one: a node from before the
  // attribute existed keeps drawing the stylesheet's default, as it always did.
  if (typeof node.attrs?.aspect === 'number' && aspect !== null) attrs.aspect = aspect
  return { ...node, attrs }
}

/* ------------------------------------------------------------------ *
 * Merging identical files
 * ------------------------------------------------------------------ */

/**
 * Point every use of each `from` file at the `to` file it is a byte-for-byte
 * copy of, and drop the copies from the file list.
 *
 * The map is what `state/imageOptimization.ts` builds from content hashes, and
 * this command takes it on trust that the pairs *are* identical: it is the
 * document half of deduplication and has no bytes to compare. What it does
 * check is that the map describes something this document can do — every file
 * on both sides exists, no file is merged into itself, and no `to` is itself
 * being merged away, which would leave a reference pointing at a file that is
 * gone one step later.
 *
 * A picture's crop and an inline picture's proportions are left exactly as
 * they were: identical bytes are the same size, so nothing about how the file
 * is drawn changes. The bytes of the merged files are the caller's to delete,
 * once this document is stored.
 */
export function mergeDuplicateAssets(
  presentation: Presentation,
  replacements: ReadonlyMap<string, string>,
): Result<Presentation> {
  if (replacements.size === 0) return ok(presentation)
  for (const [from, to] of replacements) {
    if (from === to) {
      return err('INVALID_ARGUMENT', 'En fil kan ikke slås sammen med seg selv.', { assetId: from })
    }
    if (!hasAsset(presentation, from) || !hasAsset(presentation, to)) {
      return err('ASSET_NOT_FOUND', 'Fant ikke filen som skulle slås sammen.', { from, to })
    }
    if (replacements.has(to)) {
      return err('INVALID_ARGUMENT', 'Filen det pekes til slås selv sammen med en annen.', {
        from,
        to,
      })
    }
  }
  const merged = mapPresentationContent(presentation, (content) =>
    remapContentAssetIds(content, replacements),
  )
  return ok(
    touch({
      ...merged,
      theme: remapThemeAssetIds(merged.theme, replacements),
      assets: merged.assets.filter((asset) => !replacements.has(asset.id)),
    }),
  )
}
