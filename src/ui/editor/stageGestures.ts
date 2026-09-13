/**
 * The finger gestures the slide area answers, in one place.
 *
 * Two of them, and they are told apart by how many fingers are down rather than
 * by anything about the device:
 *
 *  - **one finger across the slide** turns the page, the same way pressing a
 *    thumbnail in the overview does;
 *  - **two fingers** change the view transform — pinch to magnify, move
 *    together to pan — and a single finger joins them once the view is
 *    magnified, because there is then somewhere to pan to.
 *
 * Everything is pointer events. There is no touch code path and no mouse code
 * path, so a narrow desktop window behaves like a phone because it *is* the
 * same code, and a stylus or a trackpad is neither special-cased nor excluded.
 *
 * What the recogniser will not touch is as much of the contract as what it
 * will. A press that belongs to something else — a button, a link, a field
 * being typed in, a running miniapp — is left entirely alone, so the gesture
 * can never make an ordinary control unreliable.
 */

import { useCallback, useEffect, useRef } from 'react'
import { isInteractiveRuntimeActive } from '../../state/interactiveRuntime'

/**
 * How far a finger has to travel before it meant to turn the page.
 *
 * Well past a tap's wobble and well short of the width of the narrowest phone
 * this runs on, so one deliberate flick is one slide and a press that drifts is
 * still a press.
 */
export const SWIPE_MIN_DISTANCE = 56

/**
 * And how much more sideways than up-and-down it has to be.
 *
 * A hand sweeping across a phone always rises or falls a little. What separates
 * a page turn from a vertical drag is not that the vertical part is zero but
 * that it is clearly the smaller of the two.
 */
export const SWIPE_DIRECTION_RATIO = 1.6

/** Which way a completed drag went, or `null` when it was not a swipe at all. */
export function swipeDirection(dx: number, dy: number): 1 | -1 | null {
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTION_RATIO) return null
  return dx > 0 ? 1 : -1
}

/**
 * Things a press belongs to rather than to the slide area.
 *
 * The same idea the presentation player states for its own swipe: a control is
 * a control wherever it is drawn, a field being typed in owns its caret and its
 * selection, and a running miniapp owns everything inside its frame. Listed
 * once here so the editor cannot disagree with itself about it, and open for
 * any surface to join with `data-owns-gesture`.
 */
export const OWNS_ITS_GESTURE = [
  'a',
  'button',
  '[role="button"]',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '.interactive-runtime',
  '[data-owns-gesture]',
].join(', ')

function ownsItsGesture(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OWNS_ITS_GESTURE) !== null
}

/** Two fingers, as the view transform needs them. */
export interface PinchGesture {
  /** How much further apart the fingers got since the last move. */
  factor: number
  /** Where they are now, in client coordinates … */
  x: number
  y: number
  /** … and where they were, so the caller can anchor on what was grabbed. */
  previousX: number
  previousY: number
}

export interface StageGestureOptions {
  /**
   * Whether the surface is listening at all. False while something else owns
   * the screen — a magnified view under a swipe, a field being typed in.
   */
  enabled?: boolean
  /** A decisive horizontal flick: `1` to the right, `-1` to the left. */
  onSwipe?: (direction: 1 | -1) => void
  onPinch?: (gesture: PinchGesture) => void
  /** A drag that moves the view rather than the deck, in CSS pixels. */
  onPan?: (dx: number, dy: number) => void
  /** Whether one finger pans. False while one finger still means a page turn. */
  panWithOnePointer?: boolean
}

interface Tracked {
  id: number
  x: number
  y: number
}

interface GestureState {
  pointers: Tracked[]
  /** The single-finger candidate: where it began, and whether it is still one. */
  swipe: { id: number; x: number; y: number; alive: boolean } | null
  /** The two-finger state: how far apart and where, at the last move. */
  pinch: { distance: number; x: number; y: number } | null
  /** The finger that is dragging the view, and where it was last. */
  pan: { id: number; x: number; y: number } | null
}

function distanceBetween(a: Tracked, b: Tracked): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Attach the recogniser to one surface.
 *
 * Only `pointerdown` is a React handler; the rest of the gesture is followed on
 * the window. That is what lets a flick finish past the edge of the stage, and
 * it keeps the React handler free to do the one thing only it can do — decide,
 * by propagation, whether this press was the slide area's at all.
 */
