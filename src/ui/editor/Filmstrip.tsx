/**
 * Slide filmstrip: thumbnails, reordering, and slide-level actions.
 *
 * Thumbnails are the same `SlideView` the stage uses, scaled down — so a
 * thumbnail can never misrepresent the slide.
 */

import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { canDeleteSlide, duplicateSlide } from '../../domain/commands'
import type { DeckPage } from '../../domain/pages'
import { SectionPageView } from '../slide/SectionPageView'
import { useEditorStore } from '../../state/store'
import type { Presentation, Slide } from '../../domain/types'
import { DeckPageView } from '../slide/DeckPageView'
import { SlideProgressBar } from '../slide/SlideProgressBar'
import { SlideView } from '../slide/SlideView'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

const THUMB_WIDTH = 168
const THUMB_SCALE = THUMB_WIDTH / SLIDE_WIDTH
const THUMB_HEIGHT = SLIDE_HEIGHT * THUMB_SCALE

/** A page drawn at thumbnail size. Every strip entry uses this one box. */
function Thumb({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        transform: `scale(${THUMB_SCALE})`,
        transformOrigin: 'top left',
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  )
}

/**
 * One authored slide in the strip.
 *
 * The thumbnail is both the way to the slide and the way to move it: a click
 * navigates, a press held for a moment starts the drag. Which of the two a
 * press becomes is decided by `data-drag-activation` — see
 * `dragActivation.ts` — so the button can carry the drag listeners without
 * ever swallowing an ordinary click. The grip keeps the immediate activation a
 * dedicated handle should have, and is the affordance that says the strip can
 * be reordered at all.
 *
 * A section is an authored slide like any other here: same grip, same tools,
 * same reordering. The front page happens to be one, and what stops it being
 * dragged away or deleted is not chrome the strip leaves out but the commands
 * themselves, which refuse a deck that would stop opening with a section.
 */
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
  const isSection = slide.kind === 'section'
  const label = isSection
    ? index === 0
      ? 'Forside'
      : 'Seksjon'
    : `Slide ${index + 1}`
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.id,
    data: { kind: 'slide' },
  })

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
        {isSection && <span className="filmstrip__badge">{label}</span>}
        <span
          className="filmstrip__grip"
          aria-hidden="true"
          data-drag-activation="immediate"
          {...listeners}
        >
          <Icon name="grip" size={14} />
        </span>
      </div>
      <button
        type="button"
        className="filmstrip__thumb"
        style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
        onClick={onSelect}
        data-testid="filmstrip-thumb"
        data-drag-activation="hold"
        aria-label={label}
        {...attributes}
        {...listeners}
      >
        <Thumb>
          {slide.kind === 'section' ? (
            <div style={{ position: 'relative', width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
              <SectionPageView section={slide} />
              <SlideProgressBar pageId={slide.id} />
            </div>
          ) : (
            <SlideView slide={slide}>
              {/* A thumbnail shows the page, indicator and all — see `DeckPageView`. */}
              <SlideProgressBar pageId={slide.id} />
            </SlideView>
          )}
        </Thumb>
      </button>
      <div className="filmstrip__tools">
        <Tooltip label={isSection ? 'Dupliser seksjon' : 'Dupliser slide'}>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onDuplicate}
            aria-label={`Dupliser ${label.toLowerCase()}`}
            data-testid="duplicate-slide"
          >
            <Icon name="copy" size={14} />
          </button>
        </Tooltip>
        <Tooltip label={isSection ? 'Slett seksjon' : 'Slett slide'}>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onDelete}
            disabled={!canDelete}
            aria-label={`Slett ${label.toLowerCase()}`}
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
  derived,
  viewingDerivedId,
  onSelectDerived,
  onSelectAuthored,
  onRequestDelete,
  onRequestNewSlide,
  onRequestNewSection,
}: {
  presentation: Presentation
  /**
   * The generated pages: reference slides computed from the citations, and the
   * QR page while sharing is on. None of them is stored, so none of them has
   * the tools an authored slide has.
   */
  derived: DeckPage[]
  viewingDerivedId: string | null
  onSelectDerived: (pageId: string) => void
  /** Selecting an authored slide closes the derived view for good. */
  onSelectAuthored: () => void
  onRequestDelete: (slide: Slide) => void
  onRequestNewSlide: () => void
  onRequestNewSection: () => void
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
                canDelete={canDeleteSlide(presentation, slide.id)}
                onSelect={() => selectAuthored(slide.id)}
                onDuplicate={() => duplicate(slide.id, index)}
                onDelete={() => onRequestDelete(slide)}
              />
            ))}
        </SortableContext>

        {derived.map((page, index) => {
          const isQr = page.kind === 'qr'
          const label = isQr ? 'QR-side' : `Referanseslide ${index + 1}`
          return (
            <div
              key={page.id}
              className={
                page.id === viewingDerivedId
                  ? 'filmstrip__item filmstrip__item--active filmstrip__item--derived'
                  : 'filmstrip__item filmstrip__item--derived'
              }
              data-testid={isQr ? 'filmstrip-qr' : 'filmstrip-derived'}
            >
              <div className="filmstrip__index">
                <span>{presentation.slides.length + index + 1}</span>
                <span className="filmstrip__badge">Avledet</span>
              </div>
              <button
                type="button"
                className="filmstrip__thumb"
                style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
                onClick={() => onSelectDerived(page.id)}
                aria-label={label}
              >
                <Thumb>
                  <DeckPageView page={page} />
                </Thumb>
              </button>
              <div className="filmstrip__tools">
                <span className="hint">
                  {isQr ? 'Genereres av Del' : 'Genereres fra referansene'}
                </span>
              </div>
            </div>
          )
        })}
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
        <button
          type="button"
          className="btn btn--section"
          onClick={onRequestNewSection}
          data-testid="add-section"
        >
          <Icon name="plus" /> Ny seksjon
        </button>
      </div>
    </aside>
  )
}
