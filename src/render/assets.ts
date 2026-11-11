/**
 * The pictures on a page, fetched once and handed over as `data:` URLs.
 *
 * A headless render has no second chance. `renderToStaticMarkup` runs no
 * effects and never re-renders, so anything a component resolves
 * asynchronously is missing from the output — a slide with a figure would come
 * back with a placeholder where the picture should be. So the bytes are
 * collected *before* the markup is built, and the source handed to the
 * renderer answers synchronously.
 *
 * `data:` rather than a URL the browser fetches, for two reasons that are both
 * about the browser being somebody else's process: it has no session and no
 * token, so the authenticated path is closed to it; and a page that fetches
 * nothing cannot be made to fetch something by what is stored in a deck.
 *
 * Which ids a page uses is `deckAssetIds`, the same traversal the shared
 * snapshot narrows its file list with — not a second walk that could miss the
 * inline images inside a card's text.
 */

import { deckAssetIds } from '../domain/commands/assets'
import { pageSlide, type DeckPage } from '../domain/pages'
import { encodeBase64 } from '../agent/binary'
import type { PreviewAssetReader } from '../agent/preview'
import { blobToBytes } from '../persistence/blob'
import type { StoredAsset } from '../persistence/repository'
import type { AssetUrlSource } from '../state/assetSource'
import type { PresentationTheme } from '../domain/types'

export interface PreviewAssets {
  /** Mounted over the renderer, so a picture resolves on the first render. */
  source: AssetUrlSource
  /** A file the store no longer has. The picture shows the gap; this names it. */
  warnings: string[]
}

/**
 * Which files this page draws: what is on the slide, and the theme's logo. The
 * logo is fetched for every slide page, whether or not this one shows it – one
 * small file, and no second copy of the rule for where it stands.
 */
export function pageAssetIds(page: DeckPage, theme: PresentationTheme): string[] {
  const slide = pageSlide(page)
  return slide ? [...deckAssetIds({ theme, slides: [slide] })] : []
}

export async function loadPreviewAssets(
  page: DeckPage,
  theme: PresentationTheme,
  reader: PreviewAssetReader,
): Promise<PreviewAssets> {
  const urls = new Map<string, string>()
  const warnings: string[] = []

  for (const id of pageAssetIds(page, theme)) {
    let stored: StoredAsset | null
    try {
      stored = await reader.getAsset(id)
    } catch (error) {
      warnings.push(`Kunne ikke lese filen ${id}: ${messageOf(error)}`)
      continue
    }
    if (!stored) {
      // Exactly what `validate_slide` reports as `ASSET_NOT_FOUND`, said again
      // here because the picture is the thing being explained: a renderer that
      // silently drew a placeholder would look like a rendering bug.
      warnings.push(`Filen ${id} finnes ikke i lageret, så den vises ikke i previewet.`)
      continue
    }
    const bytes = await blobToBytes(stored.blob)
    urls.set(id, `data:${stored.ref.mimeType};base64,${encodeBase64(bytes)}`)
  }

  return { source: dataUrlAssetSource(urls), warnings }
}

/**
 * The third asset source (see `state/assetSource.tsx`): one that already holds
 * every URL it will ever be asked for.
 */
export function dataUrlAssetSource(urls: ReadonlyMap<string, string>): AssetUrlSource {
  return {
    id: 'preview',
    resolveSync: (assetId) => urls.get(assetId) ?? null,
    resolve: (assetId) => {
      const url = urls.get(assetId)
      return Promise.resolve(url ? { url } : null)
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'ukjent feil'
}
