/**
 * The sandbox: a per-presentation holding area for content that is temporarily
 * off-slide. Items can be dragged onto any zone that can actually hold them.
 */

import { useDraggable } from '@dnd-kit/core'
import type { CSSProperties } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { contentLabel } from '../../domain/content'
import { deleteSandboxItem, duplicateSandboxItem } from '../../domain/commands'
import { sectionColorsOf } from '../../domain/pages'
import { sectionGoverning } from '../../domain/presentation'
import { docToPlainText } from '../../domain/richdoc'
import { useEditorStore } from '../../state/store'
import { DEFAULT_SANDBOX_GEOMETRY } from '../../state/prefs'
import type { ContentSlide, SandboxItem } from '../../domain/types'
import { FloatingWindow } from '../components/FloatingWindow'
import { ZoneContentView } from '../slide/ZoneContentView'
import { pillTokenStyle, SlideView } from '../slide/SlideView'
import { SlideRenderProvider, useSlideRender } from '../slide/SlideRenderContext'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { DEFAULT_SECTION_COLORS, PageColorsProvider } from '../slide/SlideRenderContext'

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
  const section = useEditorStore((state) =>
    state.presentation && state.currentSlideId
      ? sectionGoverning(state.presentation, state.currentSlideId)
      : null,
  )
  const colors = section ? sectionColorsOf(section) : DEFAULT_SECTION_COLORS
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sandbox:${item.id}`,
    data: { kind: 'sandbox-item', itemId: item.id },
  })
  const scale = PREVIEW_WIDTH / PREVIEW_RECT.width

  return (
    <article className="sandbox-item" data-testid="sandbox-item" style={{ opacity: isDragging ? 0.4 : 1 }}>
      <div
        className="sandbox-item__preview"
        style={
          {
            width: PREVIEW_WIDTH,
            height: PREVIEW_RECT.height * scale,
            '--sandbox-preview-background': colors.background,
          } as CSSProperties
        }
      >
        <div
          style={{
            width: PREVIEW_RECT.width,
            height: PREVIEW_RECT.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
            ...pillTokenStyle(colors.accent),
          }}
        >
          <PageColorsProvider colors={colors}>
            <ZoneContentView content={item.content} />
          </PageColorsProvider>
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

function SandboxSlideCard({
  slide,
  onRestore,
}: {
  slide: ContentSlide
  onRestore: (slideId: string) => void
}) {
  const render = useSlideRender()
  const colors = useEditorStore((state) =>
    state.presentation && state.currentSlideId
      ? sectionGoverning(state.presentation, state.currentSlideId)
      : null,
  )
  const sectionColors = new Map(render.sectionColors)
  if (colors) {
    sectionColors.set(slide.id, { accent: colors.accentColor, background: colors.backgroundColor })
  }
  const scale = PREVIEW_WIDTH / SLIDE_WIDTH
  const label = docToPlainText(slide.title).trim() || 'Slide uten tittel'

  return (
    <article className="sandbox-item" data-testid="sandbox-slide">
      <div
        className="sandbox-item__preview"
        style={{ width: PREVIEW_WIDTH, height: SLIDE_HEIGHT * scale }}
        aria-hidden="true"
        inert
      >
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <SlideRenderProvider value={{ ...render, sectionColors, isStatic: true }}>
            <SlideView slide={slide} />
          </SlideRenderProvider>
        </div>
      </div>
      <div className="sandbox-item__meta">
        <span className="sandbox-item__label">{label}</span>
        <div className="sandbox-item__tools">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="sandbox-restore-slide"
            aria-label={`Sett tilbake ${label}`}
            onClick={() => onRestore(slide.id)}
          >
            Sett tilbake
          </button>
        </div>
      </div>
    </article>
  )
}

export function SandboxWindow({
  open,
  onClose,
  onPlace,
  onRestoreSlide,
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
  onRestoreSlide: (slideId: string) => void
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const items = presentation?.sandbox ?? []
  const slides = presentation?.sandboxSlides ?? []
  const count = items.length + slides.length

  return (
    <FloatingWindow
      prefKey="sandbox"
      title={`Sandkassen (${count})`}
      icon="sandbox"
      open={open}
      onClose={onClose}
      defaults={DEFAULT_SANDBOX_GEOMETRY}
      testId="sandbox-window"
    >
      {count === 0 ? (
        <p className="hint">
          Tomt. Innhold havner her når du flytter det ut av en sone, eller når en strukturendring
          ikke har plass til det. Hele innholdsslider kan flyttes hit fra slideoversikten.
        </p>
      ) : (
        <div className="sandbox-list">
          {items.map((item) => (
            <SandboxItemCard key={item.id} item={item} onPlace={onPlace} />
          ))}
          {slides.map((slide) => (
            <SandboxSlideCard key={slide.id} slide={slide} onRestore={onRestoreSlide} />
          ))}
        </div>
      )}
    </FloatingWindow>
  )
}
