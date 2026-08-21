/**
 * The model behind the ideas list: the order, the categories that organise it,
 * and the rules that cannot be broken whatever comes in — one level of
 * categories, and a limit on how much may lie in the list.
 *
 * This is the arithmetic behind drag-and-drop: where a row is, where it lands,
 * and what happens to the ideas when the category around them is removed. The
 * drag itself is DOM work and belongs in the browser; this is the part that
 * decides the outcome.
 *
 * Mirrors `test/ideas.test.mjs` in mdeditz, which is where the model came from.
 */

import { describe, expect, it } from 'vitest'
import {
  CATEGORY_COLORS,
  MAX_IDEAS,
  MAX_IDEA_LENGTH,
  addCategory,
  addIdea,
  countIdeas,
  countRows,
  findRow,
  isCategory,
  moveRow,
  nextCategoryColor,
  normalizeIdeas,
  oneLine,
  removeRow,
  rowLocation,
  setCategoryColor,
  setText,
  type IdeaRow,
} from './ideas'

/** The list as text, so an order is readable in a failure message. */
const shape = (rows: IdeaRow[]): string =>
  rows
    .map((row) =>
      isCategory(row) ? `[${row.text}: ${row.ideas.map((idea) => idea.text).join(', ')}]` : row.text,
    )
    .join(' | ')

/** A list built from the text above: `a, b, [K: c, d]`. */
function build(...parts: string[]): IdeaRow[] {
  let rows: IdeaRow[] = []
  for (const part of parts) {
    if (!part.startsWith('[')) {
      rows = addIdea(rows, part)
      continue
    }
    const [title, inner = ''] = part.slice(1, -1).split(':')
    rows = addCategory(rows, title)
    const id = rows.at(-1)!.id
    for (const text of inner.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      rows = addIdea(rows, text, id)
    }
  }
  return rows
}

describe('the text', () => {
  it('is one line, cut where the note stops', () => {
    expect(oneLine('  to   ord \n på  to linjer ')).toBe('to ord på to linjer')
    expect(oneLine('a'.repeat(MAX_IDEA_LENGTH + 50))).toHaveLength(MAX_IDEA_LENGTH)
    expect(oneLine(null)).toBe('')
  })

  it('treats empty text as no change — like an abandoned edit', () => {
    const rows = build('Skriv om innledningen')
    expect(setText(rows, rows[0].id, '   ')).toBe(rows)
    expect(setText(rows, rows[0].id, 'Skriv om innledningen')).toBe(rows)
    expect(setText(rows, rows[0].id, 'Kort ned innledningen')[0].text).toBe('Kort ned innledningen')
  })

  it('does not add an empty idea', () => {
    const rows: IdeaRow[] = []
    expect(addIdea(rows, '  ')).toBe(rows)
    expect(countRows(addIdea(rows, 'Noe'))).toBe(1)
  })
})

describe('the order', () => {
  it('moves an idea up and down the list', () => {
    const rows = build('a', 'b', 'c')
    const b = rows[1].id
    expect(shape(moveRow(rows, b, null, 0))).toBe('b | a | c')
    expect(shape(moveRow(rows, b, null, 2))).toBe('a | c | b')
    // The index is read in the list WITHOUT the row itself, so the place it had
    // is the same place.
    expect(shape(moveRow(rows, b, null, 1))).toBe('a | b | c')
  })

  it('puts an index outside the list at the end, not into nothing', () => {
    const rows = build('a', 'b')
    expect(shape(moveRow(rows, rows[0].id, null, 99))).toBe('b | a')
    expect(shape(moveRow(rows, rows[1].id, null, -5))).toBe('b | a')
  })

  it('moves nothing for an unknown id', () => {
    const rows = build('a')
    expect(moveRow(rows, 'finnes-ikke', null, 0)).toBe(rows)
    expect(removeRow(rows, 'finnes-ikke')).toBe(rows)
  })
})

