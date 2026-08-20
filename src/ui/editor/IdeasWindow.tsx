/**
 * Ideas panel, ported conceptually from mdeditz: one level of categories, quick
 * capture, drag between categories. The data belongs to the presentation.
 */

import { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
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
import { ConfirmDialog } from '../components/ConfirmDialog'

function IdeaCard({ idea }: { idea: Idea }) {
  const run = useEditorStore((state) => state.run)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `idea:${idea.id}`,
    data: { kind: 'idea', ideaId: idea.id },
  })

  return (
    <div className="idea" data-testid="idea" style={{ opacity: isDragging ? 0.4 : 1 }}>
      <button
        type="button"
        className="idea__grip"
        ref={setNodeRef}
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

function CategoryColumn({
  category,
  ideas,
  onRequestDelete,
}: {
  category: IdeaCategory
  ideas: Idea[]
  onRequestDelete: (category: IdeaCategory) => void
}) {
  const run = useEditorStore((state) => state.run)
  const [draft, setDraft] = useState('')
  const { setNodeRef, isOver } = useDroppable({ id: `category:${category.id}` })

  return (
    <section
      className={isOver ? 'idea-category idea-category--over' : 'idea-category'}
      ref={setNodeRef}
      data-testid="idea-category"
    >
      <header className="idea-category__head" style={{ borderColor: category.color }}>
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
          onClick={() => onRequestDelete(category)}
        >
          <Icon name="trash" size={13} />
        </button>
      </header>
      <div className="idea-category__list">
        {ideas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} />
        ))}
      </div>
      <form
        className="idea-category__add"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          run('idea-add', (presentation) =>
            addIdea(presentation, { categoryId: category.id, text: draft.trim() }),
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
    </section>
  )
}

export function IdeasWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)
  const [deleting, setDeleting] = useState<IdeaCategory | null>(null)

  if (!presentation) return null

  const doomedIdeas = deleting
    ? presentation.ideas.filter((idea) => idea.categoryId === deleting.id).length
    : 0

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
          {presentation.ideaCategories.map((category) => (
            <CategoryColumn
              key={category.id}
              category={category}
              ideas={presentation.ideas.filter((idea) => idea.categoryId === category.id)}
              onRequestDelete={setDeleting}
            />
          ))}
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

      <ConfirmDialog
        open={deleting !== null}
        title="Slette kategorien?"
        message={
          doomedIdeas > 0
            ? `Kategorien «${deleting?.name ?? ''}» og ${doomedIdeas} idé(er) i den slettes.`
            : `Kategorien «${deleting?.name ?? ''}» slettes.`
        }
        onConfirm={() => {
          if (!deleting) return
          run('idea-category-delete', (current) => deleteIdeaCategory(current, deleting.id))
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </FloatingWindow>
  )
}
