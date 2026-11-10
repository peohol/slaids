/**
 * The list behind the ideas window.
 *
 * The model is mdeditz's, function for function: one ordered list where a
 * category is a row like any other, and the ideas it holds hang under it. That
 * a category is *in* the list rather than beside it is the whole point — a
 * loose idea can sit between two categories, and the order you drag things into
 * is the order you read them in.
 *
 * Categories group ideas at exactly one level: a category holds ideas, never
 * other categories. Everything that arrives from outside is repaired down to
 * that rule rather than rejected, so a list that has become something else
 * cannot take the window with it.
 *
 * These are pure functions over a list, without any DOM. The window in
 * `src/ui/editor/IdeasWindow.tsx` does the dragging; this decides the outcome.
 * A function that changes nothing returns the list it was given, which is what
 * lets the command layer tell a real edit from a drag that ended where it
 * started.
 */

import { PALETTE_LIGHTNESS, normalizeHex, paletteShade } from './color'
import { newIdeaCategoryId, newIdeaId } from './ids'

/** Same limits as the sibling app, so a note stays a note. */
export const MAX_IDEAS = 200
export const MAX_IDEA_LENGTH = 280

export interface Idea {
  id: string
  kind: 'idea'
  text: string
}

export interface IdeaCategory {
  id: string
  kind: 'category'
  text: string
  /**
   * What tells two categories apart at a glance, and what follows the ideas
   * filed under them. It is carried as a plain value on the category and never
   * on the ideas: an idea belongs to a list, and the list owns the colour.
   */
  color: string
  ideas: Idea[]
}

export type IdeaRow = Idea | IdeaCategory

/**
 * The colours a new category may get: every palette hue at the second-darkest
 * step, which is muted enough to sit behind text without shouting.
 *
 * Reordered by a stride around the hue circle rather than taken in order. The
 * colours are handed out first-free, and in hue order the first three lists
 * would come out red, orange, yellow — all different, none *telling* apart.
 * A stride of 5 over 12 hues visits every one of them exactly once and starts
 * red, green, magenta, so the categories you actually make look distinct.
 */
const CATEGORY_SHADE = paletteShade(PALETTE_LIGHTNESS[1])
export const CATEGORY_COLORS = CATEGORY_SHADE.map(
  (_, index) => CATEGORY_SHADE[(index * 5) % CATEGORY_SHADE.length],
)

/**
 * A colour for a new category: the first one nobody is using.
 *
 * Distinct beats pretty here — the colour exists to tell two lists apart, and
 * two categories that happen to look the same tell you nothing. Deleting a
 * category frees its colour again. Past twelve lists it wraps around, because
 * a repeated colour is better than none.
 */
export function nextCategoryColor(rows: IdeaRow[]): string {
  const used = new Set(rows.filter(isCategory).map((row) => row.color))
  const free = CATEGORY_COLORS.find((color) => !used.has(color))
  return free ?? CATEGORY_COLORS[used.size % CATEGORY_COLORS.length]
}

export function isCategory(row: IdeaRow | null | undefined): row is IdeaCategory {
  return row?.kind === 'category'
}

/** One line, cut where an idea stops being a note. */
export function oneLine(text: unknown): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_IDEA_LENGTH)
}

/** A copy that may be changed freely: the model always hands back a new list. */
function cloneRows(rows: IdeaRow[]): IdeaRow[] {
  return rows.map((row) =>
    isCategory(row) ? { ...row, ideas: row.ideas.map((idea) => ({ ...idea })) } : { ...row },
  )
}

type Raw = Record<string, unknown>

/**
 * Read a list from outside — a stored document, or an import.
 *
 * Repairs rather than throws. Everything below the root level becomes an idea,
 * so the one-level rule holds whatever comes in.
 */
export function normalizeIdeas(raw: unknown): IdeaRow[] {
  const seen = new Set<string>()
  const budget = { left: MAX_IDEAS }
  const rows: IdeaRow[] = []

  const idFor = (wanted: unknown, make: () => string): string => {
    const id = typeof wanted === 'string' && wanted && !seen.has(wanted) ? wanted : make()
    seen.add(id)
    return id
  }
  const ideasIn = (list: unknown): Idea[] => {
    const found: Idea[] = []
    for (const entry of Array.isArray(list) ? list : []) {
      if (!entry || typeof entry !== 'object') continue
      if (budget.left <= 0) break
      budget.left -= 1
      const row = entry as Raw
      found.push(
        { id: idFor(row.id, newIdeaId), kind: 'idea', text: oneLine(row.text) || 'Idé' },
        ...ideasIn(row.ideas),
      )
    }
    return found
  }

  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== 'object') continue
    if (budget.left <= 0) break
    const row = entry as Raw
    if (row.kind === 'category') {
      budget.left -= 1
      rows.push({
        id: idFor(row.id, newIdeaCategoryId),
        kind: 'category',
        text: oneLine(row.text) || 'Kategori',
        // A category without a usable colour gets one that is still free, so a
        // repaired list still tells its lists apart.
        color: normalizeHex(String(row.color ?? '')) ?? nextCategoryColor(rows),
        ideas: ideasIn(row.ideas),
      })
      continue
    }
    rows.push(...ideasIn([row]))
  }

  return rows
}

