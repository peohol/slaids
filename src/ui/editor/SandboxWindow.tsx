/**
 * The sandbox: a per-presentation holding area for content that is temporarily
 * off-slide. Items can be dragged onto any zone that can actually hold them.
 */

import { useDraggable } from '@dnd-kit/core'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { contentLabel } from '../../domain/content'
import { deleteSandboxItem, duplicateSandboxItem } from '../../domain/commands'
import { sectionGoverning } from '../../domain/presentation'
import { useEditorStore } from '../../state/store'
import { DEFAULT_SANDBOX_GEOMETRY } from '../../state/prefs'
import type { SandboxItem } from '../../domain/types'
import { FloatingWindow } from '../components/FloatingWindow'
import { ZoneContentView } from '../slide/ZoneContentView'
import { pillTokenStyle } from '../slide/SlideView'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

const PREVIEW_WIDTH = 150
const PREVIEW_RECT = { width: SLIDE_WIDTH / 3, height: SLIDE_HEIGHT / 3 }

function SandboxItemCard({
  item,
  onPlace,
}: {
  item: SandboxItem
  /** Ask for a target zone instead of dragging the item onto one. */
  onPlace: (item: SandboxItem) => void
}) {
  const run = useEditorStore((state) => state.run)
  // The preview is outside the slide, so the accent has to be handed to it: a
  // parked heading is the same heading it will be on a slide, and the section
  // it would land under is the one the editor is currently in.
  const pillColor = useEditorStore((state) =>
    state.presentation && state.currentSlideId
      ? sectionGoverning(state.presentation, state.currentSlideId).accentColor
      : undefined,
  )
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
            ...(pillColor ? pillTokenStyle(pillColor) : null),
          }}
        >
          <ZoneContentView content={item.content} />
        </div>
      </div>
      <div className="sandbox-item__meta">
        <span className="sandbox-item__label">{contentLabel(item.content)}</span>
        {item.note && <span className="hint">{item.note}</span>}
        <div className="sandbox-item__tools">
          <Tooltip label="Velg en sone å plassere innholdet i">
            <button
              type="button"
              className="btn btn--sm sandbox-item__place"
              data-testid="sandbox-place"
              onClick={() => onPlace(item)}
            >
              <Icon name="target" size={14} /> Plasser
            </button>
          </Tooltip>
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

export function SandboxWindow({
  open,
  onClose,
  onPlace,
}: {
  open: boolean
  onClose: () => void
  /**
   * Place an item by choosing its target, rather than by dragging it there.
   *
   * The drag stays for a mouse; this is the road a finger can actually take,
   * and both end in `placeSandboxItem` with the same fit validation.
   */
  onPlace: (item: SandboxItem) => void
}) {
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
            <SandboxItemCard key={item.id} item={item} onPlace={onPlace} />
          ))}
        </div>
      )}
    </FloatingWindow>
  )
}
