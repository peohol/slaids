/**
 * Dragging a row into a new place, as a gesture rather than as a sortable list.
 *
 * This is the ideas window's drag behaviour, lifted out whole the first time a
 * second list needed it. It is deliberately not dnd-kit: a press-and-hold on
 * touch, a few pixels of movement on a mouse, a placeholder that shows the gap,
 * a lifted element that follows the pointer and a list that scrolls at its
 * edges is a *feel*, and the feel is the part that would drift if two lists
 * each grew their own.
 *
 * What it does not decide is the outcome. It says which container the row was
 * dropped in and where in it — the same index the caller's own model reads —
 * and the caller's domain command does the rest. So the ideas list still moves
 * ideas between categories and the deposit still renumbers its pictures, from
 * one gesture that knows about neither.
 *
 * Three things a caller supplies, and they are the whole of the configuration:
 *
 *  - `scrollParent` — the element the list scrolls inside. Edge autoscroll and
 *    the «is the pointer still over the list» test are both about it.
 *  - `containerFor` — which element the placeholder may go into, given what is
 *    under the pointer. A flat list answers «the list»; the ideas window
 *    answers «that category, or the root» and that is the only place nesting
 *    lives.
 *  - `onDrop` — what to do about it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * Drag thresholds. On touch the drag waits out a hold, so that a vertical swipe
 * still scrolls the list; on a mouse it starts as soon as the pointer has moved
 * a little with the button down. The distance is measured as the crow flies
 * from the press, so a diagonal counts as much as a straight one.
 *
 * Exported because they are the feel of every drag surface that also answers
 * a click, not of this gesture alone: the filmstrip's dnd-kit sensor reads the
 * same numbers (see `dragActivation.ts`), so the two cannot drift apart.
 */
export const DRAG_THRESHOLDS = {
  /** How long a finger has to rest before the press becomes a drag. */
  holdMs: 200,
  /** How far a finger may wander during the hold before it is a swipe instead. */
  holdMove: 10,
  /** How far a mouse has to move with the button down before it is a drag. */
  mouseMove: 5,
} as const
const { holdMs: HOLD_MS, holdMove: HOLD_MOVE, mouseMove: HOLD_MOVE_MOUSE } = DRAG_THRESHOLDS

/** The zone at the top and bottom of the list that scrolls while you drag over it. */
const SCROLL_EDGE = 30
const SCROLL_STEP = 10

/** Where a lifted row was let go. */
export interface ReorderDrop {
  /** The row that was dragged, named by whatever the caller called it. */
  rowId: string
  /** The container it landed in: exactly what `containerFor` returned. */
  container: HTMLElement
  /** Its place inside that container, with the lifted row itself counted out. */
  index: number
}

export interface ReorderOptions {
  /** The scrolling element the list sits in. */
  scrollParent: () => HTMLElement | null
  /**
   * Which container the placeholder may go into, given the element under the
   * pointer and the element being dragged. `null` leaves the placeholder where
   * it is, which is what a pointer outside the list should do.
   *
   * Omitted, the row stays in the container it started in.
   */
  containerFor?: (under: Element, dragged: HTMLElement) => HTMLElement | null
  /** Whether a drag may start at all right now — an open editor says no. */
  canStart?: () => boolean
  /** The class the placeholder element carries, so the caller styles the gap. */
  placeholderClass: string
  /** The tag the placeholder is, so it is a legal child of its container. */
  placeholderTag?: 'li' | 'div'
  onDrop: (drop: ReorderDrop) => void
}

interface Drag {
  rowId: string
  el: HTMLElement
  placeholder: HTMLElement
  pointerId: number
  grabX: number
  grabY: number
  /**
   * Where `left: 0; top: 0` actually puts the lifted element, in the viewport.
   *
   * Zero for a row lifted out of an ordinary ancestor, and *not* zero inside a
   * dialog: a `transform` anywhere above makes that ancestor the containing
   * block for `position: fixed`, so viewport coordinates written into `left`
   * and `top` would be measured from the dialog's corner instead of the
   * screen's — and the card would fly off to one side of the pointer. Measured
   * once, at the moment of lifting, rather than assumed either way.
   */
  originX: number
  originY: number
  x: number
  y: number
  stop: () => void
}

