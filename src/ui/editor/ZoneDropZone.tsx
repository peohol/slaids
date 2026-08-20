/**
 * Drop target for a leaf zone.
 *
 * A zone only lights up when it can genuinely take the dragged content: it must
 * be an empty leaf, and `canFit` must approve the content at that exact rect.
 */

import { useDndContext, useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { canAcceptContent } from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import { fitCheckerFor } from '../../state/measure'

export function ZoneDropZone({
  nodeId,
  slideId,
  children,
}: {
  nodeId: string
  slideId: string
  children: ReactNode
}) {
  const { active } = useDndContext()
  const presentation = useEditorStore((state) => state.presentation)

  const data = active?.data.current
  const item =
    data?.kind === 'sandbox-item'
      ? presentation?.sandbox.find((entry) => entry.id === String(data.itemId))
      : undefined

  const acceptable = Boolean(
    item &&
      presentation &&
      canAcceptContent(presentation, {
        slideId,
        nodeId,
        content: item.content,
        fits: fitCheckerFor(presentation.theme),
      }),
  )

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
