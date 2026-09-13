/**
 * Affordance shown in an empty leaf zone.
 *
 * Without this, an empty slide gives the user nothing to click; with it, every
 * content type that *can* be used here is one click away. The ones that cannot
 * are shown disabled with the domain's own explanation rather than hidden: an
 * author who has made a zone too narrow for a card should be able to see that
 * that is what happened, and in a zone small enough, «Negativt rom» is the one
 * choice left.
 */

import type { Rect, ZoneContentKind } from '../../domain/types'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { contentKindOptions } from './contentKinds'
import { useSlideRender } from '../slide/SlideRenderContext'

export function EmptyZone({
  nodeId,
  rect,
  compact,
  onAdd,
}: {
  nodeId: string
  /** The zone's own rectangle, which decides what may be put in it. */
  rect: Rect | null
  compact: boolean
  onAdd: (nodeId: string, kind: ZoneContentKind) => void
}) {
  const { theme } = useSlideRender()
  if (compact) {
    return (
      <div className="zone-empty" data-testid="empty-zone">
        Tom sone
      </div>
    )
  }
  return (
    <div className="zone-empty zone-empty--interactive" data-testid="empty-zone">
      <span className="zone-empty__hint">Velg innholdstype</span>
      <div className="zone-empty__choices">
        {contentKindOptions(rect, theme).map((option) => (
          <Tooltip key={option.kind} label={option.reason ?? option.label} wrap={option.disabled}>
            <button
              type="button"
              className="btn btn--sm"
              data-testid={`empty-zone-${option.kind}`}
              disabled={option.disabled}
              title={option.reason ?? undefined}
              onClick={(event) => {
                event.stopPropagation()
                onAdd(nodeId, option.kind)
              }}
            >
              <Icon name={option.icon} size={15} /> {option.label}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
