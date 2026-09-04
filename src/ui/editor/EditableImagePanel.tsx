/**
 * The picture panel, with its crop under the pointer.
 *
 * Everything the audience sees is `ImagePanelView`'s — this adds only what
 * belongs to editing:
 *
 *  - a **ghost** of the parts the frame hides, drawn faintly outside it on
 *    hover, so the crop is a window you can see through rather than a guess
 *    about what is missing;
 *  - **dragging** the picture behind the frame, with a magnet at the centre;
 *  - a click through to the upload dialog while there is no file yet.
 *
 * The geometry is the browser's own: `object-fit: cover` decides the scale, and
 * `coverGeometry` re-derives exactly that arithmetic so the ghost lines up with
 * the visible crop to the pixel. It needs the file's natural size, which is
 * read off a hidden probe `<img>` rather than from `AssetRef` — the visible
 * picture is `object-fit: cover`, so its own box says nothing about the file's
 * proportions.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { IMAGE_FOCUS_SNAP_PX } from '../../domain/constants'
import { setImageFocus } from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import { useAssetUrl } from '../../state/assetSource'
import type { ImageCaption, ImagePanel } from '../../domain/types'
import { ImagePanelView } from '../slide/ImagePanelView'

/** How the file is laid out behind the frame, in the frame's own pixels. */
export interface CoverGeometry {
  /** Rendered size of the whole file once scaled to cover the frame. */
  width: number
  height: number
  /** How much of it is hidden, per axis. Zero on the axis that fits exactly. */
  overflowX: number
  overflowY: number
}

export function coverGeometry(
  frame: { width: number; height: number },
  natural: { width: number; height: number },
): CoverGeometry | null {
  if (natural.width <= 0 || natural.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return null
  }
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height)
  const width = natural.width * scale
  const height = natural.height * scale
  return {
    width,
    height,
    overflowX: Math.max(0, width - frame.width),
    overflowY: Math.max(0, height - frame.height),
  }
}

/** Half a pixel of hidden picture is rounding, not a crop worth dragging. */
export function isCropped(geometry: CoverGeometry | null): boolean {
  return Boolean(geometry && (geometry.overflowX > 0.5 || geometry.overflowY > 0.5))
}

/**
 * Where a drag lands, in focus coordinates.
 *
 * Dragging right shows more of the *left* of the picture, so the movement is
 * subtracted. The centre gets a magnet: it is the crop a picture starts at and
 * the one that is impossible to find again by hand, so anything within
 * `IMAGE_FOCUS_SNAP_PX` of it snaps back — measured in the picture's own hidden
 * pixels, so the pull feels the same whatever the file's proportions. An axis
 * with nothing hidden cannot be dragged at all and stays centred.
 */
export function focusAfterDrag(
  start: { x: number; y: number },
  moved: { x: number; y: number },
  geometry: CoverGeometry,
): { x: number; y: number } {
  const axis = (from: number, delta: number, overflow: number): number => {
    if (overflow <= 0) return 0.5
    const next = Math.min(1, Math.max(0, from - delta / overflow))
    return Math.abs(next - 0.5) * overflow <= IMAGE_FOCUS_SNAP_PX ? 0.5 : next
  }
  return {
    x: axis(start.x, moved.x, geometry.overflowX),
    y: axis(start.y, moved.y, geometry.overflowY),
  }
}

