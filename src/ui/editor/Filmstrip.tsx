/**
 * Slide filmstrip: thumbnails, reordering, and slide-level actions.
 *
 * Thumbnails are the same `SlideView` the stage uses, scaled down — so a
 * thumbnail can never misrepresent the slide.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDndContext } from '@dnd-kit/core'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { duplicateSlide, moveSlide } from '../../domain/commands'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import { authoredPage, type DeckPage } from '../../domain/pages'
import { useEditorStore } from '../../state/store'
import type { Presentation, Slide } from '../../domain/types'
import { DeckPageView } from '../slide/DeckPageView'
import { SlideProgressBar } from '../slide/SlideProgressBar'
import { SlideView } from '../slide/SlideView'
import { useContainerBox, type ContainerBox } from '../slide/useFitScale'
import { anchorInside, useContextMenu, type MenuAnchor, type MenuEntry } from '../components/contextMenu'
import { Icon } from '../components/Icon'
import { MenuButton } from '../components/MenuButton'
import { slideMenu, type SlideMenuHandlers } from './contextMenu/slideMenu'
import { FilmstripInsert } from './FilmstripInsert'
import {
  NEW_PAGE_OPTIONS,
  insertionIndex,
  newPageEntries,
  pageKindName,
  pageName,
  placementText,
  type NewPageRequest,
} from './pageKinds'

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

/** Where a scroll box and one of its entries currently are, in CSS pixels. */
export interface ScrollGeometry {
  /** The box's current `scrollTop`. */
  scrollTop: number
  /** How much of the content the box shows at once (`clientHeight`). */
  viewHeight: number
  /** The whole content's height (`scrollHeight`). */
  contentHeight: number
  /** The entry's top, measured from the top of the box's visible area. */
  itemTop: number
  itemHeight: number
}

/**
 * The `scrollTop` that puts an entry in the middle of its scroll box — or as
 * near the middle as the box can get, when the entry is so close to either end
 * that centring it would mean scrolling past the content.
 */
export function centredScrollTop(geometry: ScrollGeometry): number {
  const { scrollTop, viewHeight, contentHeight, itemTop, itemHeight } = geometry
  const target = scrollTop + itemTop + itemHeight / 2 - viewHeight / 2
  return Math.min(Math.max(0, target), Math.max(0, contentHeight - viewHeight))
}

/**
 * Keeps the page being shown in the middle of the strip.
 *
 * It follows the page, not the scroll: it moves the list when a different page
 * becomes the shown one — however that happened, a click, an arrow key, the
 * wheel over the stage — and leaves it alone otherwise, so the strip can still
 * be scrolled by hand to look at the rest of the deck. The first placement, and
 * any placement after the thumbnails are resized, is instant: there is nothing
 * to follow, only a place to be.
 *
 * A page that moves while it is the shown one keeps its id, so the call that
 * moved it asks to be followed with the returned function. Only that call does:
 * a slide dragged past the shown one moves it too, but nobody asked to look.
 */
function useCentredActivePage(
  listRef: React.RefObject<HTMLDivElement | null>,
  activePageId: string | null,
  layout: StripLayout,
): () => void {
  const [request, setRequest] = useState(0)
  const followed = useRef<{ pageId: string; request: number } | null>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || activePageId === null) return
    const item = Array.from(list.querySelectorAll<HTMLElement>('[data-page-id]')).find(
      (element) => element.dataset.pageId === activePageId,
    )
    if (!item) return
    const listBox = list.getBoundingClientRect()
    const itemBox = item.getBoundingClientRect()
    const top = centredScrollTop({
      scrollTop: list.scrollTop,
      viewHeight: list.clientHeight,
      contentHeight: list.scrollHeight,
      itemTop: itemBox.top - listBox.top - list.clientTop,
      itemHeight: itemBox.height,
    })
    const previous = followed.current
    const moved =
      previous !== null && (previous.pageId !== activePageId || previous.request !== request)
    followed.current = { pageId: activePageId, request }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    list.scrollTo({ top, behavior: moved && !still ? 'smooth' : 'instant' })
  }, [listRef, activePageId, request, layout.columns, layout.width])
  return () => setRequest((count) => count + 1)
}

/**
 * A page drawn at thumbnail size. Every strip entry uses this one box.
 *
 * The page inside is the full 1600 × 900 one, scaled — never a smaller variant
 * of it — so a thumbnail can no more misrepresent a slide in the overview than
 * it can in the strip.
 */
