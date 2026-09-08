/**
 * Asset bytes from the owner's own store.
 *
 * Blobs are cached per asset id so we do not hit the store repeatedly. Turning
 * one into a URL a component can render is `state/assetSource.tsx`'s job — it
 * is what decides whether a picture comes from here or from the public share
 * endpoint, and this module deliberately knows nothing about that choice.
 */

import { readRasterImage } from '../domain/imageFile'
import { blobToBytes } from '../persistence/blob'
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

/**
 * Put a file this browser has just stored straight into the cache.
 *
 * The optimiser writes a file and then points the document at it; the first
 * render after that would otherwise go back to the store for bytes that were in
 * memory a moment ago — a download, in Supabase mode, of what was just uploaded.
 */
export function primeAssetCache(id: string, stored: { ref: AssetRef; blob: Blob }): void {
  blobCache.set(id, Promise.resolve(stored))
}

/** Drop one file from the cache, once its bytes are gone from the store. */
export function forgetCachedAsset(id: string): void {
  blobCache.delete(id)
}

/**
 * Intrinsic size of an image file, used when registering an asset.
 *
 * The bitstream says it for every raster format Slaids validates, and that is
 * the same answer `domain/imageFile.ts` gives an agent — one truth for "how big
 * is this picture", and one that only accepts a file that is actually complete.
 * The browser's own decoder is the fallback for the rest (SVG, AVIF), which is
 * something only it can do.
 */
export async function readImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const raster = readRasterImage(await blobToBytes(blob))
  if (raster.ok) return { width: raster.value.width, height: raster.value.height }
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
