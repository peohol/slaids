/**
 * Logoen i temaet, tegnet der `domain/logo.ts` sier den står.
 *
 * Bare bildet: ingen håndtak, ingen klikk. Den samme komponenten tegner logoen
 * i editoren, miniatyrbildene, presentasjonsmodus, den delte visningen og den
 * headless renderingen, så den står på samme sted overalt.
 */

import { useAssetUrl } from '../../state/assetSource'
import type { Rect } from '../../domain/types'

export function ThemeLogoImage({ assetId, rect }: { assetId: string; rect: Rect | null }) {
  const url = useAssetUrl(rect ? assetId : null)
  if (!rect || !url) return null
  return (
    <img
      className="slide-logo"
      data-testid="slide-logo"
      src={url}
      alt=""
      draggable={false}
      style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    />
  )
}
