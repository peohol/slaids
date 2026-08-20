/**
 * Drop target for a leaf zone.
 *
 * Validity is decided once when the drag starts, not while rendering: the fit
 * check renders the content offscreen with `flushSync`, which React refuses to
 * do during a render pass. Deciding it in the drag-start event handler makes the
 * answer real instead of silently always "fits".
 */

import { useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'

export function ZoneDropZone({
  nodeId,
  acceptable,
  children,
}: {
  nodeId: string
  acceptable: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${nodeId}`, disabled: !acceptable })

  return (
    <div
      ref={setNodeRef}
      className={[
        'zone-drop',
        acceptable ? 'zone-drop--available' : '',
        acceptable && isOver ? 'zone-drop--over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={acceptable ? 'zone-drop-available' : undefined}
      data-node-id={nodeId}
    >
      {children}
    </div>
  )
}
