/**
 * Affordance shown in an empty leaf zone.
 *
 * Without this, an empty slide gives the user nothing to click; with it, the
 * three content types are one click away in either mode.
 */

import { CONTENT_KIND_LABELS } from '../../domain/content'
import type { ZoneContentKind } from '../../domain/types'
import { Icon, type IconName } from '../components/Icon'

const ICONS: Record<ZoneContentKind, IconName> = {
  container: 'container',
  'untitled-card': 'card',
  'titled-card': 'card-titled',
}

export function EmptyZone({
  nodeId,
  compact,
  onAdd,
}: {
  nodeId: string
  compact: boolean
  onAdd: (nodeId: string, kind: ZoneContentKind) => void
}) {
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
        {(Object.keys(ICONS) as ZoneContentKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="btn btn--sm"
            data-testid={`empty-zone-${kind}`}
            onClick={(event) => {
              event.stopPropagation()
              onAdd(nodeId, kind)
            }}
          >
            <Icon name={ICONS[kind]} size={15} /> {CONTENT_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  )
}
