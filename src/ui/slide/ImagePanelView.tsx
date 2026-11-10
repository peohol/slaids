/**
 * A picture filling the box it is given, and the caption over it.
 *
 * Used by every renderer — the stage, a thumbnail, presentation mode, the
 * shared view, the offscreen fit measurement and the headless preview — so
 * what a crop hides here is what it hides everywhere. The editor adds
 * dragging and a ghost of the hidden parts on top of this, in
 * `EditableImagePanel`; nothing about the picture's geometry lives there.
 */

import type { CSSProperties, ReactNode, Ref } from 'react'
import {
  CAPTION_BLUR_PX,
  CAPTION_PADDING_X_EM,
  CAPTION_PADDING_Y_EM,
  CAPTION_RADIUS,
  CAPTION_TINT_OPACITY,
  CARD_RADIUS,
} from '../../domain/constants'
import { CAPTION_PART } from '../../domain/fit'
import { cardShadow, themeMetrics } from '../../domain/metrics'
import type { CaptionPosition, ImageCaption, ImagePanel } from '../../domain/types'
import { useAssetUrl } from '../../state/assetSource'
import { RichDocView } from './RichDocView'
import { useSlideRender } from './SlideRenderContext'

/**
 * Which corners a caption rounds, by where it hangs.
 *
 * A caption at the top hangs from the ceiling, so its top corners are the
 * picture's own and only the bottom two are rounded; at the bottom it stands on
 * the floor and the rule is mirrored. In the middle it touches nothing and is
 * rounded all the way round.
 */
const CAPTION_RADII: Record<CaptionPosition, string> = {
  top: `0 0 ${CAPTION_RADIUS}px ${CAPTION_RADIUS}px`,
  middle: `${CAPTION_RADIUS}px`,
  bottom: `${CAPTION_RADIUS}px ${CAPTION_RADIUS}px 0 0`,
}

/**
 * How the caption sits in the picture, and therefore which way it grows.
 *
 * `safe` on the middle case for the same reason the subfield flow uses it:
 * with a caption taller than the picture, plain centring pushes the top of it
 * out through the top edge where `scrollHeight` cannot see it, and the
 * overflow measurement would read half the truth.
 */
const CAPTION_ALIGN: Record<CaptionPosition, string> = {
  top: 'flex-start',
  middle: 'safe center',
  bottom: 'flex-end',
}

/**
 * The tint behind a caption.
 *
 * `color-mix` rather than a precomputed rgba, because a caption with no colour
 * of its own has to read the deck's — `--slaids-heading-pill` is a custom
 * property, and mixing is the only way to give a value you cannot see an alpha
 * channel. That is what keeps "follows the cover" true for captions the same
 * way it is true for headings and card headers.
 */
function captionTint(color: string | null): string {
  const base = color ?? 'var(--slaids-heading-pill)'
  return `color-mix(in srgb, ${base} ${Math.round(CAPTION_TINT_OPACITY * 100)}%, transparent)`
}

/**
 * Where the frame sits over the picture, as CSS.
 *
 * `object-fit: cover` scales the file until it covers the frame in both
 * directions, and `object-position` then chooses which part of the overflow is
 * hidden — `0%` keeps the top/left edge, `100%` the bottom/right. So the whole
 * crop is two numbers and the browser does the arithmetic.
 */
export function focusPosition(focus: { x: number; y: number }): string {
  return `${focus.x * 100}% ${focus.y * 100}%`
}

export function CaptionBox({
  caption,
  children,
}: {
  caption: ImageCaption
  children: ReactNode
}) {
  const { theme } = useSlideRender()
  const tokens = themeMetrics(theme)
  return (
    <div
      className="image-caption__layer"
      data-fit-scroll=""
      data-fit-part={CAPTION_PART}
      style={{
        alignItems: CAPTION_ALIGN[caption.position],
        padding: `0 ${tokens.captionSideGap}px`,
      }}
    >
      <div
        className="image-caption"
        data-caption-position={caption.position}
        style={{
          background: captionTint(caption.color),
          backdropFilter: `blur(${CAPTION_BLUR_PX}px)`,
          WebkitBackdropFilter: `blur(${CAPTION_BLUR_PX}px)`,
          borderRadius: CAPTION_RADII[caption.position],
          fontSize: tokens.captionFontSize,
          padding: `${CAPTION_PADDING_Y_EM}em ${CAPTION_PADDING_X_EM}em`,
        } as CSSProperties}
      >
        {children}
      </div>
    </div>
  )
}

/** The picture itself, cropped to the frame. `null` while there is no file. */
export function PanelImage({ assetId, focus }: { assetId: string | null; focus: { x: number; y: number } }) {
  const url = useAssetUrl(assetId)
  if (!assetId) {
    return <div className="image-panel__empty">Ingen fil valgt</div>
  }
  if (!url) return <div className="image-panel__empty">Laster bilde …</div>
  return (
    <img
      className="image-panel__img"
      src={url}
      alt=""
      // A picture on a slide is a picture *of* the slide, not a file to carry
      // off it. Left draggable, the browser's own image drag takes over the
      // press and the gesture the zone was expecting never arrives.
      draggable={false}
      style={{ objectPosition: focusPosition(focus) }}
    />
  )
}

/**
 * The picture panel: a frame the picture fills to the edges, with the caption
 * floating over it.
 *
 * The frame rounds and shadows itself only when it *is* the card — a picture
 * under a title panel joined to it is the card's lower half, so it takes the
 * card's bottom corners and lets the card cast the shadow. Under a title drawn
 * as a tab or a card of its own, the picture is a card again.
 */
export function ImagePanelView({
  panel,
  variant,
  renderCaption,
  overlay,
  hostRef,
  children,
  ...rest
}: {
  panel: ImagePanel
  /** `card` is a picture that is the whole card; `body` sits under a header. */
  variant: 'card' | 'body'
  renderCaption?: (caption: ImageCaption) => ReactNode
  /** Editing chrome drawn outside the clipped frame (the crop ghost). */
  overlay?: ReactNode
  hostRef?: Ref<HTMLDivElement>
} & React.HTMLAttributes<HTMLDivElement>) {
  const { theme } = useSlideRender()
  const radius = variant === 'card' ? CARD_RADIUS : `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`
  return (
    <div
      ref={hostRef}
      className="image-panel"
      data-image-variant={variant}
      style={{
        borderRadius: radius,
        ...(variant === 'card' ? { boxShadow: cardShadow(theme) } : {}),
      }}
      {...rest}
    >
      {overlay}
      <div className="image-panel__frame" style={{ borderRadius: radius }}>
        <PanelImage assetId={panel.assetId} focus={panel.focus} />
        {panel.caption &&
          (renderCaption ? (
            renderCaption(panel.caption)
          ) : (
            <CaptionBox caption={panel.caption}>
              <RichDocView doc={panel.caption.doc} className="rich-doc--caption" field="title" />
            </CaptionBox>
          ))}
      </div>
      {children}
    </div>
  )
}