/** Every row, categories and ideas alike, in reading order. */
function allRows(rows: IdeaRow[]): IdeaRow[] {
  return rows.flatMap((row) => (isCategory(row) ? [row, ...row.ideas] : [row]))
}

/** How many rows the list holds — the limit covers categories and ideas alike. */
export const countRows = (rows: IdeaRow[]): number => allRows(rows).length

/** How many ideas are left to use. Categories do not count. */
export const countIdeas = (rows: IdeaRow[]): number =>
  allRows(rows).filter((row) => !isCategory(row)).length

export function findRow(rows: IdeaRow[], id: string): IdeaRow | null {
  return allRows(rows).find((row) => row.id === id) ?? null
}

/**
 * Where a row sits: in which category (`null` for the root), and where in it.
 *
 * The index is the place among its siblings *without* the row itself — the same
 * index `moveRow` takes, so "one step down" is `index + 1` and no further sums.
 */
export function rowLocation(
  rows: IdeaRow[],
  id: string,
): { categoryId: string | null; index: number } | null {
  const index = rows.findIndex((row) => row.id === id)
  if (index > -1) return { categoryId: null, index }
  for (const row of rows) {
    if (!isCategory(row)) continue
    const inner = row.ideas.findIndex((idea) => idea.id === id)
    if (inner > -1) return { categoryId: row.id, index: inner }
  }
  return null
}

/** The rows in a container: the root, or the ideas in a category. */
export function containerIn(rows: IdeaRow[], categoryId: string | null): IdeaRow[] | null {
  if (!categoryId) return rows
  const category = rows.find((row) => row.id === categoryId && isCategory(row))
  return isCategory(category) ? category.ideas : null
}

/** Takes the row out of the list it sits in, and hands it back. */
function takeRow(rows: IdeaRow[], id: string): IdeaRow | null {
  const index = rows.findIndex((row) => row.id === id)
  if (index > -1) return rows.splice(index, 1)[0]
  for (const row of rows) {
    if (!isCategory(row)) continue
    const inner = row.ideas.findIndex((idea) => idea.id === id)
    if (inner > -1) return row.ideas.splice(inner, 1)[0]
  }
  return null
}

export function addIdea(rows: IdeaRow[], text: string, categoryId: string | null = null): IdeaRow[] {
  const clean = oneLine(text)
  if (!clean || countRows(rows) >= MAX_IDEAS) return rows
  const next = cloneRows(rows)
  const container = containerIn(next, categoryId)
  if (!container) return rows
  container.push({ id: newIdeaId(), kind: 'idea', text: clean })
  return next
}

export function addCategory(rows: IdeaRow[], text: string, color?: string): IdeaRow[] {
  const clean = oneLine(text) || 'Kategori'
  if (countRows(rows) >= MAX_IDEAS) return rows
  return [
    ...cloneRows(rows),
    {
      id: newIdeaCategoryId(),
      kind: 'category',
      text: clean,
      color: (color && normalizeHex(color)) || nextCategoryColor(rows),
      ideas: [],
    },
  ]
}

/**
 * A new colour on a category. An unusable one is no change, like empty text on
 * a row — the colour it already had still stands.
 */
export function setCategoryColor(rows: IdeaRow[], id: string, color: string): IdeaRow[] {
  const hex = normalizeHex(color)
  if (!hex) return rows
  const next = cloneRows(rows)
  const row = findRow(next, id)
  if (!isCategory(row) || row.color === hex) return rows
  row.color = hex
  return next
}

/** New text on a row. Empty text is no change — like an edit that was abandoned. */
export function setText(rows: IdeaRow[], id: string, text: string): IdeaRow[] {
  const clean = oneLine(text)
  if (!clean) return rows
  const next = cloneRows(rows)
  const row = findRow(next, id)
  if (!row || row.text === clean) return rows
  row.text = clean
  return next
}

/**
 * Delete a row.
 *
 * A category does not take its ideas with it: they stay at the root, where the
 * category stood. The cross removes what it stands on and never more than that
 * — an idea that has not been used yet must not disappear because someone
 * tidied away a heading.
 */
export function removeRow(rows: IdeaRow[], id: string): IdeaRow[] {
  const index = rows.findIndex((row) => row.id === id)
  if (index > -1) {
    const row = rows[index]
    const next = cloneRows(rows)
    next.splice(index, 1, ...(isCategory(row) ? cloneRows(row.ideas) : []))
    return next
  }
  const next = cloneRows(rows)
  return takeRow(next, id) ? next : rows
}

/**
 * Move a row to `index` in a container.
 *
 * `categoryId` is `null` for the root. The index is read in the list as it
 * looks *after* the row has been taken out, which is exactly what the
 * placeholder shows during a drag. A category can only sit at the root — one
 * level is one level, wherever it is dropped.
 */
export function moveRow(
  rows: IdeaRow[],
  id: string,
  categoryId: string | null = null,
  index = 0,
): IdeaRow[] {
  const next = cloneRows(rows)
  const row = takeRow(next, id)
  if (!row) return rows
  if (categoryId && isCategory(row)) return rows
  const container = containerIn(next, categoryId)
  if (!container) return rows
  container.splice(Math.min(Math.max(index, 0), container.length), 0, row)
  return next
}
