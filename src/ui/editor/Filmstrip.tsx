/**
 * Slide filmstrip: thumbnails, reordering, and slide-level actions.
 *
 * Thumbnails are the same `SlideView` the stage uses, scaled down — so a
 * thumbnail can never misrepresent the slide.
 */

import { useRef } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { canDeleteSlide, duplicateSlide, moveSlide } from '../../domain/commands'
import { domFitCheckers } from '../../state/measure'
import { authoredPage, type DeckPage } from '../../domain/pages'
import { useEditorStore } from '../../state/store'
import type { Presentation, Slide } from '../../domain/types'
import { DeckPageView } from '../slide/DeckPageView'
import { SlideProgressBar } from '../slide/SlideProgressBar'
import { SlideView } from '../slide/SlideView'
import { useContainerBox, type ContainerBox } from '../slide/useFitScale'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

/**
 * The desktop strip's thumbnail, and the narrowest one anywhere.
 *
 * It is a column beside the stage there, so its width is a constant: the strip
 * has exactly as much room as `--filmstrip-width` gives it, whatever the deck.
 */
const THUMB_WIDTH = 168

/** The space between entries. Set from here so the arithmetic below owns it. */
const STRIP_GAP = 10

/**
 * How much of the overview a single thumbnail may fill before the list starts
 * using columns instead.
 *
 * Not a taste: a page that fills the whole overview hides the fact that there
 * is anything under it, and the one thing a slide overview has to show is that
 * the deck goes on.
 */
const MAX_THUMB_SHARE = 0.6

export interface StripLayout {
  columns: number
  /** How wide each thumbnail is drawn, in CSS pixels. */
  width: number
}

/**
 * The overview's shape, from the room it actually has.
 *
 * Upright, a phone's panel is narrower than one thumbnail's comfortable height
 * allows, so the answer is one column of full-width pages. On its side the same
 * panel is wide and short, and the same rule answers with four smaller ones.
 * Nothing here is a breakpoint or a device: it is the box, divided until a page
 * fits in it twice over.
 */
export function stripLayout(box: ContainerBox): StripLayout {
  // Nothing measured yet: the desktop's own column, which is also the answer
  // for every surface until the observer reports one.
  if (box.width <= 0 || box.height <= 0) return { columns: 1, width: THUMB_WIDTH }
  const widest = box.height * MAX_THUMB_SHARE * (SLIDE_WIDTH / SLIDE_HEIGHT)
  const perColumn = (columns: number): number => (box.width - STRIP_GAP * (columns - 1)) / columns
  // Divide until a page is short enough to leave the next row showing — but
  // never into columns narrower than the strip draws one.
  let columns = 1
  while (perColumn(columns) > widest && perColumn(columns + 1) >= THUMB_WIDTH) columns += 1
  return { columns, width: perColumn(columns) }
}

/**
 * A page drawn at thumbnail size. Every strip entry uses this one box.
 *
 * The page inside is the full 1600 × 900 one, scaled — never a smaller variant
 * of it — so a thumbnail can no more misrepresent a slide in the overview than
 * it can in the strip.
 */
function Thumb({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        transform: `scale(${width / SLIDE_WIDTH})`,
        transformOrigin: 'top left',
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  )
}

