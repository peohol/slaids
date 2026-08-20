/**
 * Renders a stored asset. SVG stays vector because it is displayed through an
 * `<img>` pointing at a Blob URL rather than inlined as markup.
 */

import { useAssetUrl } from '../../state/assets'

/**
 * An image inside a text flow.
 *
 * Deliberately identical markup and CSS to the static renderer's image, so an
 * offscreen fit measurement matches what the editor shows.
 */
export function InlineAssetImage({ assetId, alt }: { assetId: string | null; alt?: string }) {
  const url = useAssetUrl(assetId)
  if (!url) return <span className="rd-image rd-image--pending" aria-label={alt} />
  return <img className="rd-image" src={url} alt={alt ?? ''} />
}

export function AssetImage({
  assetId,
  fit,
  alt,
}: {
  assetId: string
  fit: 'contain' | 'cover'
  alt?: string
}) {
  const url = useAssetUrl(assetId)
  if (!url) {
    return <div className="asset-image asset-image--pending">Laster figur …</div>
  }
  return <img className="asset-image" style={{ objectFit: fit }} src={url} alt={alt ?? ''} />
}
