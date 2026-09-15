import { describe, expect, it } from 'vitest'
import { estimateDocHeight, estimateFit } from './fit'
import { createContainer, createImage, createTitledCard, createUntitledCard } from './content'
import { emptyDoc, paragraphDoc } from './richdoc'
import type { Rect } from './types'

const big: Rect = { x: 0, y: 0, width: 800, height: 600 }
const small: Rect = { x: 0, y: 0, width: 200, height: 130 }

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

describe('the same ratio, written large', () => {
  /** A two-column card whose left field holds text that does not fit in half. */
  function twoColumns(weights: number[]) {
    const card = createUntitledCard()
    return {
      ...card,
      body: {
        axis: 'x' as const,
        weights,
        subfields: [
          { id: 'a', doc: paragraphDoc('Tekst som må brytes over flere linjer. '.repeat(20)) },
          { id: 'b', doc: emptyDoc() },
        ],
      },
    }
  }

  it('measures huge balanced weights exactly like [1, 1]', () => {
    // Weights are ratios, so `[1e307, 1e307]` *is* `[1, 1]` — and the sum is
    // finite, so they are valid. What used to differ was the arithmetic:
    // `usable * 1e307` overflowed to `Infinity`, the share came back infinite,
    // and an infinitely wide subfield fits anything. The fit guard then let
    // through a layout the same layout written `[1, 1]` is refused.
    const rect: Rect = { x: 0, y: 0, width: 1000, height: 300 }
    const even = estimateFit(twoColumns([1, 1]), rect)
    expect(even.fits).toBe(false)

    for (const weights of [[1e307, 1e307], [1e150, 1e150], [1e-8, 1e-8]]) {
      const huge = estimateFit(twoColumns(weights), rect)
      expect(huge.fits, JSON.stringify(weights)).toBe(false)
      expect(huge.overflow, JSON.stringify(weights)).toBeCloseTo(even.overflow, 6)
    }
  })

  it('keeps an uneven ratio the same however it is written', () => {
    const rect: Rect = { x: 0, y: 0, width: 1000, height: 300 }
    const small = estimateFit(twoColumns([3, 1]), rect)
    const large = estimateFit(twoColumns([3e307 / 4, 1e307 / 4]), rect)
    expect(large.overflow).toBeCloseTo(small.overflow, 6)
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
    const container = createImage('a1')
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
