/**
 * How a picture lies behind the frame it fills.
 *
 * `object-fit: cover` decides the crop on screen: the file is scaled until it
 * covers the frame in both directions, and `object-position` — the panel's
 * `focus` — chooses which part of the overflow is hidden. This module
 * re-derives exactly that arithmetic, once, for everything that has to agree
 * with the browser about it: the editor's ghost of the hidden parts and its
 * drag (`EditableImagePanel`), and the optimiser, which has to know which
 * source pixels are on screen before it may throw the rest away
 * (`imageOptimization.ts`).
 *
 * Pure and headless, like `geometry.ts`: a frame and a file size in, numbers
 * out, in whatever unit the frame was given in.
 */

import type { Rect } from './types'

export interface Size {
  width: number
  height: number
}

/** How the file is laid out behind the frame, in the frame's own pixels. */
export interface CoverGeometry {
  /** The factor the file is scaled by: frame pixels per file pixel. */
  scale: number
  /** Rendered size of the whole file once scaled to cover the frame. */
  width: number
  height: number
  /** How much of it is hidden, per axis. Zero on the axis that fits exactly. */
  overflowX: number
  overflowY: number
}

/** The scale `cover` applies: the larger of the two ratios, so both axes are filled. */
export function coverScale(frame: Size, natural: Size): number {
  return Math.max(frame.width / natural.width, frame.height / natural.height)
}

export function coverGeometry(frame: Size, natural: Size): CoverGeometry | null {
  if (natural.width <= 0 || natural.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return null
  }
  const scale = coverScale(frame, natural)
  const width = natural.width * scale
  const height = natural.height * scale
  return {
    scale,
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
 * The part of the file the frame is over, in the file's own pixels.
 *
 * The frame shows `frame.width × frame.height` of the scaled file, offset into
 * the overflow by the focus — `0` keeps the top/left edge, `1` the bottom/right
 * — so dividing that window by the scale gives the rectangle of source pixels
 * that are actually on screen. Fractional on purpose: the frame is laid out in
 * logical pixels and the file rarely lands on whole ones, and rounding here
 * would be a second rounding on top of whatever the caller does with the answer.
 *
 * `null` for a frame or a file with no size, exactly as `coverGeometry` is.
 */
export function visibleSourceRect(
  frame: Size,
  focus: { x: number; y: number },
  natural: Size,
): Rect | null {
  const geometry = coverGeometry(frame, natural)
  if (!geometry) return null
  return {
    x: (geometry.overflowX * focus.x) / geometry.scale,
    y: (geometry.overflowY * focus.y) / geometry.scale,
    width: frame.width / geometry.scale,
    height: frame.height / geometry.scale,
  }
}
