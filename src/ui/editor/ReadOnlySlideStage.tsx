/**
 * Read-only stage, for the derived pages.
 *
 * A derived page — a reference slide, or the QR page while sharing is on — is
 * recomputed on every render and stored nowhere, so it is shown and never
 * edited. The note underneath says which one it is and where it comes from.
 *
 * The frame is `StageSurface`, the same one every other stage uses, so a page
 * nobody can edit is still a page a finger can pinch to read.
 */

import type { DeckPage } from '../../domain/pages'
import { DeckPageView } from '../slide/DeckPageView'
import { StageSurface } from './StageSurface'
import type { StageZoom } from './stageView'

export function ReadOnlySlideStage({
  page,
  note,
  zoom,
  onZoomChange,
}: {
  page: DeckPage
  note: string
  /** The pinch, where the workspace offers one. See `StageSurface`. */
  zoom?: StageZoom
  onZoomChange?: (update: (current: StageZoom) => StageZoom) => void
}) {
  return (
    <StageSurface kind="readonly" zoom={zoom} onZoomChange={onZoomChange} note={note}>
      {() => <DeckPageView page={page} />}
    </StageSurface>
  )
}
