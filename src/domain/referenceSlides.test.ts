import { describe, expect, it } from 'vitest'
import { buildReferenceSlides, presentationSlides } from './referenceSlides'
import { createPresentation } from './presentation'
import { createLeaf } from './layout'
import { createUntitledCard } from './content'
import { validateSlideGeometry } from './geometry'
import type { Presentation, Reference, RichDoc } from './types'
import { contentAt, sectionAt } from './testDecks'

function citing(ids: string[]): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Påstand' },
          { type: 'citation', attrs: { referenceIds: ids } },
        ],
      },
    ],
  }
}

function withReferences(count: number): Presentation {
  const base = createPresentation({ title: 'Referanseslides' })
  const references: Reference[] = Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    title: `Kilde nummer ${index} med en ganske lang tittel for pagineringen`,
    authors: 'Forfatter Forfattersen',
    url: index % 2 === 0 ? 'https://example.com' : '',
    year: '2026',
  }))
  const card = createUntitledCard()
  const content = {
    ...card,
    body: {
      ...card.body,
      subfields: [{ ...card.body.subfields[0], doc: citing(references.map((r) => r.id)) }],
    },
  }
  return { ...base, references, slides: [sectionAt(base, 0),{ ...contentAt(base, 1), root: createLeaf(content) }] }
}

describe('buildReferenceSlides', () => {
  it('produces nothing when nothing is cited', () => {
    expect(buildReferenceSlides(createPresentation({ title: 'Tom' }))).toEqual([])
  })

  it('produces one derived slide for a short list', () => {
    const slides = buildReferenceSlides(withReferences(4))
    expect(slides).toHaveLength(1)
    expect(slides[0].id).toContain('__references__')
    expect(JSON.stringify(slides[0])).toContain('Kilde nummer 0')
  })

  it('numbers entries by first occurrence', () => {
    const slides = buildReferenceSlides(withReferences(3))
    const json = JSON.stringify(slides[0])
    expect(json).toContain('1. ')
    expect(json).toContain('2. ')
    expect(json).toContain('3. ')
  })

  it('adds columns, then extra slides, rather than shrinking the font', () => {
    const few = buildReferenceSlides(withReferences(6))
    const many = buildReferenceSlides(withReferences(120))
    expect(few).toHaveLength(1)
    expect(many.length).toBeGreaterThan(1)
    for (const slide of many) expect(validateSlideGeometry(slide)).toEqual([])
  })

  it('keeps derived slides geometrically valid', () => {
    for (const slide of buildReferenceSlides(withReferences(30))) {
      expect(validateSlideGeometry(slide)).toEqual([])
    }
  })

  it('produces stable ids across rebuilds', () => {
    const presentation = withReferences(5)
    const first = buildReferenceSlides(presentation).map((slide) => slide.id)
    const second = buildReferenceSlides(presentation).map((slide) => slide.id)
    expect(first).toEqual(second)
  })

  it('appends derived slides after the authored ones', () => {
    const presentation = withReferences(3)
    const slides = presentationSlides(presentation)
    expect(slides).toHaveLength(presentation.slides.length + 1)
    expect(slides[0].id).toBe(presentation.slides[0].id)
  })

  it('links entries that have a url', () => {
    const json = JSON.stringify(buildReferenceSlides(withReferences(2)))
    expect(json).toContain('"type":"link"')
    expect(json).toContain('https://example.com')
  })
})
