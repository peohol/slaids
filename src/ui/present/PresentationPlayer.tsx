/**
 * The deck, playing.
 *
 * One component behind both ways of watching a presentation:
 *
 *   PresentationPlayer
 *   ├─ PresentView            (local, in the editor: can be left with Esc)
 *   └─ SharedPresentationView (public, at /s/<token>: nothing to leave to)
 *
 * There is no second renderer and no second geometry. The pages come from
 * `deckPages`, which is the same list in both cases, and each page is drawn by
 * `DeckPageView` — so a shared deck cannot drift from the one its author sees.
 *
 * The public variant differs by what it is *not* given: no `onExit`, and it is
 * mounted with nothing else around it. Editor chrome is not hidden here, it is
 * simply somewhere this component has never known about.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { deckPages, deckProgress } from '../../domain/pages'
import { computeReferenceNumbering } from '../../domain/references'
import type { DeckSource } from '../../domain/types'
import { SlideRenderProvider } from '../slide/SlideRenderContext'
import { DeckPageView } from '../slide/DeckPageView'
import { useFitScale } from '../slide/useFitScale'
import { ensureWebFonts } from '../fonts'

/** Shorter than this is a tap, not a swipe. */
const SWIPE_THRESHOLD_PX = 48

export interface PresentationPlayerProps {
  deck: DeckSource
  /** The share link, when sharing is on: what the derived QR page points at. */
  shareUrl?: string | null
  startIndex?: number
  /** `null` in the public view: there is nowhere to go back to. */
  onExit?: (() => void) | null
}

export function PresentationPlayer({
  deck,
  shareUrl = null,
  startIndex = 0,
  onExit = null,
}: PresentationPlayerProps) {
  const pages = useMemo(() => deckPages(deck, { shareUrl }), [deck, shareUrl])
  const progress = useMemo(() => deckProgress(pages), [pages])
  const numbering = useMemo(() => computeReferenceNumbering(deck), [deck])
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), pages.length - 1))
  const hostRef = useRef<HTMLDivElement>(null)
  const scale = useFitScale(hostRef, 1)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    void ensureWebFonts([deck.theme.headingFontFamily, deck.theme.bodyFontFamily])
  }, [deck.theme.headingFontFamily, deck.theme.bodyFontFamily])

  // A page can disappear under the viewer: the reference slides are recomputed
  // on every edit, and the QR page goes when sharing is turned off.
  const lastIndex = Math.max(0, pages.length - 1)
  const current = Math.min(index, lastIndex)

  const go = useCallback(
    (delta: number) => {
      setIndex((at) => Math.max(0, Math.min(lastIndex, Math.min(at, lastIndex) + delta)))
    },
    [lastIndex],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault()
          go(1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault()
          go(-1)
          break
        case 'Home':
          event.preventDefault()
          setIndex(0)
          break
        case 'End':
          event.preventDefault()
          setIndex(lastIndex)
          break
        case 'Escape':
          if (!onExit) return
          event.preventDefault()
          onExit()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, lastIndex, onExit])

  const page = pages[current]

  return (
    <div
      className="present"
      data-testid="present-view"
      ref={hostRef}
      onClick={(event) => {
        // Links and buttons inside a page (reference URLs, rich-text links)
        // must not also advance the deck.
        if ((event.target as Element).closest('a, button, [role="button"]')) return
        go(1)
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0]
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current
        touchStart.current = null
        const touch = event.changedTouches[0]
        if (!start || !touch) return
        const dx = touch.clientX - start.x
        // A mostly-vertical drag is a scroll gesture, not a page turn.
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return
        if (Math.abs(dx) < Math.abs(touch.clientY - start.y)) return
        go(dx < 0 ? 1 : -1)
      }}
    >
      <SlideRenderProvider
        value={{
          theme: deck.theme,
          numbering,
          headingPillColor: deck.cover.pillColor,
          progress,
          isStatic: true,
        }}
      >
        <div
          className="present__slide"
          style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}
        >
          <div
            style={{
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {page && <DeckPageView page={page} />}
          </div>
        </div>
      </SlideRenderProvider>
      <div className="present__hud" data-testid="present-counter">
        {current + 1} / {pages.length}
      </div>
      {onExit && (
        <button
          type="button"
          className="present__exit"
          onClick={(event) => {
            event.stopPropagation()
            onExit()
          }}
          data-testid="present-exit"
        >
          Avslutt (Esc)
        </button>
      )}
    </div>
  )
}
