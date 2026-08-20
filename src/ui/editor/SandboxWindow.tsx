/**
 * The sandbox: a per-presentation holding area for content that is temporarily
 * off-slide. Items can be dragged onto any zone that can actually hold them.
 */

import { useDraggable } from '@dnd-kit/core'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { contentLabel } from '../../domain/content'
import { deleteSandboxItem, duplicateSandboxItem } from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import { DEFAULT_SANDBOX_GEOMETRY } from '../../state/prefs'
import type { SandboxItem } from '../../domain/types'
import { FloatingWindow } from '../components/FloatingWindow'
import { ZoneContentView } from '../slide/ZoneContentView'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

const PREVIEW_WIDTH = 150
const PREVIEW_RECT = { width: SLIDE_WIDTH / 3, height: SLIDE_HEIGHT / 3 }

export function SandboxItemCard({ item }: { item: SandboxItem }) {
  const run = useEditorStore((state) => state.run)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sandbox:${item.id}`,
    data: { kind: 'sandbox-item', itemId: item.id },
  })
  const scale = PREVIEW_WIDTH / PREVIEW_RECT.width

  return (
    <article className="sandbox-item" data-testid="sandbox-item" style={{ opacity: isDragging ? 0.4 : 1 }}>
      <div
        className="sandbox-item__preview"
        style={{ width: PREVIEW_WIDTH, height: PREVIEW_RECT.height * scale }}
      >
        <div
          style={{
            width: PREVIEW_RECT.width,
            height: PREVIEW_RECT.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <ZoneContentView content={item.content} />
        </div>
      </div>
      <div className="sandbox-item__meta">
        <span className="sandbox-item__label">{contentLabel(item.content)}</span>
        {item.note && <span className="hint">{item.note}</span>}
        <div className="sandbox-item__tools">
          <Tooltip label="Dra til en sone">
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm sandbox-item__grip"
              ref={setNodeRef}
              data-testid="sandbox-grip"
              aria-label="Dra til en sone"
              {...attributes}
              {...listeners}
            >
              <Icon name="move" size={14} />
            </button>
          </Tooltip>
          <Tooltip label="Dupliser">
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => run('sandbox-duplicate', (presentation) => duplicateSandboxItem(presentation, item.id))}
            >
              <Icon name="copy" size={14} />
            </button>
          </Tooltip>
          <Tooltip label="Slett fra sandkassen">
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              data-testid="sandbox-delete"
              onClick={() => run('sandbox-delete', (presentation) => deleteSandboxItem(presentation, item.id))}
            >
              <Icon name="trash" size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
    </article>
  )
}

export function SandboxWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useEditorStore((state) => state.presentation?.sandbox ?? [])

  return (
    <FloatingWindow
      prefKey="sandbox"
      title={`Sandkassen (${items.length})`}
      icon="sandbox"
      open={open}
      onClose={onClose}
      defaults={DEFAULT_SANDBOX_GEOMETRY}
      testId="sandbox-window"
    >
      {items.length === 0 ? (
        <p className="hint">
          Tomt. Innhold havner her når du flytter det ut av en sone, eller når en strukturendring
          ikke har plass til det.
        </p>
      ) : (
        <div className="sandbox-list">
          {items.map((item) => (
            <SandboxItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </FloatingWindow>
  )
}
