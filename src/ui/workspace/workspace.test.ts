import { describe, expect, it } from 'vitest'
import {
  COMPACT_MAX_HEIGHT,
  COMPACT_MAX_WIDTH,
  KEYBOARD_INSET_THRESHOLD,
  deriveWorkspace,
  type WorkspaceMetrics,
} from './workspace'

function metrics(overrides: Partial<WorkspaceMetrics> = {}): WorkspaceMetrics {
  return {
    width: 1600,
    height: 1000,
    visibleTop: 0,
    visibleHeight: 1000,
    coarse: false,
    ...overrides,
  }
}

describe('deriveWorkspace', () => {
  it('keeps a roomy window on the desktop layout', () => {
    const workspace = deriveWorkspace(metrics())
    expect(workspace.compact).toBe(false)
    expect(workspace.orientation).toBe('landscape')
  })

  /*
   * The two facts are independent on purpose, and these two cases are the
   * whole reason for that. A narrow desktop window has a mouse and no room; a
   * big tablet has room and no mouse. Deciding either from a user agent would
   * get both of them wrong.
   */
  it('is compact on a narrow window even with a fine pointer', () => {
    const workspace = deriveWorkspace(metrics({ width: COMPACT_MAX_WIDTH, height: 900 }))
    expect(workspace.compact).toBe(true)
    expect(workspace.coarse).toBe(false)
  })

  it('is roomy on a large tablet even with a coarse pointer', () => {
    const workspace = deriveWorkspace(metrics({ width: 1180, height: 820, coarse: true }))
    expect(workspace.compact).toBe(false)
    expect(workspace.coarse).toBe(true)
  })

  it('is compact when the window is short, whatever its width', () => {
    expect(deriveWorkspace(metrics({ width: 1600, height: COMPACT_MAX_HEIGHT })).compact).toBe(true)
    expect(deriveWorkspace(metrics({ width: 1600, height: COMPACT_MAX_HEIGHT + 1 })).compact).toBe(
      false,
    )
  })

  it('calls a phone portrait and the same phone landscape', () => {
    expect(deriveWorkspace(metrics({ width: 412, height: 892 })).orientation).toBe('portrait')
    expect(deriveWorkspace(metrics({ width: 892, height: 412 })).orientation).toBe('landscape')
  })

  /*
   * Browser chrome sliding away changes the visual viewport by a few dozen
   * pixels on its own; treating that as a keyboard would make the toolbars
   * jump while somebody was merely scrolling.
   */
  it('reports a keyboard only once something substantial covers the page', () => {
    const small = deriveWorkspace(
      metrics({ height: 892, visibleHeight: 892 - (KEYBOARD_INSET_THRESHOLD - 1) }),
    )
    expect(small.keyboardOpen).toBe(false)
    expect(small.keyboardInset).toBe(KEYBOARD_INSET_THRESHOLD - 1)

    const real = deriveWorkspace(metrics({ height: 892, visibleHeight: 892 - 380 }))
    expect(real.keyboardOpen).toBe(true)
    expect(real.keyboardInset).toBe(380)
  })

  it('never reports a negative inset when the visible area is the larger number', () => {
    expect(deriveWorkspace(metrics({ height: 800, visibleHeight: 900 })).keyboardInset).toBe(0)
  })

  /*
   * The rule that keeps the editor still while somebody types.
   *
   * A keyboard covers part of the page without making the window smaller, so
   * it must not be able to decide which shell is mounted — a shell that swapped
   * for it would unmount the very field the caret is in. Which is why `compact`
   * reads the layout viewport and the keyboard is the difference between the
   * two heights.
   */
  /*
   * A `position: fixed` box is anchored to the layout viewport whatever the
   * keyboard is doing, so anything that must stay reachable needs to know where
   * the visible band *is* — not only how tall it is.
   */
  it('says how far the visible band stands off the bottom of the page', () => {
    const covered = deriveWorkspace(metrics({ height: 892, visibleTop: 0, visibleHeight: 492 }))
    expect(covered.visibleBottomGap).toBe(400)

    // Scrolled as well as covered: the band has moved down, so less of it is
    // below than the covered height alone suggests.
    const scrolled = deriveWorkspace(metrics({ height: 892, visibleTop: 120, visibleHeight: 492 }))
    expect(scrolled.visibleBottomGap).toBe(280)

    // Nothing covering anything: nothing to stand off by.
    expect(deriveWorkspace(metrics()).visibleBottomGap).toBe(0)
  })

  it('lets a keyboard change nothing about which shell applies', () => {
    const roomy = metrics({ width: 1180, height: 820, visibleHeight: 820, coarse: true })
    const typing = { ...roomy, visibleHeight: 460 }

    expect(deriveWorkspace(roomy).compact).toBe(false)
    expect(deriveWorkspace(typing).compact).toBe(false)
    expect(deriveWorkspace(typing).orientation).toBe(deriveWorkspace(roomy).orientation)
    // Noticed, though: that is what the bottom bars size themselves against.
    expect(deriveWorkspace(typing).keyboardOpen).toBe(true)
  })

  it('does the same on a surface that is already compact', () => {
    const phone = metrics({ width: 412, height: 892, visibleHeight: 892, coarse: true })
    const typing = { ...phone, visibleHeight: 420 }
    expect(deriveWorkspace(phone).compact).toBe(true)
    expect(deriveWorkspace(typing).compact).toBe(true)
  })
})