export function EditableImagePanel({
  panel,
  variant,
  slideId,
  nodeId,
  renderCaption,
  onPickImage,
}: {
  panel: ImagePanel
  variant: 'card' | 'body'
  slideId: string
  nodeId: string
  renderCaption?: (caption: ImageCaption) => ReactNode
  /** Opens the upload dialog for a panel that has no file yet. */
  onPickImage: () => void
}) {
  const run = useEditorStore((state) => state.run)
  const selectNode = useEditorStore((state) => state.selectNode)
  const hostRef = useRef<HTMLDivElement>(null)
  const url = useAssetUrl(panel.assetId)
  /**
   * The file's own size, tagged with the file it was read from.
   *
   * Tagged rather than cleared when the picture changes: a stale size would
   * frame the new picture with the previous one's overflow for one paint, and
   * comparing the tag says «not this file» without an effect to reset it.
   */
  const [natural, setNatural] = useState<{ url: string; width: number; height: number } | null>(
    null,
  )
  /** The frame, in the slide's own logical pixels. Observed, not read in render. */
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null)
  /** The crop while the pointer is down, so the drag is smooth and one undo step. */
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null)
  const focus = dragging ?? panel.focus

  useEffect(() => {
    const element = hostRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    // The observer fires once when it starts observing, so the first size
    // arrives from the same callback every later one does.
    const observer = new ResizeObserver(() => {
      setFrame({ width: element.offsetWidth, height: element.offsetHeight })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const size = natural && natural.url === url ? natural : null
  const geometry = frame && size ? coverGeometry(frame, size) : null
  const cropped = isCropped(geometry)

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      /*
       * A press inside the caption belongs to the caption. It is text, and the
       * default this handler prevents further down is the very thing that puts
       * the caret in it.
       */
      if (event.target instanceof Element && event.target.closest('.image-caption')) return

      /*
       * Pressing a picture selects its zone, exactly as putting the caret in a
       * text field does. A picture has no field to focus, so without this the
       * inspector would keep showing whichever zone was selected last — and the
       * caption controls would belong to a zone the user is not looking at.
       */
      selectNode(nodeId)

      if (!panel.assetId) {
        onPickImage()
        return
      }
      if (event.button !== 0 || !geometry || !cropped) return
      const element = hostRef.current
      if (!element || element.offsetWidth === 0) return
      /*
       * The stage is drawn at a fractional scale, and the crop is reasoned
       * about in the slide's own logical pixels: `offsetWidth` is the unscaled
       * layout box, so the ratio between it and the painted box is the zoom to
       * divide a pointer movement by.
       */
      const scale = element.getBoundingClientRect().width / element.offsetWidth || 1

      // The crop belongs to this zone, so the press must not also reach the
      // stage and re-select something underneath.
      event.preventDefault()
      event.stopPropagation()

      const origin = { x: event.clientX, y: event.clientY }
      const from = { ...panel.focus }
      const target = event.currentTarget
      let latest = from
      target.setPointerCapture(event.pointerId)

      const move = (moveEvent: PointerEvent): void => {
        latest = focusAfterDrag(
          from,
          { x: (moveEvent.clientX - origin.x) / scale, y: (moveEvent.clientY - origin.y) / scale },
          geometry,
        )
        setDragging(latest)
      }
      const end = (): void => {
        target.releasePointerCapture(event.pointerId)
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', end)
        target.removeEventListener('pointercancel', end)
        setDragging(null)
        // One command for the whole drag, so one Ctrl+Z puts the crop back.
        run('image-focus', (presentation) =>
          setImageFocus(presentation, { slideId, nodeId, focus: latest }),
        )
      }
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', end)
      target.addEventListener('pointercancel', end)
    },
    [cropped, geometry, nodeId, onPickImage, panel.assetId, panel.focus, run, selectNode, slideId],
  )

  /*
   * The ghost is the whole file at the size and position `object-fit: cover`
   * gives it, drawn outside the clipped frame so the hidden parts are visible
   * where they actually are. Chrome, never content: it takes no pointer events
   * and the stylesheet only reveals it on hover.
   */
  const ghost =
    url && geometry && cropped ? (
      <img
        className="image-panel__ghost"
        src={url}
        alt=""
        aria-hidden="true"
        style={{
          width: geometry.width,
          height: geometry.height,
          left: -geometry.overflowX * focus.x,
          top: -geometry.overflowY * focus.y,
        }}
      />
    ) : null

  return (
    <ImagePanelView
      panel={{ ...panel, focus }}
      variant={variant}
      renderCaption={renderCaption}
      hostRef={hostRef}
      overlay={ghost}
      data-image-editable=""
      data-image-cropped={cropped ? '' : undefined}
      data-image-dragging={dragging ? '' : undefined}
      data-image-empty={panel.assetId ? undefined : ''}
      onPointerDown={handlePointerDown}
    >
      {url && (
        <img
          className="image-panel__probe"
          src={url}
          alt=""
          aria-hidden="true"
          onLoad={(event) =>
            setNatural({
              url,
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
      )}
    </ImagePanelView>
  )
}
