/**
 * Renders a stored asset. SVG stays vector because it is displayed through an
 * `<img>` rather than inlined as markup.
 *
 * Where the URL comes from is not decided here: `useAssetUrl` asks the asset
 * source this subtree is mounted under, which is the repository in the editor
 * and the public share endpoint in a shared deck.
 */

import { useState, type CSSProperties } from 'react'
import { useAssetSource, useAssetUrl } from '../../state/assetSource'

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

/**
 * A file drawn as the whole content of a zone.
 *
 * How it is sized, aligned, rounded and shadowed is `slide.css`'s business —
 * the classes and the proportions are the only thing this hands over. Keeping
 * the rules there rather than in an inline style is what lets the headless
 * preview draw the same picture as the editor from the same stylesheet.
 *
 * The proportions are what make the element the picture rather than the zone,
 * and they come from whichever of the two knows first: the source, for a
 * renderer whose document cannot run anything, and otherwise the `<img>` itself
 * once the browser has it. Until then the picture is drawn the way it always
 * was — `object-fit` inside the whole zone — which is the same picture in the
 * same place, in a box that has not yet been trimmed to it.
 */
export function AssetImage({
  assetId,
  fit,
  rounded,
  alt,
}: {
  assetId: string
  fit: 'contain' | 'cover'
  rounded?: boolean
  alt?: string
}) {
  const url = useAssetUrl(assetId)
  const source = useAssetSource()
  const [loaded, setLoaded] = useState<number | null>(null)
  if (!url) {
    return <div className="asset-image--pending">Laster figur …</div>
  }

  const known = source.aspectRatio?.(assetId) ?? loaded
  const ratio = known && Number.isFinite(known) && known > 0 ? known : null

  const classes = ['asset-image']
  if (fit === 'cover') classes.push('asset-image--cover')
  // Only a picture shown whole needs a box of its own: one that fills the zone
  // already has the zone's.
  else if (ratio) classes.push('asset-image--framed')
  if (rounded) classes.push('asset-image--rounded')

  return (
    <img
      className={classes.join(' ')}
      style={ratio ? ({ '--slaids-asset-ratio': String(ratio) } as CSSProperties) : undefined}
      src={url}
      alt={alt ?? ''}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget
        if (naturalWidth > 0 && naturalHeight > 0) setLoaded(naturalWidth / naturalHeight)
      }}
    />
  )
}
