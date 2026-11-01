import { describe, expect, it } from 'vitest'
import { MAX_SPLIT_CHILDREN, MIN_SPLIT_CHILDREN } from '../../domain/constants'
import { createContentOfKind } from '../../domain/content'
import { createLeaf, createSplit } from '../../domain/layout'
import { err, ok } from '../../domain/result'
import { createPresentation } from '../../domain/presentation'
import type { LayoutNode } from '../../domain/types'
import {
  parseCount,
  parseWeight,
  removalSummary,
  removedDetail,
  removedZones,
  shares,
  splitCheck,
  weightFieldError,
} from './splitDraft'

const card = () => createContentOfKind('titled-card')

describe('parseWeight / weightFieldError', () => {
  it('reads every positive decimal, with a comma or a point', () => {
    for (const [typed, value] of [
      ['1', 1],
      ['0,25', 0.25],
      ['0.25', 0.25],
      [' 3.5 ', 3.5],
      ['60', 60],
    ] as const) {
      expect(parseWeight(typed)).toBe(value)
      expect(weightFieldError(typed)).toBeNull()
    }
  })

  it('names what is wrong with a field that cannot be used', () => {
    expect(weightFieldError('')).toBe('Skriv inn et forholdstall.')
    expect(weightFieldError('   ')).toBe('Skriv inn et forholdstall.')
    for (const typed of ['abc', '1,2,3', 'NaN', 'Infinity', '1e999']) {
      expect(Number.isNaN(parseWeight(typed)), typed).toBe(true)
      expect(weightFieldError(typed)).toBe('Skriv et tall, for eksempel 2 eller 1,5.')
    }
    for (const typed of ['0', '-1', '-0,5']) {
      expect(weightFieldError(typed)).toBe('Forholdstallet må være større enn 0.')
    }
  })
})

describe('parseCount', () => {
  it('accepts exactly the whole counts a split may have', () => {
    for (let count = MIN_SPLIT_CHILDREN; count <= MAX_SPLIT_CHILDREN; count += 1) {
      expect(parseCount(String(count))).toBe(count)
    }
    for (const typed of ['', '1', String(MAX_SPLIT_CHILDREN + 1), '2.5', 'to', '-3']) {
      expect(parseCount(typed), typed).toBeNull()
    }
  })
})

describe('shares', () => {
  it('always adds up to 100 and follows the weights', () => {
    for (const weights of [
      [1, 1],
      [1, 1, 1],
      [1, 2],
      [1, 10],
      [3, 3, 3, 1],
      Array.from({ length: 7 }, () => 1),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ]) {
      const result = shares(weights)
      expect(result.reduce((sum, value) => sum + value, 0), weights.join(':')).toBe(100)
      const total = weights.reduce((sum, weight) => sum + weight, 0)
      result.forEach((share, index) => {
        expect(Math.abs(share - (weights[index] / total) * 100)).toBeLessThan(1)
      })
    }
    expect(shares([1, 1, 1])).toEqual([34, 33, 33])
  })
})

describe('removedZones', () => {
  /** Four zones: an empty leaf, a card, a split with content two levels down, an empty split. */
  const children: LayoutNode[] = [
    createLeaf(),
    createLeaf(card()),
    createSplit('y', [1, 1], [
      createLeaf(card()),
      createSplit('x', [1, 1, 1], [createLeaf(card()), createLeaf(), createLeaf(card())]),
    ]),
    createSplit('x', [1, 1], [createLeaf(), createLeaf()]),
  ]

  it('is the tail the lower count leaves out, numbered as today, with all content however deep', () => {
    expect(removedZones(children, 4)).toEqual([])
    expect(removedZones(children, 2)).toEqual([
      { label: '3', content: 3, innerZones: 4 },
      { label: '4', content: 0, innerZones: 2 },
    ])
    expect(removedZones(children, 3).map((zone) => zone.label)).toEqual(['4'])
  })

  it('says which zones go and what is in them', () => {
    const many = Array.from({ length: 6 }, () => createLeaf())
    expect(removalSummary(removedZones(many, 5))).toBe('Sone 6 fjernes.')
    expect(removalSummary(removedZones(many, 4))).toBe('Sone 5 og 6 fjernes.')
    expect(removalSummary(removedZones(many, 2))).toBe('Sone 3–6 fjernes.')
    const [nested, empty] = removedZones(children, 2)
    expect(removedDetail(nested)).toBe('Sone 3 inneholder 3 innholdselementer i 4 underordnede soner.')
    expect(removedDetail(empty)).toBe('Sone 4 er tom (2 underordnede soner).')
    expect(removedDetail(removedZones(children, 1)[0])).toBe('Sone 2 inneholder 1 innholdselement.')
  })
})

describe('splitCheck', () => {
  const nested = createSplit('y', [1, 1], [createLeaf(card()), createLeaf(card())])
  const children: LayoutNode[] = [createLeaf(), nested]

  it('counts what an accepted change moves or deletes', () => {
    const outcome = { presentation: createPresentation({ title: 'x' }), movedToSandbox: [card()], discarded: [] }
    expect(splitCheck(ok(outcome), children)).toEqual({ ok: true, movedToSandbox: 1, discarded: 0 })
  })

  it('attributes a refusal to the direct zone whose subtree it names', () => {
    const leaf = (nested.kind === 'split' ? nested.children[1] : nested).id
    expect(
      splitCheck(err('CONTENT_DOES_NOT_FIT', 'Får ikke plass.', { nodeId: leaf }), children),
    ).toEqual({ ok: false, message: 'Får ikke plass.', zones: [1] })
    expect(
      splitCheck(err('ZONE_TOO_SMALL', 'For små.', { nodeId: 'parent', tooSmall: [1, 0] }), children),
    ).toEqual({ ok: false, message: 'For små.', zones: [0, 1] })
    expect(splitCheck(err('NODE_NOT_FOUND', ''), children)).toEqual({
      ok: false,
      message: 'Fant ikke sonen.',
      zones: [],
    })
  })
})
