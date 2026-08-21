/**
 * The area a floating window is held inside.
 *
 * A window may cover the editor body but never the toolbars, and it may only go
 * where the screen actually is — a phone keyboard shrinks the visual viewport
 * without touching the layout, so the two are not the same area. The window has
 * to respect both, which makes the answer their overlap, and this is the
 * arithmetic that decides it.
 */

import { describe, expect, it } from 'vitest'
import { intersectBounds } from './FloatingWindow'

const body = { left: 0, top: 92, right: 1600, bottom: 964 }

describe('intersectBounds', () => {
  it('is the editor body when the whole window is on screen', () => {
    expect(intersectBounds(body, { left: 0, top: 0, right: 1600, bottom: 1000 })).toEqual(body)
  })

  it('cuts the bottom away when a keyboard covers it', () => {
    // The layout viewport is untouched; only the visual one shrinks. Taking the
    // body alone would leave the window's own footer behind the keyboard.
    const keyboard = { left: 0, top: 0, right: 1600, bottom: 620 }
    expect(intersectBounds(body, keyboard)).toEqual({ left: 0, top: 92, right: 1600, bottom: 620 })
  })

  it('follows the viewport when the browser scrolls the page to reveal the caret', () => {
    const scrolled = { left: 0, top: 140, right: 1600, bottom: 700 }
    expect(intersectBounds(body, scrolled)).toEqual({ left: 0, top: 140, right: 1600, bottom: 700 })
  })

  it('comes out empty when the two do not meet, rather than inside out', () => {
    const gone = { left: 0, top: 0, right: 1600, bottom: 50 }
    const result = intersectBounds(body, gone)
    // The caller reads this as "nothing to measure against" and leaves the
    // window where it is, instead of placing it somewhere impossible.
    expect(result.bottom - result.top).toBeLessThanOrEqual(0)
  })
})
