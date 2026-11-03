/**
 * The editor's mark on a zone whose content is drawn smaller than normal.
 *
 * A dashed orange line just inside the zone, and a small badge on its corner
 * where there is room for one. Deliberately unlike the selection — a solid
 * line in the chrome's accent — so «this is the one I picked» and «this one
 * is too small for its text» can both be true of a zone and still be read
 * apart. It draws only in the editor: presentation mode, thumbnails and every
 * exported or shared copy draw the slide without it.
 *
 * Nothing in it can be pressed or selected. It is paint over the zone, so a
 * click, a touch, a text selection and the keyboard all reach the content as
 * if it were not there; the explanation lives in the inspector, where there
 * is room to read it and a way to act on it.
 *
 * Its strokes and badge are sized in screen pixels, like the rest of the
 * stage's chrome, by undoing the scale the slide is drawn at.
 */

import type { CSSProperties } from 'react'
import type { NodeId } from '../../domain/types'
import { useZoneScale } from '../../state/zoneScales'
import { Icon } from '../components/Icon'

/** What the mark means, said once for the badge, the inspector and the tests. */
export const SHRUNK_ZONE_MESSAGE =
  'Innholdet er automatisk forminsket. Gjør sonen større for å gjenopprette normal skriftstørrelse.'

/**
 * Why more text was refused in a zone drawn small.
 *
 * Text is held to its normal size when it is written, the same as anywhere
 * else: shrinking a zone made room for nothing, and the type would only get
 * smaller with every word. Shortening, rewording and formatting are all still
 * fine; for more, the zone has to grow.
 */
export const SHRUNK_ZONE_TYPING_MESSAGE =
  'Sonen er for liten til mer tekst i normal skriftstørrelse. Gjør sonen større for å skrive mer.'

/** The badge's diameter, in screen pixels. */
const BADGE_PX = 20

export function ShrunkZoneMarker({
  stageScale,
  width,
  height,
}: {
  /** Screen pixels per slide unit, as the stage draws the slide. */
  stageScale: number
  /** The zone's size in slide units, to tell whether a badge fits. */
  width: number
  height: number
}) {
  const unit = 1 / (stageScale || 1)
  // «Where there is room»: a badge on a zone hardly bigger than the badge
  // would cover the very content it is warning about.
  const roomForBadge = Math.min(width, height) * stageScale >= BADGE_PX * 3
  return (
    <div
      className="zone-shrunk"
      data-testid="zone-shrunk-marker"
      style={{ '--zone-shrunk-unit': `${unit}px` } as CSSProperties}
    >
      {roomForBadge && (
        <span className="zone-shrunk__badge" role="img" aria-label={SHRUNK_ZONE_MESSAGE}>
          <Icon name="text-shrunk" size={BADGE_PX * 0.7 * unit} />
        </span>
      )}
    </div>
  )
}

/**
 * The same mark, said in words where there is room for them: the inspector,
 * for the selected zone.
 *
 * It reads the scale the stage drew the zone at rather than measuring again,
 * so it says exactly what the slide shows and disappears the moment the zone
 * has room for its text. Text drawn small is still text to write in, so it
 * offers to draw just this zone large — the same focused view a compact
 * workspace writes in — and the way back to the whole slide.
 */
export function ShrunkZoneNotice({
  nodeId,
  enlarged,
  onEnlarge,
  onShowSlide,
}: {
  nodeId: NodeId
  /** Whether the stage is showing this zone on its own, drawn large. */
  enlarged: boolean
  onEnlarge: (nodeId: NodeId) => void
  onShowSlide: () => void
}) {
  const scale = useZoneScale(nodeId)
  if (scale >= 1) return null
  return (
    <div className="zone-shrunk-notice" role="status" data-testid="zone-shrunk-notice">
      <p className="zone-shrunk-notice__text">
        {SHRUNK_ZONE_MESSAGE}
      </p>
      <p className="zone-shrunk-notice__scale">Vises i {Math.round(scale * 100)} % av normal størrelse.</p>
      {enlarged ? (
        <button type="button" className="btn btn--sm" onClick={onShowSlide} data-testid="zone-shrunk-show-slide">
          <Icon name="collapse" size={14} /> Vis hele sliden
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onEnlarge(nodeId)}
          data-testid="zone-shrunk-enlarge"
        >
          <Icon name="expand" size={14} /> Forstørr sonen for redigering
        </button>
      )}
    </div>
  )
}
