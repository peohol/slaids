/**
 * Draggable, resizable panel.
 *
 * The geometry model is mdeditz's. Two sizes are kept, not one: `wanted` is
 * what the user chose, `box` is what fits right now. The distinction is what
 * lets a shrinking viewport squeeze the window without overwriting the choice —
 * when the room comes back, the window grows back to it.
 *
 * The window is held inside the editor body rather than inside the viewport, so
 * it can never come to rest on top of the toolbars and put the app's own
 * buttons out of reach.
 *
 * Window geometry is local UI state (localStorage); the content it shows
 * belongs to the presentation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { readPref, writePref, type WindowGeometry } from '../../state/prefs'
import { Icon } from './Icon'

const MIN_WIDTH = 220
const MIN_HEIGHT = 200
/** Air between the window and the edge of the area it may use. */
const EDGE = 12

/** `null` moves the whole window; anything else is the edge being pulled. */
type Side = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se'
const SIDES: Side[] = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Hold `value` between `min` and `max`.
 *
 * When `max` is the smaller of the two it wins: the room on screen is a limit,
 * the minimum size only a wish.
 */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/** The part of the window that is actually on screen right now. */
function visibleBounds(): Bounds {
  const view = window.visualViewport
  if (!view) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  return {
    left: view.offsetLeft,
    top: view.offsetTop,
    right: view.offsetLeft + view.width,
    bottom: view.offsetTop + view.height,
  }
}

/** The overlap of two areas. Empty when they do not meet at all. */
export function intersectBounds(a: Bounds, b: Bounds): Bounds {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
}

/**
 * The area a floating window may use.
 *
 * Two limits, and the window has to respect both, so it is their overlap. The
 * editor body says which part of the *app* may be covered — never the toolbars
 * or the status bar, or the app's own buttons would go out of reach. The visual
 * viewport says which part of that is on screen at all: a phone keyboard shrinks
 * it without touching the layout, so the editor body stays its full height while
 * the bottom of it sits behind the keyboard. Taking the body alone would make
 * the keyboard listeners below inert, which is the whole reason they are there.
 */
function editorBounds(): Bounds {
  const visible = visibleBounds()
  const body = document.querySelector('.editor__body')
  if (!body) return visible
  const rect = body.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return visible
  return intersectBounds(rect, visible)
}

/** The room available, or `null` when there is nothing laid out to measure against. */
function roomNow(): { bounds: Bounds; width: number; height: number } | null {
  const bounds = editorBounds()
  const width = bounds.right - bounds.left - EDGE * 2
  const height = bounds.bottom - bounds.top - EDGE * 2
  return width > 0 && height > 0 ? { bounds, width, height } : null
}

type Room = NonNullable<ReturnType<typeof roomNow>>

/** Keep the window inside the area, without shrinking it more than the room demands. */
function fit(geometry: WindowGeometry, room: Room): WindowGeometry {
  const width = Math.round(clamp(geometry.width, MIN_WIDTH, room.width))
  const height = Math.round(clamp(geometry.height, MIN_HEIGHT, room.height))
  return {
    x: Math.round(clamp(geometry.x, room.bounds.left + EDGE, room.bounds.right - width - EDGE)),
    y: Math.round(clamp(geometry.y, room.bounds.top + EDGE, room.bounds.bottom - height - EDGE)),
    width,
    height,
  }
}

/** First-run placement: in from the right edge, halfway down. */
function defaultGeometry(room: Room, preferred: WindowGeometry): WindowGeometry {
  const width = Math.min(preferred.width, room.width)
  const height = Math.min(preferred.height, room.height)
  return {
    x: room.bounds.right - width - EDGE * 2,
    y: room.bounds.top + (room.bounds.bottom - room.bounds.top - height) / 2,
    width,
    height,
  }
}

