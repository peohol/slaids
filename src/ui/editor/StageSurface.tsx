/**
 * The frame every editor stage is drawn in, and the one place a finger changes
 * what it shows.
 *
 * All four stages — a slide, a section, a miniapp's cover, a generated page —
 * are the same three boxes: a viewport that measures the room, a scaler the
 * size of what is on show, and the 1600 × 900 page inside it under a uniform
 * transform. They were four copies of that until the view stopped being fixed:
 * the moment a pinch could change it, four copies meant a pinch that worked on
 * one page kind and zoomed the whole application on the other three.
 *
 * So the frame lives here, and with it the view transform (`stageView.ts`) and
 * the gesture that drives it (`stageGestures.ts`). What each stage still owns
 * is what is *in* the frame, and — for the one stage with zones — what a press
 * on it means.
 */

import { useCallback, useRef, type ReactNode, type RefObject } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { viewportToSlide } from '../../domain/geometry'
import type { Rect } from '../../domain/types'
import { useContainerBox } from '../slide/useFitScale'
import { useStageGestures, type PinchGesture } from './stageGestures'
import { FULL_SLIDE, NO_ZOOM, isZoomed, panBy, stageView, viewRect, zoomAbout, type StageZoom } from './stageView'

/** What kind of page is on the slide, published for the stylesheets and tests. */
export type StageKind = 'content' | 'section' | 'interactive' | 'readonly'

const KIND_ATTRIBUTE: Record<StageKind, string | undefined> = {
  content: undefined,
  section: 'data-section',
  interactive: 'data-interactive',
  readonly: 'data-readonly',
}

export interface StageSurfaceProps {
  kind?: StageKind
  /**
   * Which rect of the slide fills the stage before any pinch: the whole page,
   * or the one zone the view is focused on.
   */
  base?: Rect
  /**
   * The pinch on top of it, and the way to change it.
   *
   * Given only where pinching is wanted. Without `onZoomChange` the stage does
   * not listen for two fingers at all and the stylesheet leaves the browser's
   * own pinch alone — which is what a roomy workspace gets.
   */
  zoom?: StageZoom
  onZoomChange?: (update: (zoom: StageZoom) => StageZoom) => void
  /** The slide element, for a host that converts pointers into slide points. */
  slideRef?: RefObject<HTMLDivElement | null>
  /**
   * Called when a gesture is about to move the view.
   *
   * The host's chance to let go of anything it was doing with the same hand —
   * a ratio drag abandoned in favour of the pinch that took over — and to note
   * that the press which ends the gesture is not a click.
   */
  onViewMoved?: () => void
  /**
   * Whether one finger may pan right now.
   *
   * False while the host's own drag has the hand: two fingers always mean the
   * view, but one finger may well mean the layout.
   */
  canPan?: () => boolean
  /**
   * One finger that stayed put, in **slide** coordinates.
   *
   * The conversion happens here because this is where the view transform is,
   * so every stage hit-tests the press against the 1600 × 900 page it actually
   * drew rather than against the pixels it happened to be scaled to. Given
   * only where a long press means something; without it no timer is ever set.
   */
  onLongPress?: (point: { x: number; y: number }) => void
  onPointerDown?: (event: React.PointerEvent) => void
  onPointerMove?: (event: React.PointerEvent) => void
  onPointerLeave?: (event: React.PointerEvent) => void
  onClick?: (event: React.MouseEvent) => void
  /** A right-click, Shift+F10 or the menu key on the page. */
  onContextMenu?: (event: React.MouseEvent) => void
  /** A line under the stage saying what this page is and where it came from. */
  note?: ReactNode
  /** The page itself, at 1600 × 900. The scale is passed for the few that need it. */
  children: (scale: number) => ReactNode
}

/**
 * A right-press on text asks for a menu; it does not edit.
 *
 * On a field nobody is typing in, the focus stays where it is: the browser
 * would put the caret in that field first, and the menu would then open over a
 * field being typed in — which is where the browser's own menu belongs (see
 * `contentTarget.ts`). Asking for a menu on some text is not starting to type in
 * it; the menu's entries take the focus when they act.
 *
 * And the editor never hears of the press: ProseMirror treats any press as a
 * click, and a click on a picture in the text selects it and takes the focus —
 * away from the menu that has just opened, which closes it again.
 */
function secondaryPressInText(event: React.MouseEvent): void {
  if (event.button !== 2 || !(event.target instanceof Element)) return
  const field = event.target.closest('[contenteditable="true"]')
  if (!field) return
  event.stopPropagation()
  if (!field.contains(document.activeElement)) event.preventDefault()
}