function Thumb({ width, children }: { width: number; children: React.ReactNode }) {
  // A picture of the page, not a second copy of it: the button it sits in is
  // named by the page, and a screen reader reading every slide's words out of
  // every thumbnail would bury that name. `inert` rather than only hidden, so
  // what the page holds that could take focus — a link in its text — is not a
  // tab stop inside the button either, where Enter would follow the link
  // instead of opening the slide.
  return (
    <div
      inert
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

/**
 * One authored slide in the strip.
 *
 * Everything above the menu button — the number row and the thumbnail — is
 * both the way to the slide and the way to move it: a click navigates, a press
 * that moves (or, on a touch screen, rests) starts the drag. Which of the two a
 * press becomes is decided by `data-drag-activation` — see
 * `dragActivation.ts` — so the surface can carry the drag listeners without
 * ever swallowing an ordinary click. The grip keeps the immediate activation a
 * dedicated handle should have, and is the affordance that says this entry
 * can be moved at all.
 *
 * Everything else a page can have done to it is in its menu (`slideMenu`):
 * one visible button on every entry, the same list from a right-click and from
 * Shift+F10 on the thumbnail. That is also the way to reorder without
 * dragging, for a finger and for the keyboard.
 *
 * The front page is the one authored slide that is neither a drag surface nor
 * a place to drop one: it is what the deck opens with, so it has no grip and
 * nothing lands in its place by dragging. The commands still own the rule — a
 * section moved up there with the menu becomes the front page — but a gesture
 * that could only ever be refused is not offered.
 */
function SlideThumb({
  slide,
  index,
  active,
  width,
  onSelect,
  menu,
  insert,
}: {
  slide: Slide
  index: number
  active: boolean
  /** How wide the thumbnail is drawn — a column on the desktop, the overview's
      own arithmetic on a phone. See `stripLayout`. */
  width: number
  onSelect: () => void
  /** The page's menu — see `slideMenu`. */
  menu: PageMenu
  /** The gap above this slide, where a page can be put between it and the one
      before — when there is one to offer. See `FilmstripInsert`. */
  insert?: React.ReactNode
}) {
  const label = pageName(slide.kind, index)
  // Content slides are what the strip is mostly made of; the other kinds wear
  // a badge that says which they are.
  const badged = slide.kind !== 'content'
  const frontPage = index === 0
  /** What last pressed the entry — see the context menu below. */
  const pressedBy = useRef('mouse')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.id,
    data: { kind: 'slide' },
    disabled: frontPage,
  })

  return (
    // The slot is what the sort measures, and what holds the gap above the
    // entry: the entry itself clips, and the gap is outside it. The entry is
    // what is drawn moving — no gap is offered while a slide is dragged, so the
    // two are the same box whenever there is a transform to apply.
    <div ref={setNodeRef} className="filmstrip__slot">
      {insert}
      <div
        className={active ? 'filmstrip__item filmstrip__item--active' : 'filmstrip__item'}
        style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
        data-testid="filmstrip-item"
        data-slide-id={slide.id}
        data-page-id={slide.id}
        // The page's own menu, wherever on the entry it is asked for. The
        // editor's Shift+F10 leaves an entry to this handler — see `EditorView`.
        data-page-menu=""
        onPointerDownCapture={(event) => {
          pressedBy.current = event.pointerType
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          // A finger resting on an entry is picking it up to move it, and the
          // browser reports that same press as a context menu too: there the
          // press keeps its meaning, and the menu is the visible button's.
          if (pressedBy.current === 'touch') return
          menu.open({ x: event.clientX, y: event.clientY }, false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            menu.open(anchorInside(event.currentTarget), true)
          }
        }}
      >
        {/*
          The click is the handle's, not only the thumbnail's, so the number
          row navigates as well; the thumbnail's own click — a tap, or Enter
          from the keyboard — bubbles up to it.
        */}
        <div
          className="filmstrip__handle"
          onClick={onSelect}
          data-drag-activation="surface"
          data-draggable={frontPage ? undefined : ''}
          {...listeners}
        >
          <div className="filmstrip__index">
            <span className="filmstrip__number">{index + 1}</span>
            {badged && <span className="filmstrip__badge">{pageKindName(slide.kind, index)}</span>}
            {!frontPage && (
              <span className="filmstrip__grip" aria-hidden="true" data-drag-activation="immediate">
                <Icon name="grip" size={14} />
              </span>
            )}
          </div>
          <button
            type="button"
            className="filmstrip__thumb"
            style={{ width, height: (width * SLIDE_HEIGHT) / SLIDE_WIDTH }}
            data-testid="filmstrip-thumb"
            aria-label={label}
            // Semantic rather than merely outlined: which page the editor is on has
            // to be readable by something that cannot see the accent border.
            aria-current={active ? 'true' : undefined}
            // Only a slide that can be dragged is announced as sortable: on the
            // front page these would also mark the button disabled, which it is not.
            {...(frontPage ? {} : attributes)}
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
        </div>
        {/*
          Drawn over the end of the number row, where the eye already is, but
          outside the handle: a press on it neither navigates nor drags.
        */}
        <MenuButton
          id={menu.owner}
          label={`Flere handlinger for ${label.toLowerCase()}`}
          title={menu.title}
          tooltip="Flere handlinger"
          icon="more"
          className="btn--icon menu-button--icon filmstrip__more"
          testId="slide-more"
          entries={menu.entries}
        />
      </div>
    </div>
  )
}

