/**
 * How big a page is drawn in the slide overview.
 *
 * The rule is about the box and nothing else — no breakpoint, no device, no
 * orientation flag. A tall narrow panel gets one full-width page; a short wide
 * one gets several smaller ones; and the desktop's column, which is neither,
 * gets exactly what it always had.
 */

import { describe, expect, it } from 'vitest'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { stripLayout } from './Filmstrip'

/** How tall a thumbnail of this width is drawn. */
function heightOf(width: number): number {
  return (width * SLIDE_HEIGHT) / SLIDE_WIDTH
}

describe('stripLayout', () => {
  it('fills a phone held upright with one page per row', () => {
    // A portrait panel: the whole screen width, the whole screen height.
    const layout = stripLayout({ width: 392, height: 700 })
    expect(layout.columns).toBe(1)
    expect(layout.width).toBeCloseTo(392, 6)
  })

  it('uses the width of a phone on its side instead of wasting it', () => {
    const box = { width: 872, height: 230 }
    const layout = stripLayout(box)
    expect(layout.columns).toBeGreaterThan(1)
    // Every page still fits the panel with room to see the next row under it.
    expect(heightOf(layout.width)).toBeLessThan(box.height)
    expect(layout.columns * layout.width).toBeLessThanOrEqual(box.width)
  })

  it('never draws a page smaller than the desktop strip draws it', () => {
    for (const height of [120, 230, 400, 900]) {
      expect(stripLayout({ width: 872, height }).width).toBeGreaterThanOrEqual(168)
    }
  })

  it('answers with one desktop-sized page before anything has been measured', () => {
    expect(stripLayout({ width: 0, height: 0 })).toEqual({ columns: 1, width: 168 })
  })

  it('leaves a column too narrow to divide as one column', () => {
    const layout = stripLayout({ width: 212, height: 800 })
    expect(layout.columns).toBe(1)
    expect(layout.width).toBeCloseTo(212, 6)
  })
})
