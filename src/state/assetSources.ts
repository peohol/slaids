/**
 * The two asset sources the browser uses.
 *
 * They live beside `assetSource.tsx` rather than in it because each of them
 * reaches a store, and reaching a store means importing the machinery that
 * decides which store: the repository source pulls in the Supabase/IndexedDB
 * mode, and the shared source pulls in the deployment's public configuration.
 * Neither belongs in the module graph of a renderer that only draws a slide —
 * `src/render/` is exactly such a graph, and it runs on a server with no
 * IndexedDB and no session.
 *
 * See `IMPLEMENTATION_PLAN.md` §43.5, "Én renderer": the choice is made by where
 * a component is mounted, never by a branch inside it.
 */

import { useMemo } from 'react'
import { loadAsset } from './assets'
import { sharedAssetUrl } from '../sharing/shareClient'
import type { AssetUrlSource } from './assetSource'

/**
 * The private source: the signed-in owner's own files.
 *
 * Blobs are cached per asset id by `loadAsset`; the object URL is created and
 * revoked per consumer, so there is no leak and no shared lifetime. There is no
 * `resolveSync`, and there cannot be: the bytes have to come out of the store
 * first.
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

/**
 * The public source: one deck, by token, through the share endpoint.
 *
 * A plain URL owns nothing, so there is no `release`: the browser caches and
 * frees it like any other image. It is known without asking anybody, which is
 * why this one can answer synchronously.
 */
export function sharedAssetSource(token: string): AssetUrlSource {
  return {
    id: `shared:${token}`,
    resolveSync: (assetId) => sharedAssetUrl(token, assetId),
    resolve: (assetId) => {
      const url = sharedAssetUrl(token, assetId)
      return Promise.resolve(url ? { url } : null)
    },
  }
}

/** Convenience for the shared view: memoised so the context value is stable. */
export function useSharedAssetSource(token: string): AssetUrlSource {
  return useMemo(() => sharedAssetSource(token), [token])
}
