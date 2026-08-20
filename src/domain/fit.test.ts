import { describe, expect, it } from 'vitest'
import { estimateDocHeight, estimateFit } from './fit'
import { createContainer, createTitledCard, createUntitledCard } from './content'
import { emptyDoc, paragraphDoc } from './richdoc'
import type { Rect } from './types'

const big: Rect = { x: 0, y: 0, width: 800, height: 600 }
const small: Rect = { x: 0, y: 0, width: 200, height: 120 }

describe('estimateDocHeight', () => {
  it('grows with text length', () => {
    const short = estimateDocHeight(paragraphDoc('kort'), 400)
    const long = estimateDocHeight(paragraphDoc('ord '.repeat(200)), 400)
    expect(long).toBeGreaterThan(short)
  })

  it('grows as the column narrows', () => {
    const wide = estimateDocHeight(paragraphDoc('ord '.repeat(100)), 800)
    const narrow = estimateDocHeight(paragraphDoc('ord '.repeat(100)), 200)
    expect(narrow).toBeGreaterThan(wide)
  })

  it('returns infinity for a zero-width column', () => {
    expect(estimateDocHeight(paragraphDoc('tekst'), 0)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('estimateFit', () => {
  it('accepts empty content anywhere usable', () => {
    expect(estimateFit(createUntitledCard(), small).fits).toBe(true)
    expect(estimateFit(createContainer(), small).fits).toBe(true)
  })

  it('rejects content that overflows a small zone', () => {
    const card = createUntitledCard()
    const filled = {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc('ord '.repeat(500)) }],
      },
    }
    const result = estimateFit(filled, small)
    expect(result.fits).toBe(false)
    expect(result.overflow).toBeGreaterThan(0)
  })

  it('accepts the same content in a large zone', () => {
    const card = createUntitledCard()
    const filled = {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc('ord '.repeat(80)) }],
      },
    }
    expect(estimateFit(filled, big).fits).toBe(true)
  })

  it('accounts for the header of a titled card', () => {
    const doc = paragraphDoc('ord '.repeat(70))
    const untitled = createUntitledCard()
    const titled = createTitledCard('Tittel')
    const fillBody = <T extends typeof untitled | typeof titled>(content: T): T => ({
      ...content,
      body: { ...content.body, subfields: [{ ...content.body.subfields[0], doc }] },
    })
    const area: Rect = { x: 0, y: 0, width: 500, height: 260 }
    expect(estimateFit(fillBody(untitled), area).overflow).toBeLessThan(
      estimateFit(fillBody(titled), area).overflow,
    )
  })

  it('rejects a degenerate rect', () => {
    expect(estimateFit(createUntitledCard(), { x: 0, y: 0, width: 0, height: 0 }).fits).toBe(false)
  })

  it('treats a container with an asset as always fitting', () => {
    const container = createContainer({ type: 'asset', assetId: 'a1', fit: 'contain' })
    expect(estimateFit(container, small).fits).toBe(true)
  })

  it('splits the available height between subfields', () => {
    const doc = paragraphDoc('ord '.repeat(40))
    const one = createUntitledCard()
    const single = { ...one, body: { ...one.body, subfields: [{ ...one.body.subfields[0], doc }] } }
    const two = createUntitledCard()
    const double = {
      ...two,
      body: {
        axis: 'y' as const,
        weights: [1, 1],
        subfields: [
          { id: 'a', doc },
          { id: 'b', doc: emptyDoc() },
        ],
      },
    }
    const area: Rect = { x: 0, y: 0, width: 400, height: 220 }
    expect(estimateFit(single, area).overflow).toBeLessThan(estimateFit(double, area).overflow)
  })
})
