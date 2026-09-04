/**
 * The invariant checker.
 *
 * Two things are being asserted throughout: that a document built by the
 * commands is clean, and that a document that got into a bad shape some other
 * way is described precisely enough to act on. The fixtures therefore build
 * broken states directly rather than through commands — a command would have
 * refused, which is the point.
 */

import { describe, expect, it } from 'vitest'
import { splitLeaf } from './commands'
import { estimateFitChecker, estimateTitleFitChecker } from './fit'
import { TITLE_NODE_ID } from './geometry'
import { createPresentation } from './presentation'
import { findPresentationIssues, findSlideIssues } from './validation'
import type { InvariantCode } from './validation'
import type { Presentation, RichDoc } from './types'

const checkers = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }

function deck(): Presentation {
  return createPresentation({ title: 'Validering' })
}

function codes(issues: { code: InvariantCode }[]): InvariantCode[] {
  return [...new Set(issues.map((issue) => issue.code))].sort()
}

function textDoc(text: string): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function withContainer(presentation: Presentation, doc: RichDoc): Presentation {
  const slide = presentation.slides[0]
  return {
    ...presentation,
    slides: [
      {
        ...slide,
        root: {
          id: slide.root.id,
          kind: 'leaf',
          content: {
            id: 'c1',
            kind: 'container',
            body: { axis: 'y', weights: [1], subfields: [{ id: 'f1', doc }] },
          },
        },
      },
    ],
  }
}

describe('et dokument som er i orden', () => {
  it('har ingen anmerkninger', () => {
    const presentation = withContainer(deck(), textDoc('Kort tekst'))
    expect(findPresentationIssues(presentation, checkers)).toEqual([])
  })

  it('er fortsatt i orden etter en splitting', () => {
    const presentation = deck()
    const split = splitLeaf(presentation, {
      slideId: presentation.slides[0].id,
      nodeId: presentation.slides[0].root.id,
      axis: 'x',
      weights: [1, 1],
      ...checkers,
    })
    if (!split.ok) throw new Error('forventet ok')
    expect(findPresentationIssues(split.value.presentation, checkers)).toEqual([])
  })
})

describe('struktur', () => {
  it('finner et split-tre som bryter invariantene', () => {
    const presentation = deck()
    const slide = presentation.slides[0]
    const broken: Presentation = {
      ...presentation,
      slides: [
        {
          ...slide,
          root: {
            id: slide.root.id,
            kind: 'split',
            axis: 'x',
            // Three children, two weights, and one of them is not a number.
            weights: [1, Number.NaN],
            children: [
              { id: 'n1', kind: 'leaf', content: null },
              { id: 'n2', kind: 'leaf', content: null },
              { id: 'n3', kind: 'leaf', content: null },
            ],
          },
        },
      ],
    }
    expect(codes(findSlideIssues(broken, broken.slides[0], checkers))).toContain(
      'INVALID_STRUCTURE',
    )
  })

  it('finner en sone som er mindre enn minstemålet', () => {
    const presentation = deck()
    const slide = presentation.slides[0]
    const tiny: Presentation = {
      ...presentation,
      slides: [
        {
          ...slide,
          root: {
            id: slide.root.id,
            kind: 'split',
            axis: 'x',
            weights: Array.from({ length: 10 }, () => 1),
            children: Array.from({ length: 10 }, (_, i) => ({
              id: `n${i}`,
              kind: 'leaf' as const,
              content: null,
            })),
          },
        },
      ],
    }
    expect(codes(findSlideIssues(tiny, tiny.slides[0], checkers))).toContain('ZONE_TOO_SMALL')
  })

  it('finner den samme slide-id-en to ganger', () => {
    const presentation = deck()
    const twice: Presentation = {
      ...presentation,
      slides: [presentation.slides[0], presentation.slides[0]],
    }
    const issues = findPresentationIssues(twice, checkers)
    expect(codes(issues)).toContain('INVALID_STRUCTURE')
    expect(issues.some((issue) => issue.details?.slideId === presentation.slides[0].id)).toBe(true)
  })

  it('finner et dokument som ikke lenger matcher skjemaet', () => {
    const presentation = deck()
    const invalid = { ...presentation, theme: { ...presentation.theme, spacing: 'mye' } }
    expect(codes(findPresentationIssues(invalid as unknown as Presentation, checkers))).toContain(
      'INVALID_DOCUMENT',
    )
  })
})

