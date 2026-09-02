/**
 * Asset loading for the UI.
 *
 * Blobs are cached per asset id so we do not hit the store repeatedly, while
 * object URLs are created and revoked per consumer so there is no leak and no
 * shared-lifetime bug.
 */

import { useEffect, useState } from 'react'
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

export function useAssetUrl(assetId: string | null): string | null {
  const [entry, setEntry] = useState<{ id: string; url: string } | null>(null)

  useEffect(() => {
    if (!assetId) return
    let objectUrl: string | null = null
    let cancelled = false

    void loadAsset(assetId).then((stored) => {
      if (cancelled || !stored) return
      objectUrl = URL.createObjectURL(stored.blob)
      setEntry({ id: assetId, url: objectUrl })
    })

    return () => {
      cancelled = true
      // The URL is released as soon as this consumer stops using it.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [assetId])

  return entry && entry.id === assetId ? entry.url : null
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
