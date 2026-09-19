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
import {
  addIdea,
  addIdeaCategory,
  moveIdeaRow,
  removeIdeaRow,
  setIdeaCategoryColor,
  setIdeaText,
} from '../../domain/commands'
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
import { ColorSwatchButton } from '../components/ColorPicker'
import { FloatingWindow } from '../components/FloatingWindow'
import { Icon } from '../components/Icon'
import { useReorderDrag } from '../components/reorderDrag'

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
  const rowsRef = useRef<IdeaRow[]>(rows)

  const listRef = useRef<HTMLUListElement | null>(null)
  const fieldRef = useRef<HTMLTextAreaElement | null>(null)
  const editFieldRef = useRef<HTMLTextAreaElement | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const editingRef = useRef<Editing | null>(null)
  /* Read by `beginEdit`, which runs a frame after a row is added and must not
     open an editor on a card that is in the air. */
  const draggingRef = useRef(false)

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
    if (editingRef.current || draggingRef.current) return
    setEditing({ id, selectAll })
  }, [])

  /* -------------------------------------------------------------------- drag */

  /*
   * The gesture is the shared one; what is local is where an idea may *land*.
   * An idea dropped over a category goes into it, a category only ever sits at
   * the root, and that one rule is the whole of this list's nesting.
   */
  const drag = useReorderDrag({
    scrollParent: bodyOf,
    placeholderClass: 'idea-ph',
    canStart: () => !editingRef.current,
    containerFor: (under, dragged) => {
      const category = dragged.classList.contains('idea-cat') ? null : under.closest('.idea-cat')
      return category
        ? category.querySelector<HTMLElement>('.idea-cat-items')
        : listRef.current
    },
    onDrop: ({ rowId, container, index }) => {
      const categoryId = container.dataset.category ?? null
      run('idea-move', (state) => moveIdeaRow(state, rowId, categoryId, index))
    },
  })

  /* The list, the open edit and the drag as the pointer and the keyboard see
     them. All three act after a paint, so an effect-synced mirror is always
     what is on screen. */
  useEffect(() => {
    rowsRef.current = rows
    editingRef.current = editing
    draggingRef.current = drag.dragging
  })

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
    drag.cancel()
    if (editingRef.current) finishEdit(true)
  }, [open, drag, finishEdit])

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
      onPointerDown={(event) => drag.arm(event, idea.id, event.currentTarget, '.idea-edit, .idea-remove')}
      onClickCapture={drag.swallowClick}
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
    <li
      key={category.id}
      className="idea-cat"
      data-id={category.id}
      data-testid="idea-category"
      /*
       * The colour is handed down as a custom property rather than painted onto
       * each row. Two things fall out of that, and both matter for the drag:
       * the ideas inherit it without carrying it, and a lifted card keeps it
       * while it is in the air — `position: fixed` moves where a row is drawn,
       * never where it sits in the tree. Nothing here writes `style.left`,
       * `top` or `width`, which is what the drag writes by hand.
       */
      style={{ '--idea-color': category.color } as React.CSSProperties}
    >
      <div
        className="idea-cat-head"
        tabIndex={0}
        data-testid="idea-category-head"
        // The category is dragged by its heading, with its contents. The rest of
        // the surface belongs to the ideas — there a drag should lift the idea
        // you hit, not the category around it.
        onPointerDown={(event) =>
          drag.arm(
            event,
            category.id,
            event.currentTarget.closest<HTMLElement>('.idea-cat'),
            '.idea-edit, .idea-cat-color, .idea-cat-add, .idea-remove',
          )
        }
        onClickCapture={drag.swallowClick}
        onClick={focusOnClick}
      >
        <Icon name="grip" size={13} className="idea-grip" />
        <ColorSwatchButton
          className="idea-cat-color"
          value={category.color}
          label={`Farge på «${category.text}»`}
          testId="idea-category-color"
          onChange={(color) =>
            run('idea-category-color', (state) =>
              setIdeaCategoryColor(state, category.id, color),
            )
          }
        />
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
      <div className={drag.dragging ? 'ideas-inner is-dragging' : 'ideas-inner'}>
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
