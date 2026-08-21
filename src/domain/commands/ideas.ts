/**
 * Ideas panel commands.
 *
 * Thin wrappers around the pure list model in `src/domain/ideas.ts`: the model
 * decides the outcome, these put it on the presentation and report it as a
 * typed result like every other command. A model function that changed nothing
 * hands back the list it was given, and that is what becomes `ok(presentation)`
 * here — an unchanged presentation the store knows not to commit, so a drag
 * that ended where it started is not an undo step.
 *
 * The idea *data* belongs to the presentation; the window's position and size
 * are local UI state and live in localStorage.
 */

import {
  MAX_IDEAS,
  addCategory,
  addIdea as addIdeaRow,
  countRows,
  findRow,
  moveRow,
  oneLine,
  removeRow,
  setText,
} from '../ideas'
import { touch } from '../presentation'
import { err, ok, type Result } from '../result'
import type { IdeaRow, Presentation } from '../types'

/** The list on the presentation, or the same presentation when nothing moved. */
function withIdeas(presentation: Presentation, ideas: IdeaRow[]): Presentation {
  return ideas === presentation.ideas ? presentation : touch({ ...presentation, ideas })
}

export function addIdea(
  presentation: Presentation,
  input: { categoryId: string | null; text: string },
): Result<Presentation> {
  if (input.categoryId !== null && !findRow(presentation.ideas, input.categoryId)) {
    return err('INVALID_ARGUMENT', 'Fant ikke kategorien.')
  }
  if (!oneLine(input.text)) return err('INVALID_ARGUMENT', 'Idéen kan ikke være tom.')
  if (countRows(presentation.ideas) >= MAX_IDEAS) {
    return err('INVALID_ARGUMENT', `Det er plass til maksimalt ${MAX_IDEAS} rader.`)
  }
  return ok(withIdeas(presentation, addIdeaRow(presentation.ideas, input.text, input.categoryId)))
}

export function addIdeaCategory(presentation: Presentation, name: string): Result<Presentation> {
  if (countRows(presentation.ideas) >= MAX_IDEAS) {
    return err('INVALID_ARGUMENT', `Det er plass til maksimalt ${MAX_IDEAS} rader.`)
  }
  return ok(withIdeas(presentation, addCategory(presentation.ideas, name)))
}

/**
 * New text on an idea or a category — the same command for both.
 *
 * The window edits a row in place, and a row is a row: which kind it is decides
 * how it is drawn, not how it is renamed.
 */
export function setIdeaText(
  presentation: Presentation,
  id: string,
  text: string,
): Result<Presentation> {
  if (!findRow(presentation.ideas, id)) return err('INVALID_ARGUMENT', 'Fant ikke raden.')
  return ok(withIdeas(presentation, setText(presentation.ideas, id, text)))
}

/** Delete an idea, or a category without the ideas under it. */
export function removeIdeaRow(presentation: Presentation, id: string): Result<Presentation> {
  if (!findRow(presentation.ideas, id)) return err('INVALID_ARGUMENT', 'Fant ikke raden.')
  return ok(withIdeas(presentation, removeRow(presentation.ideas, id)))
}

/**
 * Move a row into a container, at an index read without the row itself in it —
 * exactly the position the drop placeholder shows.
 */
export function moveIdeaRow(
  presentation: Presentation,
  id: string,
  categoryId: string | null,
  index: number,
): Result<Presentation> {
  if (!findRow(presentation.ideas, id)) return err('INVALID_ARGUMENT', 'Fant ikke raden.')
  if (categoryId !== null && !findRow(presentation.ideas, categoryId)) {
    return err('INVALID_ARGUMENT', 'Fant ikke kategorien.')
  }
  return ok(withIdeas(presentation, moveRow(presentation.ideas, id, categoryId, index)))
}
