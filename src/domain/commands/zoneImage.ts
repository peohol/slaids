import { createImage, imagePanelOf } from '../content'
import { findLeaf } from '../layout'
import { err, ok, type Result } from '../result'
import type { AssetRef, NodeId, Presentation } from '../types'
import { hasAsset, registerAsset } from './assets'
import { setImageAsset } from './content'
import { contentSlide } from './internal'
import { setZoneContent } from './layout'
import { outcome, type ContentDisposition, type StructuralOptions, type StructuralOutcome } from './types'

/** Sett inn bildefilen og registrer den i samme endring. Et bildepanel beholder oppsettet sitt. */
export function placeZoneImage(
  presentation: Presentation,
  input: {
    slideId: string
    nodeId: NodeId
    asset: AssetRef
    replacedDisposition?: ContentDisposition
  } & StructuralOptions,
): Result<StructuralOutcome> {
  const slide = contentSlide(presentation, input.slideId)
  if (!slide.ok) return slide
  const leaf = findLeaf(slide.value.root, input.nodeId)
  if (!leaf) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const registered = hasAsset(presentation, input.asset.id)
    ? ok(presentation)
    : registerAsset(presentation, input.asset)
  if (!registered.ok) return registered

  if (leaf.content && imagePanelOf(leaf.content)) {
    const updated = setImageAsset(registered.value, { ...input, assetId: input.asset.id })
    return updated.ok ? ok(outcome(updated.value)) : updated
  }

  return setZoneContent(registered.value, {
    ...input,
    content: createImage(input.asset.id),
    replace: input.replacedDisposition !== undefined,
  })
}
