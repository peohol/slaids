import { describe, expect, it } from 'vitest'
import {
  MAX_IDEAS,
  MAX_IDEA_LENGTH,
  addIdea,
  addIdeaCategory,
  deleteIdea,
  deleteIdeaCategory,
  moveIdea,
  moveIdeaCategory,
  oneLine,
  renameIdeaCategory,
  updateIdea,
} from './ideas'
import { createPresentation } from '../presentation'
import type { Presentation } from '../types'

function base(): Presentation {
  return createPresentation({ title: 'Idéer' })
}

function unwrap(result: { ok: boolean; value?: Presentation; error?: unknown }): Presentation {
  if (!result.ok || !result.value) throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

describe('oneLine', () => {
  it('collapses whitespace and trims', () => {
    expect(oneLine('  en   idé\n  til  ')).toBe('en idé til')
  })

  it('caps the length', () => {
    expect(oneLine('a'.repeat(400))).toHaveLength(MAX_IDEA_LENGTH)
  })

  it('handles empty input', () => {
    expect(oneLine('   ')).toBe('')
  })
})

describe('idea commands', () => {
  it('adds an idea as a single line', () => {
    const presentation = base()
    const next = unwrap(
      addIdea(presentation, {
        categoryId: presentation.ideaCategories[0].id,
        text: '  husk\n  geometrien ',
      }),
    )
    expect(next.ideas).toHaveLength(1)
    expect(next.ideas[0].text).toBe('husk geometrien')
  })

  it('refuses an empty idea and an unknown category', () => {
    const presentation = base()
    expect(addIdea(presentation, { categoryId: presentation.ideaCategories[0].id, text: '  ' }).ok).toBe(false)
    expect(addIdea(presentation, { categoryId: 'nope', text: 'noe' }).ok).toBe(false)
  })

  it('caps the number of ideas', () => {
    let presentation = base()
    const categoryId = presentation.ideaCategories[0].id
    presentation = {
      ...presentation,
      ideas: Array.from({ length: MAX_IDEAS }, (_, index) => ({
        id: `i${index}`,
        categoryId,
        text: `idé ${index}`,
        done: false,
      })),
    }
    const result = addIdea(presentation, { categoryId, text: 'én til' })
    expect(result.ok).toBe(false)
  })

  it('normalises text on update too', () => {
    const presentation = base()
    const added = unwrap(
      addIdea(presentation, { categoryId: presentation.ideaCategories[0].id, text: 'start' }),
    )
    const next = unwrap(updateIdea(added, added.ideas[0].id, { text: 'linje\nen\n\nto' }))
    expect(next.ideas[0].text).toBe('linje en to')
  })

  it('moves an idea to another category', () => {
    const presentation = base()
    const [first, second] = presentation.ideaCategories
    const added = unwrap(addIdea(presentation, { categoryId: first.id, text: 'flytt meg' }))
    const moved = unwrap(moveIdea(added, added.ideas[0].id, second.id, 0))
    expect(moved.ideas[0].categoryId).toBe(second.id)
  })

  it('reorders ideas inside a category', () => {
    let presentation = base()
    const categoryId = presentation.ideaCategories[0].id
    for (const text of ['en', 'to', 'tre']) {
      presentation = unwrap(addIdea(presentation, { categoryId, text }))
    }
    const last = presentation.ideas[2]
    const reordered = unwrap(moveIdea(presentation, last.id, categoryId, 0))
    expect(reordered.ideas.filter((idea) => idea.categoryId === categoryId).map((idea) => idea.text)).toEqual([
      'tre',
      'en',
      'to',
    ])
  })

  it('deletes an idea', () => {
    const presentation = base()
    const added = unwrap(
      addIdea(presentation, { categoryId: presentation.ideaCategories[0].id, text: 'bort' }),
    )
    expect(unwrap(deleteIdea(added, added.ideas[0].id)).ideas).toHaveLength(0)
    expect(deleteIdea(added, 'nope').ok).toBe(false)
  })

  it('renames a category and refuses an empty name', () => {
    const presentation = base()
    const id = presentation.ideaCategories[0].id
    expect(unwrap(renameIdeaCategory(presentation, id, ' Nytt ')).ideaCategories[0].name).toBe('Nytt')
    expect(renameIdeaCategory(presentation, id, '   ').ok).toBe(false)
  })

  it('keeps the ideas when a category is deleted', () => {
    const presentation = base()
    const [first] = presentation.ideaCategories
    const added = unwrap(addIdea(presentation, { categoryId: first.id, text: 'blir liggende' }))
    const next = unwrap(deleteIdeaCategory(added, first.id))
    expect(next.ideaCategories).toHaveLength(1)
    // The heading is gone; the note it stood above is not.
    expect(next.ideas).toHaveLength(1)
    expect(next.ideas[0].categoryId).toBeNull()

    // With uncategorised ideas there is nothing special about the last category.
    expect(deleteIdeaCategory(next, next.ideaCategories[0].id).ok).toBe(true)
    expect(deleteIdeaCategory(next, 'nope').ok).toBe(false)
  })

  it('notes an idea without a category', () => {
    const presentation = base()
    const next = unwrap(addIdea(presentation, { categoryId: null, text: 'uten hjem' }))
    expect(next.ideas[0].categoryId).toBeNull()
    // ... and it can be filed later, and taken out again.
    const filed = unwrap(
      moveIdea(next, next.ideas[0].id, presentation.ideaCategories[0].id, 0),
    )
    expect(filed.ideas[0].categoryId).toBe(presentation.ideaCategories[0].id)
    expect(unwrap(moveIdea(filed, filed.ideas[0].id, null, 0)).ideas[0].categoryId).toBeNull()
    expect(moveIdea(next, next.ideas[0].id, 'nope', 0).ok).toBe(false)
  })

  it('reorders categories', () => {
    const presentation = base()
    const [first, second] = presentation.ideaCategories
    const moved = unwrap(moveIdeaCategory(presentation, second.id, 0))
    expect(moved.ideaCategories.map((category) => category.id)).toEqual([second.id, first.id])
    // Out of range clamps rather than dropping the category.
    expect(unwrap(moveIdeaCategory(moved, second.id, 99)).ideaCategories.at(-1)?.id).toBe(second.id)
    expect(moveIdeaCategory(presentation, 'nope', 0).ok).toBe(false)
  })

  it('adds a category with a validated colour', () => {
    const presentation = base()
    expect(unwrap(addIdeaCategory(presentation, 'Ny', '#402626')).ideaCategories).toHaveLength(3)
    expect(addIdeaCategory(presentation, 'Ny', 'papayawhip').ok).toBe(false)
    expect(addIdeaCategory(presentation, '  ', '#402626').ok).toBe(false)
  })
})
