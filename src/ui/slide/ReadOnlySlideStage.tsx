/**
 * Read-only stage, for the derived pages.
 *
 * A derived page — a reference slide, or the QR page while sharing is on — is
 * recomputed on every render and stored nowhere, so it is shown and never
 * edited. The note underneath says which one it is and where it comes from.
 */

import { useRef } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import type { DeckPage } from '../../domain/pages'
import { DeckPageView } from './DeckPageView'
import { useFitScale } from './useFitScale'

export function ReadOnlySlideStage({ page, note }: { page: DeckPage; note: string }) {
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
          <DeckPageView page={page} />
        </div>
      </div>
      <p className="stage-note" data-testid="stage-note">
        {note}
      </p>
    </div>
  )
}
