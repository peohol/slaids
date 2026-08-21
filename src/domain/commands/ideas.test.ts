/**
 * The command layer over the ideas list.
 *
 * The arithmetic is tested in `src/domain/ideas.test.ts`; what is checked here
 * is the wrapping: that a real edit reaches the presentation, that a no-op
 * hands the very same presentation back — so the store knows not to make an
 * undo step of it — and that a bad argument comes back as an error rather than
 * a silently ignored call.
 */

import { describe, expect, it } from 'vitest'
import {
  addIdea,
  addIdeaCategory,
  moveIdeaRow,
  removeIdeaRow,
  setIdeaCategoryColor,
  setIdeaText,
} from './ideas'
import { CATEGORY_COLORS, MAX_IDEAS, isCategory } from '../ideas'
import { createPresentation } from '../presentation'
import type { IdeaRow, Presentation } from '../types'

function unwrap(result: { ok: boolean; value?: Presentation; error?: unknown }): Presentation {
  if (!result.ok || !result.value) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

function withRows(rows: IdeaRow[]): Presentation {
  return { ...createPresentation({ title: 'Idéer' }), ideas: rows }
}

/** A presentation holding one category and one loose idea. */
function seeded(): Presentation {
  const one = unwrap(addIdea(createPresentation({ title: 'Idéer' }), { categoryId: null, text: 'løs' }))
  return unwrap(addIdeaCategory(one, 'Kapittel'))
}

describe('adding', () => {
  it('adds an idea as a single line', () => {
    const next = unwrap(
      addIdea(createPresentation({ title: 'Idéer' }), {
        categoryId: null,
        text: '  husk\n  geometrien ',
      }),
    )
    expect(next.ideas).toHaveLength(1)
    expect(next.ideas[0].text).toBe('husk geometrien')
  })

  it('adds an idea into a category', () => {
    const presentation = seeded()
    const category = presentation.ideas.find(isCategory)!
    const next = unwrap(addIdea(presentation, { categoryId: category.id, text: 'under' }))
    const filed = next.ideas.find(isCategory)!
    expect(filed.ideas.map((idea) => idea.text)).toEqual(['under'])
    // The loose idea stays where it was, above the category.
    expect(next.ideas[0].text).toBe('løs')
  })

  it('refuses an empty idea and an unknown category', () => {
    const presentation = seeded()
    expect(addIdea(presentation, { categoryId: null, text: '  ' }).ok).toBe(false)
    expect(addIdea(presentation, { categoryId: 'nope', text: 'noe' }).ok).toBe(false)
  })

  it('refuses to pass the limit', () => {
    const rows: IdeaRow[] = Array.from({ length: MAX_IDEAS }, (_, index) => ({
      id: `i${index}`,
      kind: 'idea' as const,
      text: `idé ${index}`,
    }))
    const presentation = withRows(rows)
    expect(addIdea(presentation, { categoryId: null, text: 'én til' }).ok).toBe(false)
    expect(addIdeaCategory(presentation, 'én til').ok).toBe(false)
  })

  it('gives a category a colour, and validates one it is handed', () => {
    const blank = createPresentation({ title: 'x' })
    const colorOf = (presentation: Presentation): string =>
      presentation.ideas.find(isCategory)!.color

    expect(CATEGORY_COLORS).toContain(colorOf(unwrap(addIdeaCategory(blank, 'Kilder'))))
    expect(colorOf(unwrap(addIdeaCategory(blank, 'Kilder', '#402626')))).toBe('#402626')
    expect(addIdeaCategory(blank, 'Kilder', 'papayawhip').ok).toBe(false)
  })

  it('names a category, and falls back to a name when none is given', () => {
    expect(unwrap(addIdeaCategory(createPresentation({ title: 'x' }), ' Kilder ')).ideas[0].text).toBe(
      'Kilder',
    )
    expect(unwrap(addIdeaCategory(createPresentation({ title: 'x' }), '   ')).ideas[0].text).toBe(
      'Kategori',
    )
  })
})

describe('editing', () => {
  it('renames an idea and a category with the same command', () => {
    const presentation = seeded()
    const [idea, category] = presentation.ideas
    expect(unwrap(setIdeaText(presentation, idea.id, ' ny  tekst ')).ideas[0].text).toBe('ny tekst')
    expect(unwrap(setIdeaText(presentation, category.id, 'Kilder')).ideas[1].text).toBe('Kilder')
  })

  it('hands back the same presentation when nothing changed', () => {
    const presentation = seeded()
    const id = presentation.ideas[0].id
    // Empty text is an abandoned edit, and unchanged text is not an edit at all.
    expect(unwrap(setIdeaText(presentation, id, '   '))).toBe(presentation)
    expect(unwrap(setIdeaText(presentation, id, 'løs'))).toBe(presentation)
  })

  it('refuses an unknown row', () => {
    const presentation = seeded()
    expect(setIdeaText(presentation, 'nope', 'noe').ok).toBe(false)
    expect(removeIdeaRow(presentation, 'nope').ok).toBe(false)
    expect(moveIdeaRow(presentation, 'nope', null, 0).ok).toBe(false)
  })
})

describe('colouring', () => {
  it('recolours a category', () => {
    const presentation = seeded()
    const category = presentation.ideas.find(isCategory)!
    const next = unwrap(setIdeaCategoryColor(presentation, category.id, '#402626'))
    expect(next.ideas.find(isCategory)!.color).toBe('#402626')
  })

  it('refuses a bad colour, an unknown row and an idea', () => {
    const presentation = seeded()
    const category = presentation.ideas.find(isCategory)!
    expect(setIdeaCategoryColor(presentation, category.id, 'papayawhip').ok).toBe(false)
    expect(setIdeaCategoryColor(presentation, 'nope', '#402626').ok).toBe(false)
    // An idea has no colour of its own — it is drawn in the one its list has.
    expect(setIdeaCategoryColor(presentation, presentation.ideas[0].id, '#402626').ok).toBe(false)
  })

  it('hands back the same presentation for the colour it already has', () => {
    const presentation = seeded()
    const category = presentation.ideas.find(isCategory)!
    expect(unwrap(setIdeaCategoryColor(presentation, category.id, category.color))).toBe(presentation)
  })
})

describe('deleting', () => {
  it('deletes an idea', () => {
    const presentation = seeded()
    expect(unwrap(removeIdeaRow(presentation, presentation.ideas[0].id)).ideas).toHaveLength(1)
  })

  it('keeps the ideas when a category goes', () => {
    const presentation = seeded()
    const category = presentation.ideas.find(isCategory)!
    const filled = unwrap(addIdea(presentation, { categoryId: category.id, text: 'blir liggende' }))
    const next = unwrap(removeIdeaRow(filled, category.id))
    // The heading is gone; the note it stood above is not.
    expect(next.ideas.map((row) => row.text)).toEqual(['løs', 'blir liggende'])
    expect(next.ideas.some(isCategory)).toBe(false)
  })
})

describe('moving', () => {
  it('files an idea and takes it out again', () => {
    const presentation = seeded()
    const idea = presentation.ideas[0]
    const category = presentation.ideas.find(isCategory)!

    const filed = unwrap(moveIdeaRow(presentation, idea.id, category.id, 0))
    expect(filed.ideas.find(isCategory)!.ideas.map((entry) => entry.text)).toEqual(['løs'])

    const loose = unwrap(moveIdeaRow(filed, idea.id, null, 1))
    expect(loose.ideas.map((row) => row.text)).toEqual(['Kapittel', 'løs'])
  })

  it('refuses an unknown category', () => {
    const presentation = seeded()
    expect(moveIdeaRow(presentation, presentation.ideas[0].id, 'nope', 0).ok).toBe(false)
  })

  it('hands back the same presentation for a drag that changed nothing', () => {
    const presentation = seeded()
    const category = presentation.ideas.find(isCategory)!
    // A category cannot go inside a category, so the model refuses and nothing
    // is written — the drag simply ends where it began.
    expect(unwrap(moveIdeaRow(presentation, category.id, category.id, 0))).toBe(presentation)
  })
})