/** One page's menu, as the entry needs it: for its button, and at a place. */
interface PageMenu {
  /** Which menu this is, so its button can say whether it is the one open. */
  owner: string
  title: string
  entries: () => MenuEntry[]
  open: (anchor: MenuAnchor, keyboard: boolean) => void
}

/** «Ny slide» is the strip's own button; the other kinds are in its menu. */
const newSlide = NEW_PAGE_OPTIONS.find((option) => option.kind === 'content') ?? NEW_PAGE_OPTIONS[0]
const otherNewPages = NEW_PAGE_OPTIONS.filter((option) => option !== newSlide)

export function Filmstrip({
  presentation,
  derived,
  viewingDerivedId,
  onSelectDerived,
  onSelectAuthored,
  onRequestDelete,
  onRequestNewPage,
  overview = false,
  onMoveToSandbox,
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
  /** Ask for a new page: where the author pointed, or after the current slide. */
  onRequestNewPage: (request: NewPageRequest) => void
  /**
   * Whether this is the compact workspace's full-screen slide overview rather
   * than the desktop's side column.
   *
   * The only thing it changes is how big a page is drawn: same component, same
   * entries, same commands, same reorder controls. A column beside a stage has
   * a fixed width to work with; an overview has the screen.
   */
  overview?: boolean
  onMoveToSandbox: (slideId: string) => void
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
  const followActivePage = useCentredActivePage(listRef, viewingDerivedId ?? currentSlideId, layout)
  const selectSlide = useEditorStore((state) => state.selectSlide)
  const selectAuthored = (slideId: string): void => {
    onSelectAuthored()
    selectSlide(slideId)
  }
  const run = useEditorStore((state) => state.run)
  /*
   * The gap the pointer has opened, by the slide below it. "Between two slides"
   * only means something in a single column — in a grid the page before is
   * beside, not above — and nothing opens while a slide is being dragged.
   */
  const [openGap, setOpenGap] = useState<string | null>(null)
  const dragging = useDndContext().active !== null
  const offersGaps = layout.columns === 1 && !dragging
  /** Ett mellomroms del av denne tilstanden, navngitt etter oppføringen under det. */
  const gap = (id: string) => ({
    id,
    open: openGap === id,
    onOpenChange: (open: boolean) =>
      setOpenGap((current) => (open ? id : current === id ? null : current)),
  })
  /** Siste vanlige slide — den nye siden fra mellomrommet over de avledede kommer etter den. */
  const lastSlide = presentation.slides[presentation.slides.length - 1]
  /*
   * The order the sort works from, kept as the same array for as long as the
   * deck's slides are. Reading the drag context above re-renders the strip every
   * time the dragged slide passes another, and a fresh array each time tells
   * dnd-kit the list itself has changed — which switches the slide-in animation
   * off for every entry that is moving away from its own place. Only the move
   * back would then be animated, and every move has to be.
   */
  const slideIds = useMemo(
    () => presentation.slides.map((slide) => slide.id),
    [presentation.slides],
  )

  const openMenu = useContextMenu((state) => state.open)

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
   * The moved slide is selected and followed afterwards, so the strip scrolls
   * to where the page went instead of leaving the user looking at whatever
   * took its place.
   */
  const move = (slideId: string, index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= presentation.slides.length) return
    if (!run('reorder-slide', (current) => moveSlide(current, slideId, target, HUMAN_EDIT))) {
      return
    }
    selectAuthored(slideId)
    followActivePage()
  }

  /** One page's menu: built when it is opened, from the deck as it is then. */
  const menuFor = (slide: Slide, index: number): PageMenu => {
    const owner = `slide-menu-${slide.id}`
    const handlers: SlideMenuHandlers = {
      move: (delta) => move(slide.id, index, delta),
      duplicate: () => duplicate(slide.id, index),
      remove: () => onRequestDelete(slide),
      toSandbox: () => onMoveToSandbox(slide.id),
      insertAfter: (kind) => onRequestNewPage({ kind, after: slide.id }),
    }
    const build = () => slideMenu(presentation, index, handlers)
    return {
      owner,
      title: pageName(slide.kind, index),
      entries: () => build().entries,
      open: (anchor: MenuAnchor, keyboard: boolean) => {
        const built = build()
        openMenu({ anchor, title: built.title, entries: built.entries, keyboard, owner })
      },
    }
  }

  /*
   * Where «Ny slide» puts the page: right after the slide being worked on.
   * Said under the button, in the strip's own numbering, so the place is known
   * before the button is pressed.
   */
  const placement = placementText(
    presentation.slides,
    insertionIndex(presentation.slides, {}, currentSlideId),
  )

  return (
    <aside
      className="filmstrip"
      data-testid="filmstrip"
      aria-label="Slideoversikt"
      data-overview={overview ? '' : undefined}
    >
      <div
        className="filmstrip__list"
        data-testid="filmstrip-list"
        ref={listRef}
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gap: STRIP_GAP,
          ['--strip-gap' as string]: `${STRIP_GAP}px`,
        }}
      >
        {/*
          The strategy has to match the shape the entries are actually in.
          `verticalListSortingStrategy` assumes one column and moves the others
          straight up and down past the dragged one; in the overview's grid
          that is the wrong animation and the wrong drop target. `rectSorting`
          makes no such assumption, and the strip is a grid of one column.
        */}
        <SortableContext
            items={slideIds}
            strategy={layout.columns > 1 ? rectSortingStrategy : verticalListSortingStrategy}
          >
            {presentation.slides.map((slide, index) => (
              <SlideThumb
                key={slide.id}
                slide={slide}
                index={index}
                active={slide.id === currentSlideId && viewingDerivedId === null}
                width={layout.width}
                onSelect={() => selectAuthored(slide.id)}
                menu={menuFor(slide, index)}
                insert={
                  offersGaps && index > 0 ? (
                    <FilmstripInsert
                      {...gap(slide.id)}
                      onChoose={(kind) => onRequestNewPage({ kind, before: slide.id })}
                    />
                  ) : undefined
                }
              />
            ))}
        </SortableContext>

        {/*
          De avledede sidene kommer etter de vanlige, så mellomrommet over den
          første av dem er plassen etter siste vanlige slide — det samme
          mellomrommet, på samme vilkår, som mellom to slides. En ny side som
          settes inn der, er en vanlig side og havner foran alle avledede.
        */}
        {derived.map((page, index) => {
          const isQr = page.kind === 'qr'
          const label = isQr ? 'QR-side' : `Referanseslide ${index + 1}`
          return (
            <div key={page.id} className="filmstrip__slot">
              {offersGaps && index === 0 && lastSlide && (
                <FilmstripInsert
                  {...gap(page.id)}
                  onChoose={(kind) => onRequestNewPage({ kind, after: lastSlide.id })}
                />
              )}
              <div
                className={
                  page.id === viewingDerivedId
                    ? 'filmstrip__item filmstrip__item--active filmstrip__item--derived'
                    : 'filmstrip__item filmstrip__item--derived'
                }
                data-testid={isQr ? 'filmstrip-qr' : 'filmstrip-derived'}
                data-page-id={page.id}
              >
                <div className="filmstrip__index">
                  <span className="filmstrip__number">{presentation.slides.length + index + 1}</span>
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
                <p className="filmstrip__note">
                  {isQr ? 'Genereres av Del' : 'Genereres fra referansene'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      {/*
        The way to a new page. «Ny slide» is what is added most, so it is the
        button; a section and a miniapp are in the menu beside it, under the
        same names and icons the gaps and the slide menu use.
      */}
      <div className="filmstrip__footer">
        <p className="filmstrip__placement" data-testid="new-page-placement">
          Kommer {placement}
        </p>
        <div className="filmstrip__new">
          <button
            type="button"
            className="btn btn--sm filmstrip__new-slide"
            onClick={() => onRequestNewPage({ kind: newSlide.kind })}
            data-testid={`add-${newSlide.id}`}
          >
            <Icon name="plus" size={15} /> {newSlide.label}
          </button>
          <MenuButton
            id="new-page"
            label="Ny inndeling eller miniapp"
            title={`Ny side ${placement}`}
            tooltip="Ny inndeling eller miniapp"
            icon="chevron-down"
            className="btn--icon menu-button--icon filmstrip__new-more"
            testId="add-page-menu"
            entries={() =>
              newPageEntries((kind) => onRequestNewPage({ kind }), 'add', otherNewPages)
            }
          />
        </div>
      </div>
    </aside>
  )
}
