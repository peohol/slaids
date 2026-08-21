/**
 * Idéer – one floating window with the list belonging to the presentation.
 *
 * The window exists for what you think of *while* you are building: an idea is
 * noted at the side, and deleted again once it is on a slide. That is why it
 * floats rather than sitting in the document — it stays where you put it in the
 * viewport, and does not travel with the slide.
 *
 * The list is built the way mdeditz builds it, and this is a port of that
 * behaviour rather than a component that happens to look like it. Each idea is
 * a card; the cards are dragged to change their order; a cross on the right
 * deletes. Categories group ideas at exactly one level — a category holds
 * ideas, never other categories — and they sit in the same ordered list as the
 * loose ideas, so a note that belongs to nothing can stand between two of them.
 *
 * Two kinds of state, two kinds of storage:
 *
 * - **The ideas are content, and belong to one presentation.** They live on the
 *   presentation in the same state as the slides, go through the domain
 *   commands, and are persisted with everything else.
 * - **The window is furniture.** Where it stands, how big it is and whether it
 *   is open are things you choose for the screen you are sitting at — not for
 *   the presentation — and live in localStorage.
 *
 * The dragging is deliberately not dnd-kit. A press-and-hold on touch, a few
 * pixels of movement on a mouse, a placeholder that shows the gap, a lifted
 * card that follows the pointer and a list that scrolls at its edges is a
 * gesture, not a sortable list; the model in `src/domain/ideas.ts` decides the
 * outcome, and this decides how it feels.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { addIdea, addIdeaCategory, moveIdeaRow, removeIdeaRow, setIdeaText } from '../../domain/commands'
import {
  MAX_IDEAS,
  MAX_IDEA_LENGTH,
  containerIn,
  countIdeas,
  countRows,
  findRow,
  isCategory,
  oneLine,
  rowLocation,
} from '../../domain/ideas'
import type { IdeaCategory, IdeaRow, Idea as IdeaRowData } from '../../domain/types'
import { useEditorStore } from '../../state/store'
import { DEFAULT_IDEAS_GEOMETRY } from '../../state/prefs'
import { FloatingWindow } from '../components/FloatingWindow'
import { Icon } from '../components/Icon'

/*
 * Drag thresholds. On touch the drag waits out a hold, so that a vertical swipe
 * still scrolls the list; on a mouse it starts as soon as the pointer has moved
 * a little with the button down. The distance is measured as the crow flies
 * from the press, so a diagonal counts as much as a straight one.
 */
const HOLD_MS = 200
const HOLD_MOVE = 10
const HOLD_MOVE_MOUSE = 5

/** The zone at the top and bottom of the list that scrolls while you drag over it. */
const SCROLL_EDGE = 30
const SCROLL_STEP = 10

interface Drag {
  rowId: string
  el: HTMLElement
  placeholder: HTMLLIElement
  pointerId: number
  grabX: number
  grabY: number
  x: number
  y: number
  stop: () => void
}

interface Editing {
  id: string
  /** A row that was just made carries a placeholder: it goes as soon as you type. */
  selectAll: boolean
}

/** Grow a textarea with its text, so a long idea is readable while it is fixed. */
function grow(field: HTMLTextAreaElement): void {
  field.style.height = 'auto'
  field.style.height = `${field.scrollHeight}px`
}