describe('the categories', () => {
  it('moves an idea into a category and out again', () => {
    const rows = build('a', '[Kapittel 2:]')
    const idea = rows[0].id
    const category = rows[1].id

    const inside = moveRow(rows, idea, category, 0)
    expect(shape(inside)).toBe('[Kapittel 2: a]')
    expect(rowLocation(inside, idea)).toEqual({ categoryId: category, index: 0 })

    const outside = moveRow(inside, idea, null, 1)
    expect(shape(outside)).toBe('[Kapittel 2: ] | a')
    expect(rowLocation(outside, idea)).toEqual({ categoryId: null, index: 1 })
  })

  it('keeps a category at the root — one level is one level', () => {
    const rows = build('[Første:]', '[Andre:]')
    const [first, second] = rows.map((row) => row.id)
    expect(moveRow(rows, second, first, 0)).toBe(rows)
    expect(shape(moveRow(rows, second, null, 0))).toBe('[Andre: ] | [Første: ]')
  })

  it('keeps the order of the ideas inside a category', () => {
    const rows = build('[K: a, b, c]')
    const category = rows[0]
    if (!isCategory(category)) throw new Error('expected a category')
    expect(shape(moveRow(rows, category.ideas[2].id, category.id, 0))).toBe('[K: c, a, b]')
  })

  it('leaves the ideas where a removed category stood', () => {
    const rows = build('før', '[K: a, b]', 'etter')
    const next = removeRow(rows, rows[1].id)
    expect(shape(next)).toBe('før | a | b | etter')
    expect(countIdeas(next)).toBe(4)
  })

  it('does not take the neighbours when an idea is deleted', () => {
    const rows = build('a', '[K: b, c]')
    const category = rows[1]
    if (!isCategory(category)) throw new Error('expected a category')
    expect(shape(removeRow(rows, category.ideas[0].id))).toBe('a | [K: c]')
  })

  it('does not count categories as ideas, but they do fill the list', () => {
    const rows = build('a', '[K: b]')
    expect(countIdeas(rows)).toBe(2)
    expect(countRows(rows)).toBe(3)
  })

  it('finds a row wherever it sits', () => {
    const rows = build('a', '[K: b]')
    const category = rows[1]
    if (!isCategory(category)) throw new Error('expected a category')
    expect(findRow(rows, category.ideas[0].id)?.text).toBe('b')
    expect(findRow(rows, 'nope')).toBeNull()
    expect(rowLocation(rows, 'nope')).toBeNull()
  })
})

describe('the colour', () => {
  const colorsIn = (rows: IdeaRow[]): string[] => rows.filter(isCategory).map((row) => row.color)

  it('gives every new category a colour nobody else is using', () => {
    let rows: IdeaRow[] = []
    for (let index = 0; index < CATEGORY_COLORS.length; index += 1) {
      rows = addCategory(rows, `K${index}`)
    }
    const colors = colorsIn(rows)
    expect(colors).toHaveLength(CATEGORY_COLORS.length)
    expect(new Set(colors).size).toBe(CATEGORY_COLORS.length)
  })

  it('reuses a colour once the palette is spent, rather than running out', () => {
    let rows: IdeaRow[] = []
    for (let index = 0; index <= CATEGORY_COLORS.length; index += 1) {
      rows = addCategory(rows, `K${index}`)
    }
    expect(CATEGORY_COLORS).toContain(colorsIn(rows).at(-1))
  })

  it('takes a colour it is handed, and falls back when it is not usable', () => {
    expect(colorsIn(addCategory([], 'K', '#402626'))).toEqual(['#402626'])
    // Short form is expanded, not rejected.
    expect(colorsIn(addCategory([], 'K', '#abc'))).toEqual(['#aabbcc'])
    expect(CATEGORY_COLORS).toContain(colorsIn(addCategory([], 'K', 'papayawhip'))[0])
  })

  it('frees a colour again when the category using it goes', () => {
    const rows = addCategory(addCategory([], 'Første'), 'Andre')
    const [first] = colorsIn(rows)
    expect(nextCategoryColor(rows)).not.toBe(first)
    expect(nextCategoryColor(removeRow(rows, rows[0].id))).toBe(first)
  })

  it('recolours a category, and treats a no-op as no change', () => {
    const rows = addCategory([], 'Kilder')
    const id = rows[0].id
    expect(colorsIn(setCategoryColor(rows, id, '#402626'))).toEqual(['#402626'])
    // An unusable colour and the colour it already has are both nothing to write.
    expect(setCategoryColor(rows, id, 'papayawhip')).toBe(rows)
    expect(setCategoryColor(rows, id, colorsIn(rows)[0])).toBe(rows)
    // An idea has no colour of its own to set.
    const withIdea = addIdea(rows, 'notat', id)
    const ideaId = (withIdea[0] as { ideas: IdeaRow[] }).ideas[0].id
    expect(setCategoryColor(withIdea, ideaId, '#402626')).toBe(withIdea)
  })

  it('leaves the ideas alone when the list around them is recoloured', () => {
    const rows = build('[K: a, b]')
    const next = setCategoryColor(rows, rows[0].id, '#402626')
    // The colour is the list's; the notes filed in it are untouched.
    expect(shape(next)).toBe(shape(rows))
  })

  it('gives a repaired category a colour, keeping the one it had', () => {
    const rows = normalizeIdeas([
      { id: 'k1', kind: 'category', text: 'Beholdt', color: '#402626', ideas: [] },
      { id: 'k2', kind: 'category', text: 'Manglet', ideas: [] },
      { id: 'k3', kind: 'category', text: 'Ubrukelig', color: 'papayawhip', ideas: [] },
    ])
    const colors = colorsIn(rows)
    expect(colors[0]).toBe('#402626')
    expect(CATEGORY_COLORS).toContain(colors[1])
    expect(CATEGORY_COLORS).toContain(colors[2])
    expect(new Set(colors).size).toBe(3)
  })
})

