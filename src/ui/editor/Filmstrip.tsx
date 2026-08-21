/**
 * Slide filmstrip: thumbnails, reordering, and slide-level actions.
 *
 * Thumbnails are the same `SlideView` the stage uses, scaled down — so a
 * thumbnail can never misrepresent the slide.
 */

import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { duplicateSlide } from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import type { Presentation, Slide } from '../../domain/types'
import { SlideView } from '../slide/SlideView'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

const THUMB_WIDTH = 168

function SlideThumb({
  slide,
  index,
  active,
  onSelect,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  slide: Slide
  index: number
  active: boolean
  onSelect: () => void
  onDuplicate: () => void
  onDelete: () => void
  canDelete: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.id,
    data: { kind: 'slide' },
  })
  const scale = THUMB_WIDTH / SLIDE_WIDTH

  return (
    <div
      ref={setNodeRef}
      className={active ? 'filmstrip__item filmstrip__item--active' : 'filmstrip__item'}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      data-testid="filmstrip-item"
      data-slide-id={slide.id}
    >
      <div className="filmstrip__index">
        <span>{index + 1}</span>
        <button
          type="button"
          className="filmstrip__grip"
          aria-label="Flytt slide"
          {...attributes}
          {...listeners}
        >
          <Icon name="grip" size={14} />
        </button>
      </div>
      <button
        type="button"
        className="filmstrip__thumb"
        style={{ width: THUMB_WIDTH, height: SLIDE_HEIGHT * scale }}
        onClick={onSelect}
        data-testid="filmstrip-thumb"
        aria-label={`Slide ${index + 1}`}
      >
        <div
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <SlideView slide={slide} />
        </div>
      </button>
      <div className="filmstrip__tools">
        <Tooltip label="Dupliser slide">
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onDuplicate}
            aria-label={`Dupliser slide ${index + 1}`}
            data-testid="duplicate-slide"
          >
            <Icon name="copy" size={14} />
          </button>
        </Tooltip>
        <Tooltip label="Slett slide">
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onDelete}
            disabled={!canDelete}
            aria-label={`Slett slide ${index + 1}`}
            data-testid="delete-slide"
          >
            <Icon name="trash" size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export function Filmstrip({
  presentation,
  derivedSlides,
  viewingDerivedId,
  onSelectDerived,
  onSelectAuthored,
  onRequestDelete,
  onRequestNewSlide,
}: {
  presentation: Presentation
  /** Reference slides, computed from the citations rather than stored. */
  derivedSlides: Slide[]
  viewingDerivedId: string | null
  onSelectDerived: (slideId: string) => void
  /** Selecting an authored slide closes the derived view for good. */
  onSelectAuthored: () => void
  onRequestDelete: (slide: Slide) => void
  onRequestNewSlide: () => void
}) {
  const currentSlideId = useEditorStore((state) => state.currentSlideId)
  const selectSlide = useEditorStore((state) => state.selectSlide)
  const selectAuthored = (slideId: string): void => {
    onSelectAuthored()
    selectSlide(slideId)
  }
  const run = useEditorStore((state) => state.run)

  const duplicate = (slideId: string, index: number): void => {
    if (!run('duplicate-slide', (current) => duplicateSlide(current, slideId))) return
    const copy = useEditorStore.getState().presentation?.slides[index + 1]
    if (copy) selectAuthored(copy.id)
  }

  return (
    <aside className="filmstrip" data-testid="filmstrip">
      <div className="filmstrip__list">
        <SortableContext
            items={presentation.slides.map((slide) => slide.id)}
            strategy={verticalListSortingStrategy}
          >
            {presentation.slides.map((slide, index) => (
              <SlideThumb
                key={slide.id}
                slide={slide}
                index={index}
                active={slide.id === currentSlideId && viewingDerivedId === null}
                canDelete={presentation.slides.length > 1}
                onSelect={() => selectAuthored(slide.id)}
                onDuplicate={() => duplicate(slide.id, index)}
                onDelete={() => onRequestDelete(slide)}
              />
            ))}
        </SortableContext>

        {derivedSlides.map((slide, index) => (
          <div
            key={slide.id}
            className={
              slide.id === viewingDerivedId
                ? 'filmstrip__item filmstrip__item--active filmstrip__item--derived'
                : 'filmstrip__item filmstrip__item--derived'
            }
            data-testid="filmstrip-derived"
          >
            <div className="filmstrip__index">
              <span>{presentation.slides.length + index + 1}</span>
              <span className="filmstrip__badge">Avledet</span>
            </div>
            <button
              type="button"
              className="filmstrip__thumb"
              style={{ width: THUMB_WIDTH, height: (SLIDE_HEIGHT * THUMB_WIDTH) / SLIDE_WIDTH }}
              onClick={() => onSelectDerived(slide.id)}
              aria-label={`Referanseslide ${index + 1}`}
            >
              <div
                style={{
                  width: SLIDE_WIDTH,
                  height: SLIDE_HEIGHT,
                  transform: `scale(${THUMB_WIDTH / SLIDE_WIDTH})`,
                  transformOrigin: 'top left',
                  pointerEvents: 'none',
                }}
              >
                <SlideView slide={slide} />
              </div>
            </button>
            <div className="filmstrip__tools">
              <span className="hint">Genereres fra referansene</span>
            </div>
          </div>
        ))}
      </div>
      <div className="filmstrip__footer">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onRequestNewSlide}
          data-testid="add-slide"
        >
          <Icon name="plus" /> Ny slide
        </button>
      </div>
    </aside>
  )
}
