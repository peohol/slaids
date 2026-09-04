/**
 * Affordance shown in an empty leaf zone.
 *
 * Without this, an empty slide gives the user nothing to click; with it, every
 * content type is one click away in either mode. The list is the shared one, so
 * a kind added to the domain is offered here without this file being touched.
 */

import { CONTENT_KIND_LABELS } from '../../domain/content'
import type { ZoneContentKind } from '../../domain/types'
import { Icon } from '../components/Icon'
import { CONTENT_KINDS, CONTENT_KIND_ICONS } from './contentKinds'

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
        {CONTENT_KINDS.map((kind) => (
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
            <Icon name={CONTENT_KIND_ICONS[kind]} size={15} /> {CONTENT_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  )
}
