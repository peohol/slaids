import { describe, expect, it, vi } from 'vitest'
import type { Slide } from '../../domain/types'
import { NEW_PAGE_OPTIONS, insertionIndex, newPageEntries, pageName, placementText, withPlacement } from './pageKinds'

const deck = (...kinds: Slide['kind'][]) => kinds.map((kind, index) => ({ id: `s${index}`, kind }))

describe('insertionIndex', () => {
  const slides = deck('section', 'content', 'content', 'section')

  it('puts a page in front of `before`, right after `after`, else after the current slide', () => {
    expect(insertionIndex(slides, { before: 's2' }, 's3')).toBe(2)
    expect(insertionIndex(slides, { after: 's2' }, 's0')).toBe(3)
    expect(insertionIndex(slides, { after: 's3' }, 's0')).toBe(4)
    expect(insertionIndex(slides, {}, 's1')).toBe(2)
  })

  it('falls back when the named slide has gone, and to the end with nothing to go by', () => {
    expect(insertionIndex(slides, { before: 'gone' }, 's1')).toBe(2)
    expect(insertionIndex(slides, { after: 'gone' }, null)).toBe(slides.length)
  })
})

describe('placementText', () => {
  it('names the page in front, as the strip numbers it', () => {
    const slides = deck('section', 'content', 'section', 'interactive')
    expect(placementText(slides, 1)).toBe('etter forsiden')
    expect(placementText(slides, 2)).toBe('etter slide 2')
    expect(placementText(slides, 3)).toBe('etter inndeling 3')
    expect(placementText(slides, 4)).toBe('etter miniapp 4')
    expect(placementText(slides, 0)).toBe('først i presentasjonen')
  })

  it('agrees with where the page is actually put', () => {
    const slides = deck('section', 'content', 'content')
    const index = insertionIndex(slides, { after: 's1' }, 's2')
    expect(placementText(slides, index)).toBe(`etter ${pageName('content', 1).toLowerCase()}`)
  })

  it('leads a dialog description, or leaves it alone', () => {
    expect(withPlacement('etter slide 2', 'Tekst.')).toBe('Kommer etter slide 2. Tekst.')
    expect(withPlacement(undefined, 'Tekst.')).toBe('Tekst.')
  })
})

describe('newPageEntries', () => {
  it('offers each kind under its one name and icon, with the surface\'s test ids', () => {
    const choose = vi.fn()
    const entries = newPageEntries(choose, 'add')
    expect(entries.map((entry) => [entry.label, entry.icon, entry.testId])).toEqual(
      NEW_PAGE_OPTIONS.map((option) => [option.label, option.icon, `add-${option.id}`]),
    )
    entries[1].onSelect()
    expect(choose).toHaveBeenCalledWith(NEW_PAGE_OPTIONS[1].kind)
  })
})