describe('the limit', () => {
  it('takes no more than the limit, wherever it is added', () => {
    let rows = addCategory([], 'K')
    const category = rows[0].id
    while (countRows(rows) < MAX_IDEAS) rows = addIdea(rows, `idé ${countRows(rows)}`)

    expect(countRows(rows)).toBe(MAX_IDEAS)
    expect(addIdea(rows, 'én for mye')).toBe(rows)
    expect(addIdea(rows, 'én for mye', category)).toBe(rows)
    expect(addCategory(rows, 'én for mye')).toBe(rows)
  })
})

describe('normalisation', () => {
  it('repairs a broken list instead of toppling the window', () => {
    const rows = normalizeIdeas([
      null,
      'ikke et objekt',
      { text: 'uten id og kind' },
      { id: 'i1', kind: 'idea', text: '  flere    mellomrom  ' },
      { id: 'i1', kind: 'idea', text: 'samme id som over' },
      { id: 'k1', kind: 'category', text: '', ideas: 'ikke en liste' },
    ])

    expect(shape(rows)).toBe(
      'uten id og kind | flere mellomrom | samme id som over | [Kategori: ]',
    )
    expect(new Set(rows.map((row) => row.id)).size).toBe(4)
    const last = rows.at(-1)
    expect(last && isCategory(last) ? last.ideas : null).toEqual([])
  })

  it('flattens a category inside a category without losing anything', () => {
    const rows = normalizeIdeas([
      {
        id: 'k1',
        kind: 'category',
        text: 'Ytre',
        ideas: [
          { id: 'i1', kind: 'idea', text: 'a' },
          {
            id: 'k2',
            kind: 'category',
            text: 'Indre',
            ideas: [{ id: 'i2', kind: 'idea', text: 'b' }],
          },
        ],
      },
    ])
    expect(shape(rows)).toBe('[Ytre: a, Indre, b]')
    const outer = rows[0]
    expect(outer && isCategory(outer) ? outer.ideas.every((row) => row.kind === 'idea') : false).toBe(
      true,
    )
  })

  it('holds the limit', () => {
    const raw = Array.from({ length: MAX_IDEAS + 20 }, (_, index) => ({
      kind: 'idea',
      text: `idé ${index}`,
    }))
    expect(countRows(normalizeIdeas(raw))).toBe(MAX_IDEAS)
  })

  it('makes an empty list of anything that is not one', () => {
    expect(normalizeIdeas(null)).toEqual([])
    expect(normalizeIdeas('nope')).toEqual([])
  })
})
