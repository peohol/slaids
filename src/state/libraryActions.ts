/**
 * Library-level operations that span the repository and the domain.
 */

import { cloneSubtreeWithNewIds } from '../domain/layout'
import { newAssetId, newPresentationId, newSlideId } from '../domain/ids'
import { remapAssetIds } from '../domain/docs'
import { repository } from '../persistence/dexieRepository'
import type { Presentation } from '../domain/types'

/**
 * Deep-copy a presentation, including its assets.
 *
 * Assets are copied rather than shared: assets belong to a presentation and are
 * deleted with it, so a shared reference would break the copy later.
 */
export async function duplicatePresentation(sourceId: string): Promise<Presentation> {
  const source = await repository.loadPresentation(sourceId)
  const now = new Date().toISOString()

  const assetMap = new Map<string, string>()
  for (const asset of source.assets) assetMap.set(asset.id, newAssetId())

  let copy: Presentation = {
    ...source,
    id: newPresentationId(),
    title: `${source.title} (kopi)`,
    createdAt: now,
    updatedAt: now,
    slides: source.slides.map((slide) => ({
      ...slide,
      id: newSlideId(),
      title: slide.title ? (structuredClone(slide.title) as typeof slide.title) : null,
      root: cloneSubtreeWithNewIds(slide.root),
    })),
  }
  copy = remapAssetIds(copy, assetMap)

  for (const asset of source.assets) {
    const stored = await repository.getAsset(asset.id)
    if (!stored) continue
    const targetId = assetMap.get(asset.id)
    if (!targetId) continue
    await repository.putAsset(copy.id, { ...stored.ref, id: targetId }, stored.blob)
  }

  await repository.savePresentation(copy)
  return copy
}

export async function renamePresentation(id: string, title: string): Promise<void> {
  const presentation = await repository.loadPresentation(id)
  const trimmed = title.trim()
  if (!trimmed) return
  await repository.savePresentation({
    ...presentation,
    title: trimmed,
    updatedAt: new Date().toISOString(),
  })
}

export async function movePresentationToFolder(id: string, folderId: string | null): Promise<void> {
  const presentation = await repository.loadPresentation(id)
  await repository.savePresentation({
    ...presentation,
    folderId,
    updatedAt: new Date().toISOString(),
  })
}

/** Trigger a browser download for a generated file. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