/** What a thumbnail is called: its kind, and for an ordinary slide its number. */
function thumbLabel(slide: Slide, index: number): string {
  switch (slide.kind) {
    case 'section':
      return index === 0 ? 'Forside' : 'Seksjon'
    case 'interactive':
      return 'Interaktiv'
    case 'content':
      return `Slide ${index + 1}`
  }
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
  width,
  onSelect,
  onDuplicate,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
  canDelete,
}: {
  slide: Slide
  index: number
  active: boolean
  /** How wide the thumbnail is drawn — a column on the desktop, the overview's
      own arithmetic on a phone. See `stripLayout`. */
  width: number
  onSelect: () => void
  onDuplicate: () => void
  onDelete: () => void
  /** Reorder by a whole position, the way a finger asks for it. */
  onMove: (delta: number) => void
  canMoveUp: boolean
  canMoveDown: boolean
  canDelete: boolean
}) {
  const label = thumbLabel(slide, index)
  // Content slides are what the strip is mostly made of; the other kinds wear
  // a badge that says which they are.
  const badged = slide.kind !== 'content'
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
        {badged && <span className="filmstrip__badge">{label}</span>}
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
        style={{ width, height: (width * SLIDE_HEIGHT) / SLIDE_WIDTH }}
        onClick={onSelect}
        data-testid="filmstrip-thumb"
        data-drag-activation="hold"
        aria-label={label}
        // Semantic rather than merely outlined: which page the editor is on has
        // to be readable by something that cannot see the accent border.
        aria-current={active ? 'true' : undefined}
        {...attributes}
        {...listeners}
      >
        <Thumb width={width}>
          {slide.kind === 'content' ? (
            <SlideView slide={slide}>
              {/* A thumbnail shows the page, indicator and all — see `DeckPageView`. */}
              <SlideProgressBar pageId={slide.id} />
            </SlideView>
          ) : (
            /* A section, or the cover of an interactive slide: the same page
               the audience sees, indicator and all. Nothing here has an
               activation, so the cover's button is drawn inert — a thumbnail
               can show a miniapp and can never start one. */
            <DeckPageView page={authoredPage(slide)} />
          )}
        </Thumb>
      </button>
      <div className="filmstrip__tools">
        <Tooltip label={`Flytt ${label.toLowerCase()} opp`}>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={() => onMove(-1)}
            disabled={!canMoveUp}
            aria-label={`Flytt ${label.toLowerCase()} opp`}
            data-testid="move-slide-up"
          >
            <Icon name="arrow-up" size={14} />
          </button>
        </Tooltip>
        <Tooltip label={`Flytt ${label.toLowerCase()} ned`}>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={() => onMove(1)}
            disabled={!canMoveDown}
            aria-label={`Flytt ${label.toLowerCase()} ned`}
            data-testid="move-slide-down"
          >
            <Icon name="arrow-down" size={14} />
          </button>
        </Tooltip>
        <Tooltip label={`Dupliser ${label.toLowerCase()}`}>
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
        <Tooltip label={`Slett ${label.toLowerCase()}`}>
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
  onRequestNewInteractive,
  overview = false,
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
  onRequestNewInteractive: () => void
  /**
   * Whether this is the compact workspace's full-screen slide overview rather
   * than the desktop's side column.
   *
   * The only thing it changes is how big a page is drawn: same component, same
   * entries, same commands, same reorder controls. A column beside a stage has
   * a fixed width to work with; an overview has the screen.
   */
  overview?: boolean
}) {
  const listRef = useRef<HTMLDivElement>(null)
  /*
   * The overview's thumbnails are as big as the room allows, so the room has to
   * be measured. The same observer the stage uses, on the box the entries are
   * actually laid out in — there is no second idea anywhere of how wide a
   * thumbnail is, and therefore nothing that can disagree about it.
   */
  const box = useContainerBox(listRef)
  const layout = overview ? stripLayout(box) : { columns: 1, width: THUMB_WIDTH }
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

  /*
   * Reordering by a position rather than by a gesture. The same command the
   * drag commits, fit-validated for the same reason: moving a slide renumbers
   * citations, which can widen a label on a slide nobody touched.
   *
   * The moved slide is selected afterwards, so the strip scrolls to where the
   * page went instead of leaving the user looking at whatever took its place.
   */
  const move = (slideId: string, index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= presentation.slides.length) return
    if (!run('reorder-slide', (current) => moveSlide(current, slideId, target, domFitCheckers))) {
      return
    }
    selectAuthored(slideId)
  }

  return (
    <aside className="filmstrip" data-testid="filmstrip" data-overview={overview ? '' : undefined}>
      <div
        className="filmstrip__list"
        data-testid="filmstrip-list"
        ref={listRef}
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gap: STRIP_GAP,
        }}
      >
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
                width={layout.width}
                canDelete={canDeleteSlide(presentation, slide.id)}
                onSelect={() => selectAuthored(slide.id)}
                onDuplicate={() => duplicate(slide.id, index)}
                onDelete={() => onRequestDelete(slide)}
                onMove={(delta) => move(slide.id, index, delta)}
                canMoveUp={index > 0}
                canMoveDown={index < presentation.slides.length - 1}
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
                style={{ width: layout.width, height: (layout.width * SLIDE_HEIGHT) / SLIDE_WIDTH }}
                onClick={() => onSelectDerived(page.id)}
                aria-label={label}
                aria-current={page.id === viewingDerivedId ? 'true' : undefined}
              >
                <Thumb width={layout.width}>
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
          <Icon name="plus" /> Slide
        </button>
        <button
          type="button"
          className="btn btn--section"
          onClick={onRequestNewSection}
          data-testid="add-section"
        >
          <Icon name="plus" /> Seksjon
        </button>
        <button
          type="button"
          className="btn btn--interactive"
          onClick={onRequestNewInteractive}
          data-testid="add-interactive"
        >
          <Icon name="plus" /> Interaktiv
        </button>
      </div>
    </aside>
  )
}
