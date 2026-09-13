/**
 * An interactive slide on the editor's stage.
 *
 * The same frame every stage has — `StageSurface`, which measures the room,
 * fits the 1600 × 900 page into it and answers a pinch — with the page drawn
 * by `DeckPageView`, exactly as a thumbnail and the player draw it. What the
 * stage adds, and the thumbnail never does, is `InteractiveSlideSurface`: this
 * is one of the two surfaces on which the cover's button is real, so an author
 * can try the app where it is edited rather than only where it is presented.
 *
 * While the app is running it owns every gesture inside its own frame — the
 * lock in `state/interactiveRuntime.ts` is what the stage's own recogniser
 * asks before it touches anything.
 *
 * There is nothing to type here. The name and the file are changed from the
 * inspector beside the stage, and the app's own contents are the app's.
 */

import { authoredPage } from '../../domain/pages'
import type { InteractiveSlide } from '../../domain/types'
import { InteractiveSlideSurface } from '../interactive/InteractiveSlideSurface'
import { DeckPageView } from '../slide/DeckPageView'
import { StageSurface } from './StageSurface'
import type { StageZoom } from './stageView'

export function InteractiveStage({
  slide,
  zoom,
  onZoomChange,
}: {
  slide: InteractiveSlide
  /** The pinch, where the workspace offers one. See `StageSurface`. */
  zoom?: StageZoom
  onZoomChange?: (update: (current: StageZoom) => StageZoom) => void
}) {
  return (
    <StageSurface
      kind="interactive"
      zoom={zoom}
      onZoomChange={onZoomChange}
      note="Miniappen kjører bare etter at noen trykker «Aktiver miniapp», og avsluttes med knappen øverst til høyre. Navn og fil endres i panelet til høyre."
    >
      {(scale) => (
        <InteractiveSlideSurface slide={slide} scale={scale}>
          <DeckPageView page={authoredPage(slide)} />
        </InteractiveSlideSurface>
      )}
    </StageSurface>
  )
}
