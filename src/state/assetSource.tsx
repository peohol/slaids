/**
 * Where a picture comes from.
 *
 * There are three answers, and which one applies is decided by *where the
 * renderer is mounted*, not by a branch inside it:
 *
 *  - the editor, the library and local presentation mode read the owner's own
 *    files through the repository — Supabase Storage or IndexedDB — and hand
 *    the renderer a Blob URL;
 *  - the public shared view reads them through the share endpoint, which serves
 *    a file only when the published snapshot actually lists it;
 *  - the headless preview (`src/render/`) has already fetched the bytes and
 *    hands over `data:` URLs, synchronously, because there is no second render
 *    pass on a server.
 *
 * Keeping this in a context rather than in `AssetImage` is what guarantees the
 * second case never touches the first: a shared deck has no session, so a
 * request down the authenticated path could only fail, and it must not even be
 * attempted.
 *
 * The concrete sources are not in this file, and that is the point rather than
 * tidiness. Each of them drags in what it needs to reach its store — the
 * repository source pulls in the Supabase/IndexedDB decision, the shared source
 * pulls in the share endpoint's configuration — and a static import of either
 * would put both inside every module graph that merely *draws* a slide. The
 * headless renderer is one such graph, and it runs where neither store exists.
 * So this file holds the contract and the hooks, `assetSources.ts` holds the two
 * the browser uses, and a tree that renders assets is mounted under the one that
 * belongs to it.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface ResolvedAsset {
  url: string
  /** Called when the consumer is done, for URLs that own a resource. */
  release?: () => void
}

export interface AssetUrlSource {
  /** Identity, so a consumer never shows a URL resolved by a different source. */
  id: string
  resolve(assetId: string): Promise<ResolvedAsset | null>
  /**
   * The URL, now, for a source that already has it.
   *
   * Optional because the private source genuinely does not: a Blob has to come
   * out of IndexedDB or Storage first. Where it *is* available it is not merely
   * an optimisation — server-side rendering has no effects and no second pass,
   * so a picture that is only resolved from `useEffect` is a picture that never
   * appears in a rendered preview at all.
   */
  resolveSync?(assetId: string): string | null
}

/**
 * The default: nothing resolves.
 *
 * Deliberately not the repository source. A renderer that draws a picture is
 * mounted under the source that owns it — the app does that once, at the top —
 * and a default that reached for the owner's own files would be a default that
 * silently works in the editor and silently fails everywhere else, which is the
 * shape of the bug this context exists to prevent.
 */
export const nullAssetSource: AssetUrlSource = {
  id: 'none',
  resolve: () => Promise.resolve(null),
  resolveSync: () => null,
}

const AssetSourceContext = createContext<AssetUrlSource>(nullAssetSource)

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

export function useAssetUrl(assetId: string | null): string | null {
  const source = useAssetSource()
  const [entry, setEntry] = useState<{ key: string; url: string } | null>(null)
  const key = assetId ? `${source.id}::${assetId}` : null
  // A source that already holds the URL answers on the first render, with no
  // state and no effect: that is what makes the same components usable from
  // `renderToStaticMarkup`, where effects never run.
  const immediate = assetId && source.resolveSync ? source.resolveSync(assetId) : null

  useEffect(() => {
    if (!assetId || !key) return
    if (source.resolveSync?.(assetId)) return
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

  if (immediate) return immediate
  return entry && entry.key === key ? entry.url : null
}
