import { describe, expect, it } from 'vitest'
import {
  citationLabel,
  citationLabelsFor,
  compressNumbers,
  computeReferenceNumbering,
  formatReference,
  planReferenceSlides,
  referenceEntries,
  splitReferences,
} from './references'
import { createPresentation } from './presentation'
import { createLeaf, createSplit } from './layout'
import { createTitledCard } from './content'
import type { Presentation, Reference, RichDoc } from './types'
import { contentAt, sectionAt } from './testDecks'

function citationDoc(...ids: string[]): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Tekst' },
          { type: 'citation', attrs: { referenceIds: ids } },
        ],
      },
    ],
  }
}

function reference(id: string, title: string): Reference {
  return { id, title, authors: 'Forfatter', url: '', year: '2024' }
}

function presentationWithCitations(): Presentation {
  const base = createPresentation({ title: 'Referansetest' })
  const cardA = createTitledCard('A')
  const cardB = createTitledCard('B')
  const withDocs = {
    ...cardA,
    body: { ...cardA.body, subfields: [{ ...cardA.body.subfields[0], doc: citationDoc('r2', 'r1') }] },
  }
  const withDocsB = {
    ...cardB,
    body: { ...cardB.body, subfields: [{ ...cardB.body.subfields[0], doc: citationDoc('r3') }] },
  }
  return {
    ...base,
    references: [reference('r1', 'Første'), reference('r2', 'Andre'), reference('r3', 'Tredje'), reference('r4', 'Ubrukt')],
    slides: [
      sectionAt(base, 0),
      {
        ...contentAt(base, 1),
        root: createSplit('x', [1, 1], [createLeaf(withDocs), createLeaf(withDocsB)]),
      },
    ],
  }
}

describe('compressNumbers', () => {
  it('compresses runs of three or more', () => {
    expect(compressNumbers([1, 2, 3, 5, 6, 8, 9, 10])).toBe('1–3, 5, 6, 8–10')
  })

  it('keeps pairs listed separately', () => {
    expect(compressNumbers([4, 5])).toBe('4, 5')
  })

  it('handles single values, gaps and duplicates', () => {
    expect(compressNumbers([7])).toBe('7')
    expect(compressNumbers([])).toBe('')
    expect(compressNumbers([3, 1, 2, 2])).toBe('1–3')
    expect(compressNumbers([1, 3, 5])).toBe('1, 3, 5')
  })
})

describe('numbering', () => {
  it('numbers by first occurrence, not by list order', () => {
    const numbering = computeReferenceNumbering(presentationWithCitations())
    expect(numbering.get('r2')).toBe(1)
    expect(numbering.get('r1')).toBe(2)
    expect(numbering.get('r3')).toBe(3)
    expect(numbering.has('r4')).toBe(false)
  })

  it('renumbers when slides are reordered', () => {
    const presentation = presentationWithCitations()
    const slide = contentAt(presentation, 1)
    const root = slide.root as { children: unknown[] }
    const flipped: Presentation = {
      ...presentation,
      slides: [
        sectionAt(presentation, 0),
        {
          ...slide,
          root: { ...slide.root, children: [root.children[1], root.children[0]] } as typeof slide.root,
        },
      ],
    }
    const numbering = computeReferenceNumbering(flipped)
    expect(numbering.get('r3')).toBe(1)
  })

  it('ignores citations pointing at unknown references', () => {
    const presentation = presentationWithCitations()
    const stripped = { ...presentation, references: [reference('r1', 'Første')] }
    const numbering = computeReferenceNumbering(stripped)
    expect(numbering.size).toBe(1)
    expect(numbering.get('r1')).toBe(1)
  })

  it('separates used from unused references', () => {
    const { used, unused } = splitReferences(presentationWithCitations())
    expect(used.map((reference) => reference.id)).toEqual(['r2', 'r1', 'r3'])
    expect(unused.map((reference) => reference.id)).toEqual(['r4'])
  })

  it('renders a compressed citation label', () => {
    const numbering = computeReferenceNumbering(presentationWithCitations())
    expect(citationLabel(['r2', 'r1', 'r3'], numbering)).toBe('1–3')
    expect(citationLabel(['r3'], numbering)).toBe('3')
  })
})

describe('formatReference', () => {
  it('joins present parts with a middle dot', () => {
    expect(formatReference({ id: 'x', title: 'T', authors: 'A', url: 'u', year: '2020' })).toBe(
      'T ⋅ A ⋅ 2020 ⋅ u',
    )
  })

  it('drops empty parts', () => {
    expect(formatReference({ id: 'x', title: 'T', authors: '', url: '', year: '2020' })).toBe('T ⋅ 2020')
  })
})

describe('forfatter og år', () => {
  it('gir entydige etiketter for siterte kilder og de samme etikettene på referansesliden', () => {
    const presentation = presentationWithCitations()
    presentation.references = [
      { ...presentation.references[0], authors: 'Hansen, Ola; Dahl, Eli' },
      { ...presentation.references[1], authors: 'Hansen, Ola; Haugen, Kari' },
      { ...presentation.references[2], authors: '', year: '' },
      { ...presentation.references[3], authors: 'Hansen, Ola; Berg, Anja' },
    ]
    const { numbering, authorYearLabels } = citationLabelsFor(presentation, 'author-year')
    expect(citationLabel(['r2', 'r1', 'r2', 'r3', 'r4'], numbering, authorYearLabels)).toBe(
      'Hansen et al., 2024a; Hansen et al., 2024b; Tredje, u.å.',
    )
    expect(referenceEntries(presentation, 'author-year').map((entry) => entry.authorYearLabel)).toEqual([
      'Hansen et al., 2024a',
      'Hansen et al., 2024b',
      'Tredje, u.å.',
    ])
  })
})

describe('planReferenceSlides', () => {
  const entries = referenceEntries(presentationWithCitations())

  it('uses a single column when everything fits', () => {
    const plan = planReferenceSlides(entries, { width: 1552, height: 756 })
    expect(plan.columns).toBe(1)
    expect(plan.slides).toHaveLength(1)
  })

  it('adds columns before adding slides', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `r${index}`,
      number: index + 1,
      text: `Referanse nummer ${index} med en ganske lang tittel som tar plass`,
      label: `Referanse nummer ${index} med en ganske lang tittel som tar plass`,
      url: '',
    }))
    const plan = planReferenceSlides(many, { width: 1552, height: 400 })
    expect(plan.columns).toBeGreaterThan(1)
  })

  it('adds slides rather than shrinking below the minimum font', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      id: `r${index}`,
      number: index + 1,
      text: `Referanse ${index} med en veldig lang tittel som tar mye plass i kolonnen`,
      label: `Referanse ${index} med en veldig lang tittel som tar mye plass i kolonnen`,
      url: '',
    }))
    const plan = planReferenceSlides(many, { width: 1552, height: 500 })
    expect(plan.slides.length).toBeGreaterThan(1)
    const total = plan.slides.flat().flat().length
    expect(total).toBe(many.length)
  })

  it('returns nothing for an empty reference list', () => {
    expect(planReferenceSlides([], { width: 1000, height: 500 }).slides).toEqual([])
  })
})
