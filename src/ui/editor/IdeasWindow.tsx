/**
 * Ideas panel, ported conceptually from mdeditz.
 *
 * The model is that app's: categories group ideas at exactly one level, an idea
 * does not need a category to be worth noting, and a category is a heading
 * rather than a container that owns what it holds — deleting one leaves its
 * ideas behind, uncategorised. Categories are ordered, and both they and the
 * ideas are dragged into the order that makes sense.
 *
 * Colour coding stays: the colour is what tells two categories apart at a
 * glance, and it follows the ideas filed under them.
 *
 * The data belongs to the presentation; the window's position is local UI state.
 */

import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  addIdea,
  addIdeaCategory,
  deleteIdea,
  deleteIdeaCategory,
  renameIdeaCategory,
  updateIdea,
} from '../../domain/commands'
import { PALETTE } from '../../domain/color'
import { useEditorStore } from '../../state/store'
import { DEFAULT_IDEAS_GEOMETRY } from '../../state/prefs'
import type { Idea, IdeaCategory } from '../../domain/types'
import { FloatingWindow } from '../components/FloatingWindow'
import { Icon } from '../components/Icon'

/** dnd-kit ids. The prefix is what tells the drop handler what it is holding. */
export const IDEA_PREFIX = 'idea:'
export const CATEGORY_PREFIX = 'category:'
/** The list of ideas that have no category. */
export const UNCATEGORISED_ID = `${CATEGORY_PREFIX}none`

export function categoryDropId(categoryId: string | null): string {
  return categoryId === null ? UNCATEGORISED_ID : `${CATEGORY_PREFIX}${categoryId}`
}

/** The category a drop id names, or `undefined` if it is not a category at all. */
export function categoryFromDropId(id: string): string | null | undefined {
  if (id === UNCATEGORISED_ID) return null
  if (id.startsWith(CATEGORY_PREFIX)) return id.slice(CATEGORY_PREFIX.length)
  return undefined
}

function IdeaCard({ idea, color }: { idea: Idea; color: string | null }) {
  const run = useEditorStore((state) => state.run)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${IDEA_PREFIX}${idea.id}`,
    data: { kind: 'idea', ideaId: idea.id, categoryId: idea.categoryId },
  })

  return (
    <div
      className="idea"
      data-testid="idea"
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        // The colour follows the idea, so a card says which list it belongs to
        // even while it is in the air above another one.
        borderLeftColor: color ?? 'transparent',
      }}
    >
      <button
        type="button"
        className="idea__grip"
        aria-label="Flytt idé"
        {...attributes}
        {...listeners}
      >
        <Icon name="grip" size={13} />
      </button>
      <input
        type="checkbox"
        checked={idea.done}
        aria-label="Ferdig"
        onChange={(event) =>
          run('idea-toggle', (presentation) =>
            updateIdea(presentation, idea.id, { done: event.target.checked }),
          )
        }
      />
      <input
        className="idea__text"
        value={idea.text}
        data-testid="idea-text"
        onChange={(event) =>
          run(`typing:idea:${idea.id}`, (presentation) =>
            updateIdea(presentation, idea.id, { text: event.target.value }),
          )
        }
      />
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label="Slett idé"
        onClick={() => run('idea-delete', (presentation) => deleteIdea(presentation, idea.id))}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}

/** The shared body of a list: its ideas, and the field that adds one. */
function IdeaList({
  categoryId,
  ideas,
  color,
}: {
  categoryId: string | null
  ideas: Idea[]
  color: string | null
}) {
  const run = useEditorStore((state) => state.run)
  const [draft, setDraft] = useState('')

  return (
    <>
      <div className="idea-category__list">
        <SortableContext
          items={ideas.map((idea) => `${IDEA_PREFIX}${idea.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} color={color} />
          ))}
        </SortableContext>
      </div>
      <form
        className="idea-category__add"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          run('idea-add', (presentation) =>
            addIdea(presentation, { categoryId, text: draft.trim() }),
          )
          setDraft('')
        }}
      >
        <input
          className="input"
          value={draft}
          placeholder="Ny idé …"
          data-testid="idea-input"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn btn--sm btn--icon" aria-label="Legg til idé">
          <Icon name="plus" size={14} />
        </button>
      </form>
    </>
  )
}