describe('fit', () => {
  it('finner innhold som ikke får plass, med hvor mye', () => {
    const presentation = withContainer(deck(), textDoc('x'.repeat(50000)))
    const issues = findSlideIssues(presentation, presentation.slides[0], checkers)
    const fit = issues.find((issue) => issue.code === 'CONTENT_DOES_NOT_FIT')
    expect(fit?.nodeId).toBe(presentation.slides[0].root.id)
    expect(fit?.details?.overflow).toBeGreaterThan(0)
  })

  it('finner en tittel som ikke får plass, på tittelsonens egen id', () => {
    const presentation = deck()
    const long: Presentation = {
      ...presentation,
      slides: [{ ...presentation.slides[0], title: textDoc('Altfor lang overskrift '.repeat(30)) }],
    }
    const issues = findSlideIssues(long, long.slides[0], checkers)
    expect(issues.find((issue) => issue.code === 'TITLE_DOES_NOT_FIT')?.nodeId).toBe(TITLE_NODE_ID)
  })

  it('sier ingenting om fit når ingen målemetode er oppgitt', () => {
    // The domain layer never measures text on its own; a run without checkers
    // is a structural run, not a silently passing one.
    const presentation = withContainer(deck(), textDoc('x'.repeat(50000)))
    expect(findSlideIssues(presentation, presentation.slides[0])).toEqual([])
  })
})

describe('referanser og filer', () => {
  const citingDoc: RichDoc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'citation', attrs: { referenceIds: ['r_borte'] } }] },
    ],
  }

  it('finner en citation som peker på en referanse som ikke finnes', () => {
    const presentation = withContainer(deck(), citingDoc)
    const issue = findSlideIssues(presentation, presentation.slides[0], checkers).find(
      (entry) => entry.code === 'REFERENCE_NOT_FOUND',
    )
    expect(issue?.details).toMatchObject({ referenceId: 'r_borte' })
  })

  it('finner en sone som peker på en fil som ikke finnes', () => {
    const presentation = deck()
    const slide = presentation.slides[0]
    const broken: Presentation = {
      ...presentation,
      slides: [
        {
          ...slide,
          root: {
            id: slide.root.id,
            kind: 'leaf',
            content: {
              id: 'c1',
              kind: 'image',
              image: { assetId: 'a_borte', focus: { x: 0.5, y: 0.5 }, caption: null },
            },
          },
        },
      ],
    }
    const issue = findSlideIssues(broken, broken.slides[0], checkers).find(
      (entry) => entry.code === 'ASSET_NOT_FOUND',
    )
    expect(issue?.details).toMatchObject({ assetId: 'a_borte' })
    expect(issue?.nodeId).toBe(slide.root.id)
  })

  it('ser også på det som ligger i sandkassen', () => {
    // An item waiting to be placed is real content: a citation that has stopped
    // resolving is broken the day it goes back on a slide, and finding out then
    // is finding out too late.
    const presentation = deck()
    const withSandbox: Presentation = {
      ...presentation,
      sandbox: [
        {
          id: 'sb1',
          createdAt: presentation.createdAt,
          note: '',
          content: {
            id: 'c1',
            kind: 'container',
            body: { axis: 'y', weights: [1], subfields: [{ id: 'f1', doc: citingDoc }] },
          },
        },
      ],
    }
    const issue = findPresentationIssues(withSandbox, checkers).find(
      (entry) => entry.code === 'REFERENCE_NOT_FOUND',
    )
    expect(issue?.details).toMatchObject({ sandboxItemId: 'sb1', referenceId: 'r_borte' })
  })
})

describe('validering er lesing', () => {
  it('endrer ikke presentasjonen den ser på', () => {
    const presentation = withContainer(deck(), textDoc('x'.repeat(50000)))
    const before = JSON.stringify(presentation)
    findPresentationIssues(presentation, checkers)
    findSlideIssues(presentation, presentation.slides[0], checkers)
    expect(JSON.stringify(presentation)).toBe(before)
  })
})