export function FloatingWindow({
  prefKey,
  title,
  icon,
  open,
  onClose,
  defaults,
  badge,
  footer,
  children,
  testId,
  onPointerDown,
  onKeyDown,
}: {
  prefKey: string
  title: string
  icon: Parameters<typeof Icon>[0]['name']
  open: boolean
  onClose: () => void
  /** The size the window prefers; where it first appears is worked out from the room. */
  defaults: WindowGeometry
  /** Shown next to the title — a count, usually. */
  badge?: ReactNode
  /** Pinned below the scrolling body. */
  footer?: ReactNode
  children: ReactNode
  testId?: string
  /** Whole-window listeners, for panels that need to hear a press or a key anywhere in them. */
  onPointerDown?: (event: React.PointerEvent) => void
  onKeyDown?: (event: React.KeyboardEvent) => void
}) {
  const [box, setBox] = useState<WindowGeometry>(defaults)
  /** What is applied right now, readable from a gesture that starts after the paint. */
  const boxRef = useRef(box)
  useEffect(() => {
    boxRef.current = box
  })
  /** The size and place the user chose, which a temporary squeeze must not overwrite. */
  const wantedRef = useRef<WindowGeometry | null>(readPref<WindowGeometry | null>(prefKey, null))
  const [moving, setMoving] = useState(false)

  const place = useCallback(() => {
    const room = roomNow()
    if (!room) return
    wantedRef.current ??= defaultGeometry(room, defaults)
    setBox(fit(wantedRef.current, room))
  }, [defaults])

  /*
   * The window must never be left standing outside what can be seen: the
   * viewport may have shrunk since last time, and on a phone the keyboard eats
   * into it while you type.
   *
   * The measurement waits two frames. The browser writes the new visual
   * viewport in its own frame, and which of us gets there first is not ours to
   * decide — measuring inside the event itself would read the area as it was
   * *before* the keyboard shrank it.
   */
  useEffect(() => {
    if (!open) return
    place()
    let frame = 0
    const refit = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(place)
      })
    }
    window.addEventListener('resize', refit)
    window.addEventListener('orientationchange', refit)
    window.visualViewport?.addEventListener('resize', refit)
    window.visualViewport?.addEventListener('scroll', refit)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', refit)
      window.removeEventListener('orientationchange', refit)
      window.visualViewport?.removeEventListener('resize', refit)
      window.visualViewport?.removeEventListener('scroll', refit)
    }
  }, [open, place])

  /**
   * The user's choice, while moving and stretching. Clipped to the area at once.
   *
   * `keep` names the lengths nobody is touching, with the wish they already
   * had. They have to survive a drag that is not about them: if the area is
   * temporarily too small, a drag on the side edge would otherwise write the
   * squeezed height in as a wish, and the window would never grow back.
   */
  const choose = useCallback(
    (geometry: WindowGeometry, keep: Partial<Pick<WindowGeometry, 'width' | 'height'>>): void => {
      const room = roomNow()
      const next = room ? fit(geometry, room) : geometry
      setBox(next)
      wantedRef.current = {
        ...next,
        width: keep.width ?? next.width,
        height: keep.height ?? next.height,
      }
    },
    [],
  )

  /**
   * Moving and resizing: one gesture, different sums.
   *
   * The edge being pulled is the one that moves; the opposite edge stays put, so
   * the window grows towards the pull. A corner is just two edges in one grip,
   * and an edge that is not named changes nothing: top and bottom change the
   * height alone, the sides the width alone.
   */
  const grab = useCallback(
    (side: Side | null) =>
      (event: React.PointerEvent): void => {
        if (event.button !== 0 || event.isPrimary === false) return
        event.preventDefault()

        // The drag is measured on the window as it is *shown* — that is the edge
        // being held — while the lengths nobody touches keep their wish.
        const from = { x: event.clientX, y: event.clientY }
        const start = boxRef.current
        const want = wantedRef.current ?? start
        const id = event.pointerId
        event.currentTarget.setPointerCapture?.(id)

        const onMove = (move: PointerEvent): void => {
          if (move.pointerId !== id) return
          const dx = move.clientX - from.x
          const dy = move.clientY - from.y

          if (!side) {
            // A move says nothing about the size: both lengths are kept.
            choose(
              { ...start, x: start.x + dx, y: start.y + dy },
              { width: want.width, height: want.height },
            )
            return
          }
          const west = side.includes('w')
          const east = side.includes('e')
          const north = side.includes('n')
          const south = side.includes('s')
          // The fixed edge is worked out first: without it a window that hits its
          // minimum would start shoving itself along instead of stopping.
          const right = start.x + start.width
          const bottom = start.y + start.height
          let width = start.width
          if (west) width = Math.max(MIN_WIDTH, start.width - dx)
          else if (east) width = Math.max(MIN_WIDTH, start.width + dx)
          let height = start.height
          if (north) height = Math.max(MIN_HEIGHT, start.height - dy)
          else if (south) height = Math.max(MIN_HEIGHT, start.height + dy)

          const keep: Partial<Pick<WindowGeometry, 'width' | 'height'>> = {}
          if (!west && !east) keep.width = want.width
          if (!north && !south) keep.height = want.height

          choose(
            {
              x: west ? right - width : start.x,
              y: north ? bottom - height : start.y,
              width,
              height,
            },
            keep,
          )
        }
        const onUp = (up: PointerEvent): void => {
          if (up.pointerId !== id) return
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          setMoving(false)
          if (wantedRef.current) writePref(prefKey, wantedRef.current)
        }

        setMoving(true)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      },
    [choose, prefKey],
  )

  if (!open) return null

  return (
    <section
      className={moving ? 'floating-window is-moving' : 'floating-window'}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      <header
        className="floating-window__bar"
        onPointerDown={(event) => {
          if ((event.target as Element).closest('button')) return
          grab(null)(event)
        }}
      >
        <Icon name={icon} size={15} />
        <span className="floating-window__title">{title}</span>
        <span className="floating-window__badge" aria-hidden="true">
          {badge}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm floating-window__close"
          onClick={onClose}
          aria-label={`Lukk ${title}`}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="floating-window__body">{children}</div>
      {footer}
      {/*
       * Eight handles: four edges that change one length, four corners that
       * change both. The edges stop where the corners begin, so they never
       * fight over the same press and every point along the rim belongs to
       * exactly one handle.
       */}
      {SIDES.map((side) => (
        <span
          key={side}
          className="floating-window__handle"
          data-side={side}
          onPointerDown={grab(side)}
          aria-hidden="true"
        />
      ))}
    </section>
  )
}
