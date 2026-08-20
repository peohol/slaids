/**
 * Presentation mode.
 *
 * It uses the same `SlideView` and the same geometry as the editor — there is no
 * separate presentation layout — and appends the derived reference slides.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { computeReferenceNumbering } from '../../domain/references'
import { presentationSlides } from '../../domain/referenceSlides'
import type { Presentation } from '../../domain/types'
import { SlideRenderProvider } from '../slide/SlideRenderContext'
import { SlideView } from '../slide/SlideView'
import { useFitScale } from '../slide/useFitScale'
import { loadWebFonts } from '../fonts'

export function PresentView({
  presentation,
  startIndex,
  onExit,
}: {
  presentation: Presentation
  startIndex: number
  onExit: () => void
}) {
  const slides = presentationSlides(presentation)
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), slides.length - 1))
  const hostRef = useRef<HTMLDivElement>(null)
  const scale = useFitScale(hostRef, 1)
  const numbering = computeReferenceNumbering(presentation)

  useEffect(() => {
    loadWebFonts([presentation.theme.headingFontFamily, presentation.theme.bodyFontFamily])
  }, [presentation.theme.headingFontFamily, presentation.theme.bodyFontFamily])

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => Math.max(0, Math.min(slides.length - 1, current + delta)))
    },
    [slides.length],
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
          setIndex(slides.length - 1)
          break
        case 'Escape':
          event.preventDefault()
          onExit()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onExit, slides.length])

  const slide = slides[index]

  return (
    <div
      className="present"
      data-testid="present-view"
      ref={hostRef}
      onClick={(event) => {
        // Links and buttons inside a slide (reference URLs, rich-text links)
        // must not also advance the deck.
        if ((event.target as Element).closest('a, button, [role="button"]')) return
        go(1)
      }}
    >
      <SlideRenderProvider value={{ theme: presentation.theme, numbering, isStatic: true }}>
        <div
          className="present__slide"
          style={{
            width: SLIDE_WIDTH * scale,
            height: SLIDE_HEIGHT * scale,
          }}
        >
          <div
            style={{
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {slide && <SlideView slide={slide} />}
          </div>
        </div>
      </SlideRenderProvider>
      <div className="present__hud" data-testid="present-counter">
        {index + 1} / {slides.length}
      </div>
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
    </div>
  )
}
