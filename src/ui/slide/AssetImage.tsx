/**
 * Renders a stored asset. SVG stays vector because it is displayed through an
 * `<img>` rather than inlined as markup.
 *
 * Where the URL comes from is not decided here: `useAssetUrl` asks the asset
 * source this subtree is mounted under, which is the repository in the editor
 * and the public share endpoint in a shared deck.
 */

import { useAssetUrl } from '../../state/assetSource'

/**
 * An image inside a text flow.
 *
 * Deliberately identical markup and CSS to the static renderer's image, so an
 * offscreen fit measurement matches what the editor shows.
 */
export function InlineAssetImage({ assetId, alt }: { assetId: string | null; alt?: string }) {
  const url = useAssetUrl(assetId)
  if (!url) return <span className="rd-image rd-image--pending" aria-label={alt} />
  // Not draggable, for the reason `PanelImage` gives: the browser's own image
  // drag would take over a press meant for the zone around it.
  return <img className="rd-image" src={url} alt={alt ?? ''} draggable={false} />
}
