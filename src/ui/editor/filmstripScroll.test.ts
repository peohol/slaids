/**
 * Where the strip scrolls to keep the shown page in the middle.
 *
 * The rule is "centre it, unless the list cannot scroll that far": the ends of
 * the deck stay where they are, and everything else is in the middle.
 */

import { describe, expect, it } from 'vitest'
import { centredScrollTop, type ScrollGeometry } from './Filmstrip'

/** A list of `count` entries, each `step` tall, scrolled to `scrollTop`. */
function geometryOf(index: number, scrollTop: number, count = 20, step = 120): ScrollGeometry {
  return {
    scrollTop,
    viewHeight: 600,
    contentHeight: count * step,
    itemTop: index * step - scrollTop,
    itemHeight: step,
  }
}

describe('centredScrollTop', () => {
  it('puts an entry in the middle of the box wherever the list was scrolled', () => {
    for (const scrollTop of [0, 300, 1800]) {
      const geometry = geometryOf(10, scrollTop)
      const top = centredScrollTop(geometry)
      const centreAfter = geometry.itemTop + scrollTop - top + geometry.itemHeight / 2
      expect(centreAfter).toBeCloseTo(geometry.viewHeight / 2, 6)
    }
  })

  it('stops at the top of the list instead of scrolling past it', () => {
    expect(centredScrollTop(geometryOf(0, 500))).toBe(0)
    expect(centredScrollTop(geometryOf(1, 0))).toBe(0)
  })

  it('stops at the bottom of the list instead of scrolling past it', () => {
    const last = geometryOf(19, 0)
    expect(centredScrollTop(last)).toBe(last.contentHeight - last.viewHeight)
  })

  it('never scrolls a list that fits in its box', () => {
    expect(centredScrollTop(geometryOf(2, 0, 3))).toBe(0)
  })
})
