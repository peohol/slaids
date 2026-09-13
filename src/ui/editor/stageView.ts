/**
 * Where the slide sits in the stage, and which part of it is showing.
 *
 * One model for every view transform the editor has. There is no second
 * geometry and no second design space: the slide is always the same 1600 × 900
 * page, and a transform only ever decides **which rectangle of it fills the
 * stage**.
 *
 *   whole slide      → the rect is the page
 *   focused zone     → the rect is that zone
 *   pinched in       → the rect is a part of whichever of those two is the base
 *
 * Because the three are the same rectangle expressed differently, they compose
 * without competing: focusing a zone changes the base, pinching magnifies
 * whatever the base is, and `viewportToSlide` converts a pointer back through
 * the same uniform scale in every case. Nothing here is stored, nothing here
 * reaches a domain command, and none of it is a fact about the presentation.
 */

import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import type { Rect } from '../../domain/types'
import type { ContainerBox } from '../slide/useFitScale'

/** The whole page: the base rect when no zone is focused. */
export const FULL_SLIDE: Rect = { x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT }

/**
 * As far in as a pinch may go.
 *
 * Six times is enough to read body type on a phone held at arm's length and
 * still leaves a recognisable part of the page on screen; past that the view
 * stops being an inspection of the slide and becomes a magnifying glass over
 * one word.
 */
export const MAX_STAGE_ZOOM = 6

/**
 * A pinch, in slide coordinates.
 *
 * Deliberately not a pixel offset: a phone that rotates, a panel that opens or
 * a keyboard that appears all change how big the stage is, and a transform
 * stored in screen pixels would mean something different afterwards. Stated as
 * "this much magnification about this point of the page", it survives all of
 * them and needs no re-measuring.
 */
export interface StageZoom {
  scale: number
  centreX: number
  centreY: number
}

/** No magnification at all. The centre is unused until `scale` leaves 1. */
export const NO_ZOOM: StageZoom = { scale: 1, centreX: SLIDE_WIDTH / 2, centreY: SLIDE_HEIGHT / 2 }

export function isZoomed(zoom: StageZoom): boolean {
  return zoom.scale > 1.001
}

function clamp(value: number, low: number, high: number): number {
  if (high < low) return low
  return Math.min(high, Math.max(low, value))
}

/**
 * The part of the slide the stage shows: `base`, magnified about the zoom's
 * centre and kept inside `base`.
 *
 * The clamp is the whole of the panning rule. A view can never leave the base
 * rect, so a pinch cannot strand the author on empty space beside the page, and
 * releasing the magnification always lands exactly back on the base rect rather
 * than somewhere near it.
 */
export function viewRect(base: Rect, zoom: StageZoom): Rect {
  const scale = clamp(zoom.scale, 1, MAX_STAGE_ZOOM)
  const width = base.width / scale
  const height = base.height / scale
  return {
    x: clamp(zoom.centreX - width / 2, base.x, base.x + base.width - width),
    y: clamp(zoom.centreY - height / 2, base.y, base.y + base.height - height),
    width,
    height,
  }
}

/** The zoom as it would be stored: clamped, with its centre inside the base. */
function settle(base: Rect, zoom: StageZoom): StageZoom {
  const rect = viewRect(base, zoom)
  return {
    scale: clamp(zoom.scale, 1, MAX_STAGE_ZOOM),
    centreX: rect.x + rect.width / 2,
    centreY: rect.y + rect.height / 2,
  }
}

/**
 * Magnify by `factor` about a point of the slide, leaving that point where it
 * is on screen.
 *
 * This is what stops the page jumping out from under the fingers: the slide
 * coordinate the pinch started on keeps the same fraction of the view, so it
 * stays under the same pixel while everything around it grows.
 */
export function zoomAbout(
  base: Rect,
  zoom: StageZoom,
  factor: number,
  anchorX: number,
  anchorY: number,
): StageZoom {
  const current = viewRect(base, zoom)
  const scale = clamp(zoom.scale * factor, 1, MAX_STAGE_ZOOM)
  const width = base.width / scale
  const height = base.height / scale
  const fractionX = current.width > 0 ? (anchorX - current.x) / current.width : 0.5
  const fractionY = current.height > 0 ? (anchorY - current.y) / current.height : 0.5
  return settle(base, {
    scale,
    centreX: anchorX - (fractionX - 0.5) * width,
    centreY: anchorY - (fractionY - 0.5) * height,
  })
}

/**
 * Drag the slide by a slide-space delta: the content follows the hand, so the
 * view moves the other way.
 */
export function panBy(base: Rect, zoom: StageZoom, dx: number, dy: number): StageZoom {
  return settle(base, { ...zoom, centreX: zoom.centreX - dx, centreY: zoom.centreY - dy })
}

/** Where the slide sits in the stage: the scale, and the corner it starts at. */
export interface StageView {
  scale: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

/**
 * Fit one rect of the slide into the stage box.
 *
 * A uniform scale applied to the 1600 × 900 design space and a translation that
 * brings the rect to the stage's corner — nothing else, and nothing rounded
 * differently for one case than for another. `null` means the whole page, which
 * is the same arithmetic with the page as the rect.
 */
export function stageView(box: ContainerBox, rect: Rect | null | undefined): StageView {
  if (box.width <= 0 || box.height <= 0) {
    return { scale: 0, offsetX: 0, offsetY: 0, width: 0, height: 0 }
  }
  const shown = !rect || rect.width <= 0 || rect.height <= 0 ? FULL_SLIDE : rect
  const scale = Math.min(box.width / shown.width, box.height / shown.height)
  // `-0` is the same number as `0` everywhere except in an equality check, and
  // the whole-slide view is the case that produces it.
  const offset = (value: number): number => (value === 0 ? 0 : -value * scale)
  return {
    scale,
    offsetX: offset(shown.x),
    offsetY: offset(shown.y),
    width: shown.width * scale,
    height: shown.height * scale,
  }
}
