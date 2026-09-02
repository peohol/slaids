/**
 * Where a picture comes from.
 *
 * There are two answers, and which one applies is decided by *where the
 * renderer is mounted*, not by a branch inside it:
 *
 *  - the editor, the library and local presentation mode read the owner's own
 *    files through the repository — Supabase Storage or IndexedDB — and hand
 *    the renderer a Blob URL;
 *  - the public shared view reads them through the share endpoint, which serves
 *    a file only when the published snapshot actually lists it.
 *
 * Keeping this in a context rather than in `AssetImage` is what guarantees the
 * second case never touches the first: a shared deck has no session, so a
 * request down the authenticated path could only fail, and it must not even be
 * attempted.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadAsset } from './assets'
import { sharedAssetUrl } from '../sharing/shareClient'

export interface ResolvedAsset {
  url: string
  /** Called when the consumer is done, for URLs that own a resource. */
  release?: () => void
}

export interface AssetUrlSource {
  /** Identity, so a consumer never shows a URL resolved by a different source. */
  id: string
  resolve(assetId: string): Promise<ResolvedAsset | null>
}

/**
 * The private source: the signed-in owner's own files.
 *
 * Blobs are cached per asset id by `loadAsset`; the object URL is created and
 * revoked per consumer, so there is no leak and no shared lifetime.
 */
export const repositoryAssetSource: AssetUrlSource = {
  id: 'repository',
  resolve: async (assetId) => {
    const stored = await loadAsset(assetId)
    if (!stored) return null
    const url = URL.createObjectURL(stored.blob)
    return { url, release: () => URL.revokeObjectURL(url) }
  },
}

/** The public source: one deck, by token, through the share endpoint. */
export function sharedAssetSource(token: string): AssetUrlSource {
  return {
    id: `shared:${token}`,
    resolve: (assetId) => {
      // A plain URL owns nothing, so there is no `release`: the browser caches
      // and frees it like any other image.
      const url = sharedAssetUrl(token, assetId)
      return Promise.resolve(url ? { url } : null)
    },
  }
}

const AssetSourceContext = createContext<AssetUrlSource>(repositoryAssetSource)

export function AssetSourceProvider({
  value,
  children,
}: {
  value: AssetUrlSource
  children: ReactNode
}) {
  return <AssetSourceContext.Provider value={value}>{children}</AssetSourceContext.Provider>
}

export function useAssetSource(): AssetUrlSource {
  return useContext(AssetSourceContext)
}

/** Convenience for the shared view: memoised so the context value is stable. */
export function useSharedAssetSource(token: string): AssetUrlSource {
  return useMemo(() => sharedAssetSource(token), [token])
}

export function useAssetUrl(assetId: string | null): string | null {
  const source = useAssetSource()
  const [entry, setEntry] = useState<{ key: string; url: string } | null>(null)
  const key = assetId ? `${source.id}::${assetId}` : null

  useEffect(() => {
    if (!assetId || !key) return
    let resolved: ResolvedAsset | null = null
    let cancelled = false

    void source
      .resolve(assetId)
      .catch(() => null)
      .then((next) => {
        if (cancelled) {
          next?.release?.()
          return
        }
        resolved = next
        if (next) setEntry({ key, url: next.url })
      })

    return () => {
      cancelled = true
      resolved?.release?.()
    }
  }, [assetId, key, source])

  return entry && entry.key === key ? entry.url : null
}
