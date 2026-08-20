/**
 * Ideas panel commands.
 *
 * The idea *data* belongs to the presentation; the window's position and size
 * are local UI state and live in localStorage, never here.
 */

import { newIdeaCategoryId, newIdeaId } from '../ids'
import { touch } from '../presentation'
import { normalizeHex } from '../color'
import { err, ok, type Result } from '../result'
import type { Idea, Presentation } from '../types'

export function addIdea(
  presentation: Presentation,
  input: { categoryId: string; text: string },
): Result<Presentation> {
  if (!presentation.ideaCategories.some((category) => category.id === input.categoryId)) {
    return err('INVALID_ARGUMENT', 'Fant ikke kategorien.')
  }
  const idea: Idea = {
    id: newIdeaId(),
    categoryId: input.categoryId,
    text: input.text,
    done: false,
  }
  return ok(touch({ ...presentation, ideas: [...presentation.ideas, idea] }))
}

export function updateIdea(
  presentation: Presentation,
  id: string,
  patch: Partial<Pick<Idea, 'text' | 'done' | 'categoryId'>>,
): Result<Presentation> {
  const index = presentation.ideas.findIndex((idea) => idea.id === id)
  if (index < 0) return err('INVALID_ARGUMENT', 'Fant ikke idéen.')
  if (
    patch.categoryId &&
    !presentation.ideaCategories.some((category) => category.id === patch.categoryId)
  ) {
    return err('INVALID_ARGUMENT', 'Fant ikke kategorien.')
  }
  const ideas = [...presentation.ideas]
  ideas[index] = { ...ideas[index], ...patch }
  return ok(touch({ ...presentation, ideas }))
}

export function deleteIdea(presentation: Presentation, id: string): Result<Presentation> {
  if (!presentation.ideas.some((idea) => idea.id === id)) {
    return err('INVALID_ARGUMENT', 'Fant ikke idéen.')
  }
  return ok(touch({ ...presentation, ideas: presentation.ideas.filter((idea) => idea.id !== id) }))
}

/** Move an idea to another category and/or another position within the deck. */
export function moveIdea(
  presentation: Presentation,
  id: string,
  targetCategoryId: string,
  targetIndex: number,
): Result<Presentation> {
  const idea = presentation.ideas.find((entry) => entry.id === id)
  if (!idea) return err('INVALID_ARGUMENT', 'Fant ikke idéen.')
  if (!presentation.ideaCategories.some((category) => category.id === targetCategoryId)) {
    return err('INVALID_ARGUMENT', 'Fant ikke kategorien.')
  }
  const others = presentation.ideas.filter((entry) => entry.id !== id)
  const inCategory = others.filter((entry) => entry.categoryId === targetCategoryId)
  const clamped = Math.max(0, Math.min(targetIndex, inCategory.length))
  const moved: Idea = { ...idea, categoryId: targetCategoryId }

  const rebuilt: Idea[] = []
  let inserted = false
  let seenInCategory = 0
  for (const entry of others) {
    if (entry.categoryId === targetCategoryId) {
      if (seenInCategory === clamped && !inserted) {
        rebuilt.push(moved)
        inserted = true
      }
      seenInCategory += 1
    }
    rebuilt.push(entry)
  }
  if (!inserted) rebuilt.push(moved)
  return ok(touch({ ...presentation, ideas: rebuilt }))
}

export function addIdeaCategory(
  presentation: Presentation,
  name: string,
  color: string,
): Result<Presentation> {
  const hex = normalizeHex(color)
  if (!hex) return err('INVALID_ARGUMENT', 'Ugyldig fargeverdi.')
  const trimmed = name.trim()
  if (!trimmed) return err('INVALID_ARGUMENT', 'Kategorien må ha et navn.')
  return ok(
    touch({
      ...presentation,
      ideaCategories: [
        ...presentation.ideaCategories,
        { id: newIdeaCategoryId(), name: trimmed, color: hex },
      ],
    }),
  )
}

export function renameIdeaCategory(
  presentation: Presentation,
  id: string,
  name: string,
): Result<Presentation> {
  const index = presentation.ideaCategories.findIndex((category) => category.id === id)
  if (index < 0) return err('INVALID_ARGUMENT', 'Fant ikke kategorien.')
  const trimmed = name.trim()
  if (!trimmed) return err('INVALID_ARGUMENT', 'Kategorien må ha et navn.')
  const ideaCategories = [...presentation.ideaCategories]
  ideaCategories[index] = { ...ideaCategories[index], name: trimmed }
  return ok(touch({ ...presentation, ideaCategories }))
}

/** Deleting a category deletes its ideas, so the UI must confirm first. */
export function deleteIdeaCategory(presentation: Presentation, id: string): Result<Presentation> {
  if (!presentation.ideaCategories.some((category) => category.id === id)) {
    return err('INVALID_ARGUMENT', 'Fant ikke kategorien.')
  }
  if (presentation.ideaCategories.length <= 1) {
    return err('INVALID_ARGUMENT', 'Det må finnes minst én kategori.')
  }
  return ok(
    touch({
      ...presentation,
      ideaCategories: presentation.ideaCategories.filter((category) => category.id !== id),
      ideas: presentation.ideas.filter((idea) => idea.categoryId !== id),
    }),
  )
}