export interface Reorder {
  /**
   * Arm a drag on a row: press-and-hold on touch, movement with the button down
   * on a mouse.
   *
   * `dragEl` is what gets lifted, which is not always the element the press
   * landed on — a category is dragged by its heading, with its contents.
   * `except` is a selector for the parts of the row that are not a handle.
   */
  arm: (
    event: React.PointerEvent,
    rowId: string,
    dragEl: HTMLElement | null,
    except?: string,
  ) => void
  /** Swallow the click a finished drag would otherwise deliver to the row. */
  swallowClick: (event: React.MouseEvent) => void
  /** End a drag that is still running. Safe to call when there is none. */
  cancel: () => void
  /** Whether a row is in the air right now. */
  dragging: boolean
}

export function useReorderDrag(options: ReorderOptions): Reorder {
  /* The options are read at gesture time, not at render time: a caller that
     rebuilds its callbacks every render must not rebuild the gesture, or a
     drag that started before a keystroke would be listening on stale handlers. */
  const optionsRef = useRef(options)
  const dragRef = useRef<Drag | null>(null)
  const scrollFrameRef = useRef(0)
  /** A finished drag swallows the click that would otherwise follow it. */
  const draggedRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    optionsRef.current = options
  })

  const moveDragged = useCallback((): void => {
    const drag = dragRef.current
    if (!drag) return
    drag.el.style.left = `${drag.x - drag.grabX - drag.originX}px`
    drag.el.style.top = `${drag.y - drag.grabY - drag.originY}px`
  }, [])

  /**
   * Put the placeholder where the row would land if you let go now.
   *
   * Within the container the row goes before the first neighbour the pointer is
   * past the middle of — and last if it is below all of them.
   */
  const placePlaceholder = useCallback((): void => {
    const drag = dragRef.current
    const body = optionsRef.current.scrollParent()
    if (!drag || !body) return
    const under = document.elementFromPoint(drag.x, drag.y)
    // Outside the list the placeholder stays put, so a drag that swings out of
    // the window does not lose the place you were aiming at.
    if (!under || !body.contains(under)) return

    const container =
      optionsRef.current.containerFor?.(under, drag.el) ?? drag.el.parentElement
    if (!container) return

    let before: Element | null = null
    for (const child of container.children) {
      if (child === drag.placeholder || child === drag.el) continue
      const rect = child.getBoundingClientRect()
      if (drag.y < rect.top + rect.height / 2) {
        before = child
        break
      }
    }
    if (
      drag.placeholder.parentNode === container &&
      drag.placeholder.nextElementSibling === before
    ) {
      return
    }
    container.insertBefore(drag.placeholder, before)
  }, [])

  /** How many pixels the list should scroll now: 0 outside the edge zones. */
  const edgeStep = useCallback((): number => {
    const drag = dragRef.current
    const body = optionsRef.current.scrollParent()
    if (!drag || !body) return 0
    const box = body.getBoundingClientRect()
    if (drag.y < box.top + SCROLL_EDGE && body.scrollTop > 0) return -SCROLL_STEP
    const rest = body.scrollHeight - body.clientHeight - body.scrollTop
    if (drag.y > box.bottom - SCROLL_EDGE && rest > 0) return SCROLL_STEP
    return 0
  }, [])

  /** Keep the list rolling for as long as the pointer sits in an edge zone. */
  const autoScroll = useCallback((): void => {
    if (scrollFrameRef.current || !edgeStep()) return
    const tick = (): void => {
      scrollFrameRef.current = 0
      const body = optionsRef.current.scrollParent()
      if (!dragRef.current || !body) return
      const step = edgeStep()
      if (!step) return
      body.scrollTop += step
      // The rows have moved under the pointer, so the place has to be worked out
      // again even though nothing was moved.
      placePlaceholder()
      scrollFrameRef.current = requestAnimationFrame(tick)
    }
    scrollFrameRef.current = requestAnimationFrame(tick)
  }, [edgeStep, placePlaceholder])

  /** Clean up after the drag. The row itself is redrawn by React, not put back. */
  const cancel = useCallback((): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = 0
    drag.stop()
    drag.el.classList.remove('is-dragging', 'is-pressed')
    drag.el.style.width = ''
    drag.el.style.left = ''
    drag.el.style.top = ''
    drag.el.style.transform = ''
    drag.placeholder.remove()
    setDragging(false)
  }, [])

  const startDrag = useCallback(
    (el: HTMLElement, rowId: string, point: { x: number; y: number }, pointerId: number): void => {
      const body = optionsRef.current.scrollParent()
      if (!body || !el.parentNode) return

      const rect = el.getBoundingClientRect()
      const placeholder = document.createElement(optionsRef.current.placeholderTag ?? 'li')
      placeholder.className = optionsRef.current.placeholderClass
      placeholder.style.height = `${rect.height}px`
      el.parentNode.insertBefore(placeholder, el)

      const onMove = (event: PointerEvent): void => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        drag.x = event.clientX
        drag.y = event.clientY
        moveDragged()
        placePlaceholder()
        autoScroll()
      }
      const onUp = (event: PointerEvent): void => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        const container = drag.placeholder.parentElement
        // Where the placeholder stands, without the lifted row: exactly the
        // index the caller's own list model reads.
        const index = [...(container?.children ?? [])]
          .filter((child) => child !== drag.el)
          .indexOf(drag.placeholder)
        cancel()
        if (container && index > -1) optionsRef.current.onDrop({ rowId, container, index })
      }
      const onCancel = (event: PointerEvent): void => {
        const drag = dragRef.current
        if (drag && event.pointerId === drag.pointerId) cancel()
      }
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || !dragRef.current) return
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
      const blockTouchScroll = (event: TouchEvent): void => {
        if (dragRef.current && event.cancelable) event.preventDefault()
      }

      /*
       * Lift it first, then ask where the top left corner of the viewport is
       * from where it now hangs. The rotation is taken off while asking,
       * because `getBoundingClientRect` on a rotated box returns the box around
       * it — a couple of pixels of drift that would otherwise be baked into
       * every position for the rest of the drag.
       */
      el.classList.remove('is-pressed')
      el.classList.add('is-dragging')
      el.style.width = `${rect.width}px`
      const spin = el.style.transform
      el.style.transform = 'none'
      el.style.left = '0px'
      el.style.top = '0px'
      const origin = el.getBoundingClientRect()
      el.style.transform = spin

      dragRef.current = {
        rowId,
        el,
        placeholder,
        pointerId,
        grabX: point.x - rect.left,
        grabY: point.y - rect.top,
        originX: origin.left,
        originY: origin.top,
        x: point.x,
        y: point.y,
        stop: () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onCancel)
          window.removeEventListener('keydown', onKey, true)
          body.removeEventListener('touchmove', blockTouchScroll)
        },
      }

      setDragging(true)
      moveDragged()

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
      // The finger started on a surface that scrolls normally, so the browser
      // has to be stopped actively while the drag is on. Non-passive, or
      // `preventDefault` does not bite.
      body.addEventListener('touchmove', blockTouchScroll, { passive: false })
    },
    [autoScroll, cancel, moveDragged, placePlaceholder],
  )

  const arm = useCallback(
    (
      event: React.PointerEvent,
      rowId: string,
      dragEl: HTMLElement | null,
      except?: string,
    ): void => {
      draggedRef.current = false
      if (event.button !== 0 || event.isPrimary === false) return
      if (except && (event.target as Element).closest(except)) return
      if (!dragEl) return
      event.preventDefault() // no text selection while you hold

      const pointerId = event.pointerId
      const mouse = event.pointerType === 'mouse'
      const start = { x: event.clientX, y: event.clientY }
      let last = start
      let timer = 0

      const disarm = (): void => {
        clearTimeout(timer)
        timer = 0
        dragEl.classList.remove('is-pressed')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      function startNow(): void {
        disarm()
        // Anything may have changed between the press and now: the list may have
        // been redrawn, another drag may have begun, an editor may have opened.
        if (!dragEl?.isConnected || dragRef.current) return
        if (optionsRef.current.canStart?.() === false) return
        draggedRef.current = true
        startDrag(dragEl, rowId, last, pointerId)
      }
      function onMove(move: PointerEvent): void {
        if (move.pointerId !== pointerId) return
        last = { x: move.clientX, y: move.clientY }
        const limit = mouse ? HOLD_MOVE_MOUSE : HOLD_MOVE
        const dx = last.x - start.x
        const dy = last.y - start.y
        if (dx * dx + dy * dy <= limit * limit) return
        // Mouse: the movement *is* the drag. Touch: movement before the hold is
        // out is a swipe, and then the list should scroll as it otherwise does.
        if (mouse) startNow()
        else disarm()
      }
      function onUp(up: PointerEvent): void {
        if (up.pointerId === pointerId) disarm()
      }

      if (!mouse) {
        dragEl.classList.add('is-pressed')
        timer = window.setTimeout(startNow, HOLD_MS)
      }
      // The pointer may be released outside the zone. Without the window
      // listening, the hold would stay armed and start a drag after the finger
      // had already been lifted.
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [startDrag],
  )

  const swallowClick = useCallback((event: React.MouseEvent): void => {
    if (!draggedRef.current) return
    draggedRef.current = false
    event.stopPropagation()
    event.preventDefault()
  }, [])

  useEffect(() => () => cancel(), [cancel])

  return { arm, swallowClick, cancel, dragging }
}