export function IdeasWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)

  const rows = presentation?.ideas ?? []
  /* The list as the pointer and the keyboard see it. Both act after a paint, so
     an effect-synced mirror is always the list that is on screen. */
  const rowsRef = useRef<IdeaRow[]>(rows)

  const listRef = useRef<HTMLUListElement | null>(null)
  const fieldRef = useRef<HTMLTextAreaElement | null>(null)
  const editFieldRef = useRef<HTMLTextAreaElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const scrollFrameRef = useRef(0)
  /** A finished drag swallows the click that would otherwise follow it. */
  const draggedRef = useRef(false)

  const [editing, setEditing] = useState<Editing | null>(null)
  const editingRef = useRef<Editing | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    rowsRef.current = rows
    editingRef.current = editing
  })

  const full = countRows(rows) >= MAX_IDEAS
  const ideaCount = countIdeas(rows)

  /** The scrolling area the list sits in — the window's body. */
  const bodyOf = useCallback(
    (): HTMLElement | null =>
      listRef.current?.closest<HTMLElement>('.floating-window__body') ?? null,
    [],
  )

  /** The row as the keyboard sees it: the card itself, or a category's heading. */
  const rowElement = useCallback((id: string): HTMLElement | null => {
    const list = listRef.current
    if (!list) return null
    return (
      list.querySelector<HTMLElement>(`.idea[data-id="${id}"]`) ??
      list.querySelector<HTMLElement>(`.idea-cat[data-id="${id}"] > .idea-cat-head`)
    )
  }, [])

  /* ----------------------------------------------------------------- editing */

  /**
   * End an open edit.
   *
   * Enter saves, Escape cancels, and a press somewhere else saves — an edit you
   * walk away from is finished, not discarded. Empty text is no change: the old
   * text still stands.
   *
   * Enter and Escape are keyboard actions, so focus stays in the list, on the
   * row just written, and Alt + arrow keeps working. A press elsewhere is
   * something else: there the user has already chosen where focus goes.
   */
  const finishEdit = useCallback(
    (keep: boolean, refocus = false): void => {
      const current = editingRef.current
      if (!current) return
      const text = keep ? (editFieldRef.current?.value ?? '') : ''
      // Cleared first: the blur that follows must not run this a second time.
      editingRef.current = null
      editFieldRef.current = null
      setEditing(null)
      if (oneLine(text)) {
        run('idea-text', (state) => setIdeaText(state, current.id, text))
      }
      if (refocus) requestAnimationFrame(() => rowElement(current.id)?.focus())
    },
    [rowElement, run],
  )

  const beginEdit = useCallback((id: string, selectAll = false): void => {
    if (editingRef.current || dragRef.current) return
    setEditing({ id, selectAll })
  }, [])

  /* -------------------------------------------------------------------- drag */

  const moveDragged = useCallback((): void => {
    const drag = dragRef.current
    if (!drag) return
    drag.el.style.left = `${drag.x - drag.grabX}px`
    drag.el.style.top = `${drag.y - drag.grabY}px`
  }, [])

  /**
   * Put the placeholder where the row would land if you let go now.
   *
   * The container is the one you are hovering: an idea may end up in a
   * category, a category only at the root. Within the container the row goes
   * before the first neighbour the pointer is past the middle of — and last if
   * it is below all of them.
   */
  const placePlaceholder = useCallback((): void => {
    const drag = dragRef.current
    const body = bodyOf()
    if (!drag || !body) return
    const under = document.elementFromPoint(drag.x, drag.y)
    // Outside the list the placeholder stays put, so a drag that swings out of
    // the window does not lose the place you were aiming at.
    if (!under || !body.contains(under)) return

    const category = drag.el.classList.contains('idea-cat') ? null : under.closest('.idea-cat')
    const container = category
      ? category.querySelector<HTMLElement>('.idea-cat-items')
      : listRef.current
    if (!container) return

    let before: Element | null = null
    for (const child of container.children) {
      if (child === drag.placeholder || child === drag.el) continue
      const rect = child.getBoundingClientRect()
      if (drag.y < rect.top + rect.height / 2) {
        before = child
        break
      }
    }
    if (drag.placeholder.parentNode === container && drag.placeholder.nextElementSibling === before) {
      return
    }
    container.insertBefore(drag.placeholder, before)
  }, [bodyOf])

  /** How many pixels the list should scroll now: 0 outside the edge zones. */
  const edgeStep = useCallback((): number => {
    const drag = dragRef.current
    const body = bodyOf()
    if (!drag || !body) return 0
    const box = body.getBoundingClientRect()
    if (drag.y < box.top + SCROLL_EDGE && body.scrollTop > 0) return -SCROLL_STEP
    const rest = body.scrollHeight - body.clientHeight - body.scrollTop
    if (drag.y > box.bottom - SCROLL_EDGE && rest > 0) return SCROLL_STEP
    return 0
  }, [bodyOf])

  /** Keep the list rolling for as long as the pointer sits in an edge zone. */
  const autoScroll = useCallback((): void => {
    if (scrollFrameRef.current || !edgeStep()) return
    const tick = (): void => {
      scrollFrameRef.current = 0
      const body = bodyOf()
      if (!dragRef.current || !body) return
      const step = edgeStep()
      if (!step) return
      body.scrollTop += step
      // The rows have moved under the pointer, so the place has to be worked out
      // again even though nothing was moved.
      placePlaceholder()
      scrollFrameRef.current = requestAnimationFrame(tick)
    }
    scrollFrameRef.current = requestAnimationFrame(tick)
  }, [bodyOf, edgeStep, placePlaceholder])

  /** Clean up after the drag. The row itself is redrawn by React, not put back. */
  const endDrag = useCallback((): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = 0
    drag.stop()
    drag.el.classList.remove('is-dragging', 'is-pressed')
    drag.el.style.width = ''
    drag.el.style.left = ''
    drag.el.style.top = ''
    drag.placeholder.remove()
    setDragging(false)
  }, [])

  const startDrag = useCallback(
    (el: HTMLElement, rowId: string, point: { x: number; y: number }, pointerId: number): void => {
      const body = bodyOf()
      if (!body || !el.parentNode) return

      const rect = el.getBoundingClientRect()
      const placeholder = document.createElement('li')
      placeholder.className = 'idea-ph'
      placeholder.style.height = `${rect.height}px`
      el.parentNode.insertBefore(placeholder, el)

      const onMove = (event: PointerEvent): void => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        drag.x = event.clientX
        drag.y = event.clientY
        moveDragged()
        placePlaceholder()
        autoScroll()
      }
      const onUp = (event: PointerEvent): void => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        const container = drag.placeholder.parentElement
        const categoryId = container?.dataset.category ?? null
        // Where the placeholder stands, without the lifted row: exactly the
        // index `moveIdeaRow` reads.
        const index = [...(container?.children ?? [])]
          .filter((child) => child !== drag.el)
          .indexOf(drag.placeholder)
        endDrag()
        if (index > -1) {
          run('idea-move', (state) => moveIdeaRow(state, rowId, categoryId, index))
        }
      }
      const onCancel = (event: PointerEvent): void => {
        const drag = dragRef.current
        if (drag && event.pointerId === drag.pointerId) endDrag()
      }
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || !dragRef.current) return
        event.preventDefault()
        event.stopPropagation()
        endDrag()
      }
      const blockTouchScroll = (event: TouchEvent): void => {
        if (dragRef.current && event.cancelable) event.preventDefault()
      }

      dragRef.current = {
        rowId,
        el,
        placeholder,
        pointerId,
        grabX: point.x - rect.left,
        grabY: point.y - rect.top,
        x: point.x,
        y: point.y,
        stop: () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onCancel)
          window.removeEventListener('keydown', onKey, true)
          body.removeEventListener('touchmove', blockTouchScroll)
        },
      }

      el.classList.remove('is-pressed')
      el.classList.add('is-dragging')
      el.style.width = `${rect.width}px`
      setDragging(true)
      moveDragged()

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
      // The finger started on a surface that scrolls normally, so the browser
      // has to be stopped actively while the drag is on. Non-passive, or
      // `preventDefault` does not bite.
      body.addEventListener('touchmove', blockTouchScroll, { passive: false })
    },
    [autoScroll, bodyOf, endDrag, moveDragged, placePlaceholder, run],
  )

  /**
   * Arm a drag: press-and-hold on touch, movement with the button down on a mouse.
   *
   * `dragEl` is what gets lifted: for an idea that is the card you pressed, for
   * a category the whole category, heading and contents.
   */
  const armDrag = useCallback(
    (event: React.PointerEvent, rowId: string, dragEl: HTMLElement | null, except: string): void => {
      draggedRef.current = false
      if (event.button !== 0 || event.isPrimary === false) return
      if ((event.target as Element).closest(`.idea-edit, ${except}`)) return
      if (!dragEl) return
      event.preventDefault() // no text selection while you hold

      const pointerId = event.pointerId
      const mouse = event.pointerType === 'mouse'
      const start = { x: event.clientX, y: event.clientY }
      let last = start
      let timer = 0

      const disarm = (): void => {
        clearTimeout(timer)
        timer = 0
        dragEl.classList.remove('is-pressed')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      function startNow(): void {
        disarm()
        // Anything may have changed between the press and now: the list may have
        // been redrawn, another drag may have begun, the editor may have opened.
        if (!dragEl?.isConnected || dragRef.current || editingRef.current) return
        draggedRef.current = true
        startDrag(dragEl, rowId, last, pointerId)
      }
      function onMove(move: PointerEvent): void {
        if (move.pointerId !== pointerId) return
        last = { x: move.clientX, y: move.clientY }
        const limit = mouse ? HOLD_MOVE_MOUSE : HOLD_MOVE
        const dx = last.x - start.x
        const dy = last.y - start.y
        if (dx * dx + dy * dy <= limit * limit) return
        // Mouse: the movement *is* the drag. Touch: movement before the hold is
        // out is a swipe, and then the list should scroll as it otherwise does.
        if (mouse) startNow()
        else disarm()
      }
      function onUp(up: PointerEvent): void {
        if (up.pointerId === pointerId) disarm()
      }

      if (!mouse) {
        dragEl.classList.add('is-pressed')
        timer = window.setTimeout(startNow, HOLD_MS)
      }
      // The pointer may be released outside the zone. Without the window
      // listening, the hold would stay armed and start a drag after the finger
      // had already been lifted.
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [startDrag],
  )

  /** Swallow the click a finished drag would otherwise deliver to the row. */
  const swallowClick = useCallback((event: React.MouseEvent): void => {
    if (!draggedRef.current) return
    draggedRef.current = false
    event.stopPropagation()
    event.preventDefault()
  }, [])

  /**
   * A click on the row focuses it, so Alt + arrow works on the one you just
   * touched. It has to be done by hand: `pointerdown` is prevented to keep text
   * selection away while you hold, and then the press does not focus by itself.
   */
  const focusOnClick = useCallback((event: React.MouseEvent): void => {
    const target = event.target as Element
    if (target.closest('button, .idea-text, .idea-cat-title, .idea-edit')) return
    ;(event.currentTarget as HTMLElement).focus()
  }, [])

  /* ---------------------------------------------------------------- commands */

  const addFromField = useCallback((): void => {
    const field = fieldRef.current
    if (!field || !oneLine(field.value)) return
    const text = field.value
    field.value = ''
    field.style.height = ''
    run('idea-add', (state) => addIdea(state, { categoryId: null, text }))
    // Focus stays: one idea often leads to the next.
    field.focus()
    const body = bodyOf()
    if (body) body.scrollTop = body.scrollHeight
  }, [bodyOf, run])

  /** A new idea in a category — with the editor open on it. */
  const addTo = useCallback(
    (categoryId: string): void => {
      if (!run('idea-add', (state) => addIdea(state, { categoryId, text: 'Ny idé' }))) return
      const added = containerIn(useEditorStore.getState().presentation?.ideas ?? [], categoryId)?.at(-1)
      if (!added) return
      requestAnimationFrame(() => {
        rowElement(added.id)?.scrollIntoView({ block: 'nearest' })
        beginEdit(added.id, true)
      })
    },
    [beginEdit, rowElement, run],
  )

  const addCategory = useCallback((): void => {
    if (!run('idea-category-add', (state) => addIdeaCategory(state, 'Kategori'))) return
    const added = useEditorStore.getState().presentation?.ideas.at(-1)
    if (!added) return
    requestAnimationFrame(() => {
      rowElement(added.id)?.scrollIntoView({ block: 'nearest' })
      beginEdit(added.id, true)
    })
  }, [beginEdit, rowElement, run])

  /**
   * Moving without a pointer.
   *
   * Alt + arrow up/down moves the row one step within its container. Alt +
   * right takes an idea into the category right above it, Alt + left out of the
   * category again.
   */
  const moveByKey = useCallback(
    (id: string, key: string): boolean => {
      const current = rowsRef.current
      const at = rowLocation(current, id)
      if (!at) return false
      const row = findRow(current, id)
      if (!row) return false

      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const step = key === 'ArrowUp' ? -1 : 1
        const siblings = containerIn(current, at.categoryId) ?? []
        // At either end of the container there is nowhere to go. Without this
        // the row would stand still while the list was rewritten.
        if (at.index + step < 0 || at.index + step > siblings.length - 1) return false
        return run('idea-move', (state) => moveIdeaRow(state, id, at.categoryId, at.index + step))
      }
      if (isCategory(row)) return false

      if (key === 'ArrowLeft') {
        if (!at.categoryId) return false
        const outer = current.findIndex((entry) => entry.id === at.categoryId)
        return run('idea-move', (state) => moveIdeaRow(state, id, null, outer + 1))
      }
      if (key === 'ArrowRight') {
        if (at.categoryId) return false
        // The category right above: the one you would file the idea under if the
        // list were text.
        const above = current
          .slice(0, at.index)
          .reverse()
          .find(isCategory)
        if (!above) return false
        return run('idea-move', (state) => moveIdeaRow(state, id, above.id, above.ideas.length))
      }
      return false
    },
    [run],
  )

  /* ---------------------------------------------------------------- listeners */

  /*
   * One press, two duties.
   *
   * An open edit is ended by ANY press elsewhere in the window: presses are
   * prevented in two places — on the buttons just below, and on the rows, which
   * are drag zones — and a field that keeps focus gets no `blur` to save on.
   *
   * And the buttons must never take the selection from the new-idea field: you
   * note an idea and carry on writing, and the caret should stay where you left
   * it. The field and the editor are the exception — they *should* have focus.
   */
  const onWindowPointerDown = useCallback(
    (event: React.PointerEvent): void => {
      const target = event.target as Element
      if (editingRef.current && !target.closest('.idea-edit')) finishEdit(true)
      if (target.closest('button')) event.preventDefault()
    },
    [finishEdit],
  )

  const onWindowKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      /* Escape is "back to the slide", not "close the window": the window is
         closed with its cross, and a note you have finished writing is not a
         note you want to lose sight of. The editor takes its own Escape before
         it reaches here. */
      if (event.key === 'Escape') {
        event.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur()
        return
      }
      if (!event.altKey || !event.key.startsWith('Arrow')) return
      // With the editor open the arrows belong to the text being written.
      if (editingRef.current) return
      const rowEl = (event.target as Element).closest('.idea, .idea-cat-head')
      if (!rowEl) return
      const id = rowEl.classList.contains('idea')
        ? (rowEl as HTMLElement).dataset.id
        : (rowEl.parentElement as HTMLElement | null)?.dataset.id
      if (!id || !moveByKey(id, event.key)) return
      event.preventDefault()
      // The list has been redrawn, so focus has to be set on the new node —
      // otherwise the next keystroke would reach an element that is gone.
      requestAnimationFrame(() => rowElement(id)?.focus())
    },
    [moveByKey, rowElement],
  )

  /* A drag or an open edit must not outlive the window being closed. */
  useEffect(() => {
    if (open) return
    endDrag()
    if (editingRef.current) finishEdit(true)
  }, [open, endDrag, finishEdit])

  useEffect(() => () => endDrag(), [endDrag])

  if (!presentation) return null

  const renderText = (row: IdeaRow, className: string): React.ReactNode => {
    if (editing?.id === row.id) {
      return (
        <textarea
          className="idea-edit"
          rows={1}
          maxLength={MAX_IDEA_LENGTH}
          defaultValue={row.text}
          aria-label="Endre teksten"
          data-testid="idea-edit"
          ref={(node) => {
            if (!node || editFieldRef.current === node) return
            editFieldRef.current = node
            grow(node)
            node.focus()
            if (editing.selectAll) node.select()
            else node.setSelectionRange(node.value.length, node.value.length)
          }}
          onInput={(event) => grow(event.currentTarget)}
          onBlur={() => finishEdit(true)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return
            // Escape here belongs to the field, not to the window: the focus
            // should not jump away because you changed your mind about a word.
            event.preventDefault()
            event.stopPropagation()
            finishEdit(event.key === 'Enter', true)
          }}
        />
      )
    }
    return (
      <span
        className={className}
        title="Klikk for å endre"
        data-testid={className === 'idea-text' ? 'idea-text' : 'idea-cat-title'}
        onClick={() => beginEdit(row.id)}
      >
        {row.text}
      </span>
    )
  }

  const renderIdea = (idea: IdeaRowData): React.ReactNode => (
    <li
      key={idea.id}
      className="idea"
      data-id={idea.id}
      data-testid="idea"
      tabIndex={0}
      // The whole row is the handle, the cross excepted: the text *is* the row,
      // and a drag that had to start on a narrow strip beside it is a drag you
      // never find.
      onPointerDown={(event) => armDrag(event, idea.id, event.currentTarget, '.idea-remove')}
      onClickCapture={swallowClick}
      onClick={focusOnClick}
    >
      <Icon name="grip" size={13} className="idea-grip" />
      {renderText(idea, 'idea-text')}
      <button
        type="button"
        className="idea-remove"
        aria-label={`Slett idéen «${idea.text}»`}
        onClick={() => run('idea-delete', (state) => removeIdeaRow(state, idea.id))}
      >
        <Icon name="close" size={13} />
      </button>
    </li>
  )

  const renderCategory = (category: IdeaCategory): React.ReactNode => (
    <li key={category.id} className="idea-cat" data-id={category.id} data-testid="idea-category">
      <div
        className="idea-cat-head"
        tabIndex={0}
        data-testid="idea-category-head"
        // The category is dragged by its heading, with its contents. The rest of
        // the surface belongs to the ideas — there a drag should lift the idea
        // you hit, not the category around it.
        onPointerDown={(event) =>
          armDrag(
            event,
            category.id,
            event.currentTarget.closest<HTMLElement>('.idea-cat'),
            '.idea-cat-add, .idea-remove',
          )
        }
        onClickCapture={swallowClick}
        onClick={focusOnClick}
      >
        <Icon name="grip" size={13} className="idea-grip" />
        {renderText(category, 'idea-cat-title')}
        <button
          type="button"
          className="idea-cat-add"
          aria-label={`Ny idé i «${category.text}»`}
          disabled={full}
          onClick={() => addTo(category.id)}
        >
          <Icon name="plus" size={13} />
        </button>
        <button
          type="button"
          className="idea-remove"
          data-testid="delete-idea-category"
          // No confirmation: nothing is lost. The ideas stay, without a category.
          aria-label={`Fjern kategorien «${category.text}» – idéene beholdes`}
          onClick={() => run('idea-category-delete', (state) => removeIdeaRow(state, category.id))}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <ul className="idea-cat-items" data-category={category.id}>
        {category.ideas.map(renderIdea)}
      </ul>
    </li>
  )

  return (
    <FloatingWindow
      prefKey="ideas"
      title="Idéer"
      icon="ideas"
      open={open}
      onClose={onClose}
      defaults={DEFAULT_IDEAS_GEOMETRY}
      testId="ideas-window"
      badge={ideaCount ? String(ideaCount) : ''}
      onPointerDown={onWindowPointerDown}
      onKeyDown={onWindowKeyDown}
      footer={
        <div className="ideas-foot">
          <button
            type="button"
            className="ideas-add-cat"
            title="Ny kategori"
            aria-label="Ny kategori"
            data-testid="add-idea-category"
            disabled={full}
            onClick={addCategory}
          >
            <Icon name="category" size={15} />
          </button>
          <textarea
            ref={fieldRef}
            className="ideas-new"
            rows={1}
            maxLength={MAX_IDEA_LENGTH}
            placeholder={full ? 'Lista er full' : 'Ny idé …'}
            aria-label="Ny idé"
            data-testid="idea-input"
            disabled={full}
            onInput={(event) => grow(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              addFromField()
            }}
          />
        </div>
      }
    >
      <div className={dragging ? 'ideas-inner is-dragging' : 'ideas-inner'}>
        {rows.length === 0 && (
          <p className="ideas-empty">
            Ingenting her ennå. Skriv en idé nedenfor, og slett den når den står i presentasjonen.
          </p>
        )}
        <ul className="ideas-list" ref={listRef} data-testid="ideas-list">
          {rows.map((row) => (isCategory(row) ? renderCategory(row) : renderIdea(row)))}
        </ul>
      </div>
    </FloatingWindow>
  )
}
