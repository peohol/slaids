/**
 * The slide area's gestures, as a user performs them.
 *
 * Written against the hook rather than against its arithmetic, because the
 * arithmetic was never the risk: what breaks a gesture recogniser is a press
 * that should have been left alone, a second finger arriving mid-flick, or a
 * drag that was really a scroll. All three are sequences of pointer events, so
 * that is what these tests are.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useInteractiveRuntime } from '../../state/interactiveRuntime'
import { swipeDirection, useStageGestures, type StageGestureOptions } from './stageGestures'

function Surface(options: StageGestureOptions) {
  const gestures = useStageGestures(options)
  return (
    <div data-testid="surface" onPointerDown={gestures.onPointerDown}>
      <span data-testid="text">Tekst på sliden</span>
      <button type="button" data-testid="control">
        Fokuser sonen
      </button>
    </div>
  )
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

function mount(options: StageGestureOptions): void {
  act(() => root!.render(<Surface {...options} />))
}

function at(testId: string): HTMLElement {
  return container!.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
}

function down(target: HTMLElement, x: number, y: number, pointerId = 1): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId }),
    )
  })
}

function move(x: number, y: number, pointerId = 1): void {
  act(() => {
    window.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId }),
    )
  })
}

function up(x: number, y: number, pointerId = 1): void {
  act(() => {
    window.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId }),
    )
  })
}

/** One finger from `(x, y)` to `(x + dx, y + dy)`, in a few steps. */
function drag(target: HTMLElement, x: number, y: number, dx: number, dy: number): void {
  down(target, x, y)
  for (const step of [0.3, 0.7, 1]) {
    move(x + dx * step, y + dy * step)
  }
  up(x + dx, y + dy)
}

describe('swipeDirection', () => {
  it('reads a decisive sideways flick, and only a decisive one', () => {
    expect(swipeDirection(120, 10)).toBe(1)
    expect(swipeDirection(-120, 10)).toBe(-1)
    // A tap that wobbled.
    expect(swipeDirection(9, 3)).toBeNull()
    // A drag down the page that drifted sideways.
    expect(swipeDirection(60, 200)).toBeNull()
    // Diagonal, but mostly sideways: still a page turn.
    expect(swipeDirection(140, 60)).toBe(1)
  })
})

describe('useStageGestures', () => {
  it('turns the page forwards on a swipe to the right, back on one to the left', () => {
    const onSwipe = vi.fn()
    mount({ onSwipe })
    drag(at('surface'), 100, 200, 180, 12)
    expect(onSwipe).toHaveBeenCalledWith(1)

    onSwipe.mockClear()
    drag(at('surface'), 300, 200, -180, -12)
    expect(onSwipe).toHaveBeenCalledWith(-1)
  })

  it('moves exactly one page per gesture, however long the flick', () => {
    const onSwipe = vi.fn()
    mount({ onSwipe })
    drag(at('surface'), 40, 200, 800, 0)
    expect(onSwipe).toHaveBeenCalledTimes(1)
  })

  it('leaves a tap and a vertical drag alone', () => {
    const onSwipe = vi.fn()
    mount({ onSwipe })
    drag(at('surface'), 100, 200, 4, 2)
    drag(at('surface'), 100, 200, 0, 260)
    // A scroll that drifted sideways is still a scroll.
    drag(at('surface'), 100, 200, 70, 240)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('never touches a press that belongs to a control or to a field', () => {
    const onSwipe = vi.fn()
    mount({ onSwipe })
    drag(at('control'), 100, 200, 200, 0)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('stands aside entirely while a miniapp is running', () => {
    const onSwipe = vi.fn()
    mount({ onSwipe })
    const token = useInteractiveRuntime.getState().begin('slide-1')
    drag(at('surface'), 100, 200, 220, 0)
    expect(onSwipe).not.toHaveBeenCalled()
    act(() => useInteractiveRuntime.getState().end(token))
    drag(at('surface'), 100, 200, 220, 0)
    expect(onSwipe).toHaveBeenCalledTimes(1)
  })

  it('is not a page turn once a second finger arrives', () => {
    const onSwipe = vi.fn()
    const onPinch = vi.fn()
    mount({ onSwipe, onPinch })
    const surface = at('surface')
    down(surface, 100, 200, 1)
    down(surface, 140, 200, 2)
    move(260, 200, 2)
    up(300, 200, 1)
    up(260, 200, 2)
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onPinch).toHaveBeenCalled()
  })

  it('reports how much two fingers spread, and where they are', () => {
    const onPinch = vi.fn()
    mount({ onPinch })
    const surface = at('surface')
    down(surface, 100, 100, 1)
    down(surface, 200, 100, 2)
    move(300, 100, 2)

    expect(onPinch).toHaveBeenCalledTimes(1)
    const gesture = onPinch.mock.calls[0][0]
    // The fingers went from 100 apart to 200 apart.
    expect(gesture.factor).toBeCloseTo(2, 6)
    // Their midpoint moved with them, and the caller is told both ends of it so
    // it can anchor on what was grabbed.
    expect(gesture.previousX).toBeCloseTo(150, 6)
    expect(gesture.x).toBeCloseTo(200, 6)
  })

  it('pans with one finger only where there is somewhere to pan', () => {
    const onPan = vi.fn()
    mount({ onPan, panWithOnePointer: false })
    drag(at('surface'), 100, 200, 90, 40)
    expect(onPan).not.toHaveBeenCalled()

    mount({ onPan, panWithOnePointer: true })
    down(at('surface'), 100, 200)
    move(130, 220)
    expect(onPan).toHaveBeenCalledWith(30, 20)
    up(130, 220)
  })

  it('hears nothing at all when it is switched off', () => {
    const onSwipe = vi.fn()
    mount({ onSwipe, enabled: false })
    drag(at('surface'), 100, 200, 220, 0)
    expect(onSwipe).not.toHaveBeenCalled()
  })
})
