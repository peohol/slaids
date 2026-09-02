/**
 * Asset bytes from the owner's own store.
 *
 * Blobs are cached per asset id so we do not hit the store repeatedly. Turning
 * one into a URL a component can render is `state/assetSource.tsx`'s job — it
 * is what decides whether a picture comes from here or from the public share
 * endpoint, and this module deliberately knows nothing about that choice.
 */

import { repository } from '../persistence/activeRepository'
import type { AssetRef } from '../domain/types'

const blobCache = new Map<string, Promise<{ ref: AssetRef; blob: Blob } | null>>()

export function loadAsset(id: string): Promise<{ ref: AssetRef; blob: Blob } | null> {
  const cached = blobCache.get(id)
  if (cached) return cached
  const promise = repository.getAsset(id).catch(() => null)
  blobCache.set(id, promise)
  return promise
}

/**
 * Forget every cached blob. Called on sign-out: the cache is keyed by asset id
 * alone, and the next user must not be shown the previous one's files.
 */
export function clearAssetCache(): void {
  blobCache.clear()
}

/** Intrinsic size of an image file, used when registering an asset. */
export function readImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      resolve({ width: 0, height: 0 })
      URL.revokeObjectURL(url)
    }
    image.src = url
  })
}