export function StageSurface({
  kind = 'content',
  base = FULL_SLIDE,
  zoom = NO_ZOOM,
  onZoomChange,
  slideRef,
  onViewMoved,
  canPan,
  onLongPress,
  onPointerDown,
  onPointerMove,
  onPointerLeave,
  onClick,
  onContextMenu,
  note,
  children,
}: StageSurfaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const slideElement = useRef<HTMLDivElement>(null)
  const box = useContainerBox(viewportRef)
  const shown = viewRect(base, zoom)
  const view = stageView(box, shown)
  // Less of the page than all of it is on show, so the scaler has to clip.
  const cropped = shown.width < SLIDE_WIDTH || shown.height < SLIDE_HEIGHT

  const attachSlide = useCallback(
    (element: HTMLDivElement | null) => {
      slideElement.current = element
      if (slideRef) slideRef.current = element
    },
    [slideRef],
  )

  /**
   * A point on screen, as a point on the slide.
   *
   * The scale is read back off the element rather than taken from the render:
   * it is the same number either way, and reading it means an anchor is right
   * even mid-pinch, when the view has moved on from the render that drew it.
   */
  const toSlidePoint = useCallback((clientX: number, clientY: number) => {
    const element = slideElement.current
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const rendered = rect.width / SLIDE_WIDTH
    if (rendered <= 0) return null
    return viewportToSlide(clientX, clientY, { left: rect.left, top: rect.top }, rendered)
  }, [])

  /** How many screen pixels one slide unit is, for a given zoom. */
  const pixelsPerUnit = (current: StageZoom): number =>
    stageView(box, viewRect(base, current)).scale || 1

  /**
   * Two fingers on the slide.
   *
   * The view magnifies about the point they grabbed and follows them as they
   * travel, which together is the whole of "the content under the fingers does
   * not jump". Both are applied to the zoom as it is *now* rather than as this
   * render drew it: a pinch produces several moves per frame, and each of them
   * has to build on the one before it.
   */
  const applyPinch = (gesture: PinchGesture): void => {
    if (!onZoomChange) return
    // Announced before the anchor is read, so a host that was mid-drag has
    // already let go by the time the view moves.
    onViewMoved?.()
    const anchor = toSlidePoint(gesture.previousX, gesture.previousY)
    onZoomChange((current) => {
      const zoomed = anchor
        ? zoomAbout(base, current, gesture.factor, anchor.x, anchor.y)
        : { ...current, scale: current.scale * gesture.factor }
      const perUnit = pixelsPerUnit(zoomed)
      return panBy(
        base,
        zoomed,
        (gesture.x - gesture.previousX) / perUnit,
        (gesture.y - gesture.previousY) / perUnit,
      )
    })
  }

  /** One finger dragging a magnified slide about, to see the rest of it. */
  const applyPan = (dx: number, dy: number): void => {
    if (!onZoomChange || canPan?.() === false) return
    onViewMoved?.()
    onZoomChange((current) => panBy(base, current, dx / pixelsPerUnit(current), dy / pixelsPerUnit(current)))
  }

  const gestures = useStageGestures({
    enabled: Boolean(onZoomChange || onLongPress),
    onPinch: applyPinch,
    onPan: applyPan,
    // One finger is the deck's — a page turn — until there is somewhere to pan.
    panWithOnePointer: isZoomed(zoom),
    // Whether a resting finger meant anything is the host's question: only it
    // knows whether a gesture of its own has taken the hand. All this does is
    // put the point in the space the host hit-tests in.
    onLongPress: onLongPress
      ? (point) => {
          const onSlide = toSlidePoint(point.x, point.y)
          if (onSlide) onLongPress(onSlide)
        }
      : undefined,
  })

  const kindAttribute = KIND_ATTRIBUTE[kind]

  return (
    <div
      className="stage-viewport"
      ref={viewportRef}
      data-testid="stage-viewport"
      /* This stage answers a pinch itself, so the stylesheet takes the
         browser's out of the way here and only here. */
      data-pinch={onZoomChange ? '' : undefined}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        /* Every press is offered to the recogniser as well, so a second finger
           is always the view's — including one that lands while a host's own
           drag is under way, which the pinch then takes over from. */
        gestures.onPointerDown(event)
      }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseDownCapture={onContextMenu ? secondaryPressInText : undefined}
    >
      <div
        className="stage-scaler"
        data-focused={cropped ? '' : undefined}
        style={{ width: view.width, height: view.height }}
      >
        <div
          ref={attachSlide}
          className="stage-slide"
          data-testid="stage-slide"
          data-scale={view.scale}
          data-zoom={zoom.scale}
          {...(kindAttribute ? { [kindAttribute]: '' } : {})}
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children(view.scale)}
        </div>
      </div>
      {note !== undefined && (
        <p className="stage-note" data-testid="stage-note">
          {note}
        </p>
      )}
    </div>
  )
}