export function useStageGestures(options: StageGestureOptions): {
  onPointerDown: (event: React.PointerEvent) => void
} {
  const latest = useRef(options)
  // Written after the render rather than during it: a gesture is handled from
  // an event, which is always later than the paint that set this.
  useEffect(() => {
    latest.current = options
  })

  const state = useRef<GestureState | null>(null)
  const detach = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    state.current = null
    detach.current?.()
    detach.current = null
  }, [])

  useEffect(() => stop, [stop])

  /**
   * Swallow the click the browser sends after a swipe.
   *
   * A flick ends with a `pointerup` like any press, and the click that follows
   * would land on whatever the finger happened to stop over — on the slide that
   * has just been turned to. One capture-phase listener, used once.
   */
  const swallowNextClick = useCallback(() => {
    const swallow = (event: MouseEvent): void => {
      event.stopPropagation()
      event.preventDefault()
      window.removeEventListener('click', swallow, true)
      clearTimeout(timer)
    }
    // If no click follows — a stylus, a cancelled sequence — the listener must
    // not survive to eat an unrelated one.
    const timer = setTimeout(() => window.removeEventListener('click', swallow, true), 400)
    window.addEventListener('click', swallow, true)
  }, [])

  const begin = useCallback(() => {
    if (detach.current) return

    const move = (event: PointerEvent): void => {
      const current = state.current
      if (!current) return
      const moved = current.pointers.find((pointer) => pointer.id === event.pointerId)
      if (!moved) return
      const pointers = current.pointers.map((pointer) =>
        pointer.id === event.pointerId
          ? { id: pointer.id, x: event.clientX, y: event.clientY }
          : pointer,
      )

      const { onPinch, onPan } = latest.current
      if (pointers.length >= 2 && current.pinch) {
        const [a, b] = pointers
        const pinch = { distance: distanceBetween(a, b), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const previous = current.pinch
        state.current = { ...current, pointers, pinch }
        if (previous.distance > 0 && pinch.distance > 0) {
          onPinch?.({
            factor: pinch.distance / previous.distance,
            x: pinch.x,
            y: pinch.y,
            previousX: previous.x,
            previousY: previous.y,
          })
        }
        return
      }

      if (current.pan && current.pan.id === event.pointerId) {
        const dx = event.clientX - current.pan.x
        const dy = event.clientY - current.pan.y
        state.current = {
          ...current,
          pointers,
          pan: { id: event.pointerId, x: event.clientX, y: event.clientY },
        }
        onPan?.(dx, dy)
        return
      }

      state.current = { ...current, pointers }
    }

    const finish = (event: PointerEvent): void => {
      const current = state.current
      if (!current) return
      const ended = current.pointers.find((pointer) => pointer.id === event.pointerId)
      const pointers = current.pointers.filter((pointer) => pointer.id !== event.pointerId)
      const swipe = current.swipe
      state.current = {
        pointers,
        swipe: swipe && swipe.id === event.pointerId ? null : swipe,
        pinch: pointers.length < 2 ? null : current.pinch,
        pan: current.pan?.id === event.pointerId ? null : current.pan,
      }

      if (swipe && swipe.id === event.pointerId && swipe.alive && ended && event.type === 'pointerup') {
        const direction = swipeDirection(ended.x - swipe.x, ended.y - swipe.y)
        if (direction) {
          swallowNextClick()
          latest.current.onSwipe?.(direction)
        }
      }
      if (pointers.length === 0) stop()
    }

    const cancel = (): void => stop()

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', cancel)
    detach.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', cancel)
    }
  }, [stop, swallowNextClick])

  const onPointerDown = useCallback(
    (event: React.PointerEvent): void => {
      const { enabled = true, onSwipe, onPinch, onPan, panWithOnePointer } = latest.current
      if (!enabled) return
      // While a miniapp runs, every gesture on the page is the app's.
      if (isInteractiveRuntimeActive()) return
      if (ownsItsGesture(event.target)) return
      if (event.pointerType === 'mouse' && event.button !== 0) return

      const previous = state.current
      if (previous?.pointers.some((pointer) => pointer.id === event.pointerId)) return
      const down = { id: event.pointerId, x: event.clientX, y: event.clientY }
      const pointers = [...(previous?.pointers ?? []), down]

      if (pointers.length === 1) {
        state.current = {
          pointers,
          swipe: onSwipe ? { ...down, alive: true } : null,
          pinch: null,
          pan: onPan && panWithOnePointer ? down : null,
        }
      } else {
        const [a, b] = pointers
        state.current = {
          pointers,
          // A second finger means this was never a page turn.
          swipe: previous?.swipe ? { ...previous.swipe, alive: false } : null,
          pinch:
            onPinch && pointers.length === 2
              ? { distance: distanceBetween(a, b), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
              : (previous?.pinch ?? null),
          // Two fingers pan together; one of two fingers pans nothing.
          pan: null,
        }
      }

      begin()
    },
    [begin],
  )

  return { onPointerDown }
}
