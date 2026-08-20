/**
 * Draggable, resizable panel.
 *
 * Window geometry is local UI state (localStorage); the content it shows
 * belongs to the presentation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { readPref, writePref, type WindowGeometry } from '../../state/prefs'
import { Icon } from './Icon'

const MIN_WIDTH = 260
const MIN_HEIGHT = 200

export function FloatingWindow({
  prefKey,
  title,
  icon,
  open,
  onClose,
  defaults,
  children,
  testId,
}: {
  prefKey: string
  title: string
  icon: Parameters<typeof Icon>[0]['name']
  open: boolean
  onClose: () => void
  defaults: WindowGeometry
  children: ReactNode
  testId?: string
}) {
  const [geometry, setGeometry] = useState<WindowGeometry>(() =>
    readPref<WindowGeometry>(prefKey, defaults),
  )
  const dragRef = useRef<{ mode: 'move' | 'resize'; x: number; y: number; geometry: WindowGeometry } | null>(
    null,
  )

  useEffect(() => {
    writePref(prefKey, geometry)
  }, [geometry, prefKey])

  const beginDrag = useCallback(
    (mode: 'move' | 'resize') => (event: React.PointerEvent) => {
      event.preventDefault()
      dragRef.current = { mode, x: event.clientX, y: event.clientY, geometry }
    },
    [geometry],
  )

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (drag.mode === 'move') {
        setGeometry({
          ...drag.geometry,
          x: Math.max(0, Math.min(window.innerWidth - 80, drag.geometry.x + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 60, drag.geometry.y + dy)),
        })
      } else {
        setGeometry({
          ...drag.geometry,
          width: Math.max(MIN_WIDTH, drag.geometry.width + dx),
          height: Math.max(MIN_HEIGHT, drag.geometry.height + dy),
        })
      }
    }
    const up = (): void => {
      dragRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  if (!open) return null

  return (
    <section
      className="floating-window"
      data-testid={testId}
      style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }}
    >
      <header className="floating-window__bar" onPointerDown={beginDrag('move')}>
        <Icon name={icon} size={15} />
        <span className="floating-window__title">{title}</span>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          onClick={onClose}
          aria-label={`Lukk ${title}`}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="floating-window__body">{children}</div>
      <div
        className="floating-window__resize"
        onPointerDown={beginDrag('resize')}
        aria-hidden="true"
      />
    </section>
  )
}
