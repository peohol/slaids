/**
 * Renders a stored asset. SVG stays vector because it is displayed through an
 * `<img>` pointing at a Blob URL rather than inlined as markup.
 */

import { useAssetUrl } from '../../state/assets'

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