function CategoryColumn({ category, ideas }: { category: IdeaCategory; ideas: Idea[] }) {
  const run = useEditorStore((state) => state.run)
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: categoryDropId(category.id) })
  const {
    attributes,
    listeners,
    setNodeRef: setSortRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${CATEGORY_PREFIX}sort:${category.id}`,
    data: { kind: 'idea-category', categoryId: category.id },
  })

  return (
    <section
      className={isOver ? 'idea-category idea-category--over' : 'idea-category'}
      ref={setSortRef}
      data-testid="idea-category"
      data-category-id={category.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <header className="idea-category__head" style={{ borderColor: category.color }}>
        <button
          type="button"
          className="idea__grip"
          aria-label={`Flytt kategorien ${category.name}`}
          data-testid="idea-category-grip"
          {...attributes}
          {...listeners}
        >
          <Icon name="grip" size={13} />
        </button>
        <input
          className="idea-category__name"
          value={category.name}
          aria-label="Kategorinavn"
          onChange={(event) =>
            run('idea-category-rename', (presentation) =>
              renameIdeaCategory(presentation, category.id, event.target.value),
            )
          }
        />
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label={`Slett kategorien ${category.name}`}
          data-testid="delete-idea-category"
          // No confirmation: nothing is lost. The ideas stay, without a category.
          onClick={() =>
            run('idea-category-delete', (presentation) =>
              deleteIdeaCategory(presentation, category.id),
            )
          }
        >
          <Icon name="trash" size={13} />
        </button>
      </header>
      <div ref={setDropRef}>
        <IdeaList categoryId={category.id} ideas={ideas} color={category.color} />
      </div>
    </section>
  )
}

function UncategorisedColumn({ ideas }: { ideas: Idea[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNCATEGORISED_ID })

  return (
    <section
      className={
        isOver
          ? 'idea-category idea-category--loose idea-category--over'
          : 'idea-category idea-category--loose'
      }
      ref={setNodeRef}
      data-testid="idea-uncategorised"
    >
      <header className="idea-category__head">
        <span className="hint">Uten kategori</span>
      </header>
      <IdeaList categoryId={null} ideas={ideas} color={null} />
    </section>
  )
}

export function IdeasWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)

  if (!presentation) return null

  const loose = presentation.ideas.filter((idea) => idea.categoryId === null)

  return (
    <FloatingWindow
      prefKey="ideas"
      title="Idéer"
      icon="ideas"
      open={open}
      onClose={onClose}
      defaults={DEFAULT_IDEAS_GEOMETRY}
      testId="ideas-window"
    >
      <div className="idea-categories">
        <UncategorisedColumn ideas={loose} />
        <SortableContext
          items={presentation.ideaCategories.map(
            (category) => `${CATEGORY_PREFIX}sort:${category.id}`,
          )}
          strategy={verticalListSortingStrategy}
        >
          {presentation.ideaCategories.map((category) => (
            <CategoryColumn
              key={category.id}
              category={category}
              ideas={presentation.ideas.filter((idea) => idea.categoryId === category.id)}
            />
          ))}
        </SortableContext>
      </div>
      <button
        type="button"
        className="btn btn--sm"
        data-testid="add-idea-category"
        onClick={() =>
          run('idea-category-add', (current) =>
            addIdeaCategory(
              current,
              `Kategori ${current.ideaCategories.length + 1}`,
              PALETTE[1][(current.ideaCategories.length * 3) % PALETTE[1].length],
            ),
          )
        }
      >
        <Icon name="plus" size={14} /> Ny kategori
      </button>
    </FloatingWindow>
  )
}
