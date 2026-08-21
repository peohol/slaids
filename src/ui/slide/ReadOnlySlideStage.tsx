/**
 * Read-only stage, used for derived reference slides.
 *
 * These slides are recomputed from the citation list on every render, so they
 * are shown but never edited.
 */

import { useRef } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import type { Slide } from '../../domain/types'
import { SlideView } from './SlideView'
import { useFitScale } from './useFitScale'

export function ReadOnlySlideStage({ slide, note }: { slide: Slide; note: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const scale = useFitScale(viewportRef)

  return (
    <div className="stage-viewport" ref={viewportRef} data-testid="stage-viewport">
      <div className="stage-scaler" style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}>
        <div
          className="stage-slide"
          data-testid="stage-slide"
          data-scale={scale}
          data-readonly=""
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <SlideView slide={slide} />
        </div>
      </div>
      <p className="stage-note" data-testid="stage-note">
        {note}
      </p>
    </div>
  )
}
