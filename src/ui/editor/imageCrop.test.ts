/**
 * The crop arithmetic, checked against what `object-fit: cover` actually does.
 *
 * The browser decides the crop; this file only re-derives it, so the ghost of
 * the hidden parts lines up with the visible picture and a drag moves the file
 * by the distance the pointer moved. Getting it wrong is invisible until
 * somebody drags — which is why it is pinned down here rather than left to a
 * screenshot.
 */

import { describe, expect, it } from 'vitest'
import { IMAGE_FOCUS_SNAP_PX } from '../../domain/constants'
import { coverGeometry, isCropped } from '../../domain/imageGeometry'
import { focusAfterDrag } from './EditableImagePanel'

const frame = { width: 400, height: 300 }

describe('coverGeometry', () => {
  it('scales until the file covers the frame, and reports what that hides', () => {
    // Wider than the frame: the height matches exactly and the sides are hidden.
    const wide = coverGeometry(frame, { width: 800, height: 300 })
    expect(wide).toMatchObject({ width: 800, height: 300, overflowY: 0 })
    expect(wide?.overflowX).toBe(400)

    // Taller than the frame: the mirror image.
    const tall = coverGeometry(frame, { width: 400, height: 800 })
    expect(tall).toMatchObject({ width: 400, height: 800, overflowX: 0 })
    expect(tall?.overflowY).toBe(500)
  })

  it('hides nothing when the file matches the frame\'s proportions', () => {
    const same = coverGeometry(frame, { width: 1600, height: 1200 })
    expect(same).toMatchObject({ overflowX: 0, overflowY: 0 })
    expect(isCropped(same)).toBe(false)
  })

  it('answers nothing for a box or a file with no size', () => {
    expect(coverGeometry(frame, { width: 0, height: 300 })).toBeNull()
    expect(coverGeometry({ width: 0, height: 0 }, { width: 8, height: 6 })).toBeNull()
    expect(isCropped(null)).toBe(false)
  })
})

describe('focusAfterDrag', () => {
  const geometry = { scale: 1, width: 800, height: 300, overflowX: 400, overflowY: 0 }
  const centre = { x: 0.5, y: 0.5 }

  it('moves the file with the pointer', () => {
    // Dragging left pulls the file left, which shows more of its right side.
    const left = focusAfterDrag(centre, { x: -100, y: 0 }, geometry)
    expect(left.x).toBeCloseTo(0.75)
    const right = focusAfterDrag(centre, { x: 100, y: 0 }, geometry)
    expect(right.x).toBeCloseTo(0.25)
  })

  it('stops at the edges of the file', () => {
    expect(focusAfterDrag(centre, { x: -10_000, y: 0 }, geometry).x).toBe(1)
    expect(focusAfterDrag(centre, { x: 10_000, y: 0 }, geometry).x).toBe(0)
  })

  it('snaps back to the middle so a centred crop can be found again by hand', () => {
    const nudge = focusAfterDrag(centre, { x: IMAGE_FOCUS_SNAP_PX - 1, y: 0 }, geometry)
    expect(nudge.x).toBe(0.5)

    const past = focusAfterDrag(centre, { x: IMAGE_FOCUS_SNAP_PX + 20, y: 0 }, geometry)
    expect(past.x).not.toBe(0.5)
  })

  it('leaves an axis with nothing hidden centred, whatever the pointer does', () => {
    // There is no room to move on that axis, so a drag along it means nothing.
    expect(focusAfterDrag(centre, { x: 0, y: -200 }, geometry).y).toBe(0.5)
  })
})
