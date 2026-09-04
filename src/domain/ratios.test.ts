/**
 * Ratio quantisation.
 *
 * The interesting claim is not that the output is integers — it is that the
 * output is the *closest* integer layout, so most of what follows measures the
 * answer against an exhaustive sweep of every legal vector rather than against
 * a number somebody typed into an expectation.
 */

import { describe, expect, it } from 'vitest'
import { MAX_ZONE_RATIO, MIN_ZONE_RATIO } from './constants'
import {
  areRatiosQuantized,
  equalityKeysForDrag,
  quantizeRatios,
  rankedRatioQuantizations,
} from './ratios'

function proportionsOf(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

function lossOf(desired: readonly number[], ratios: readonly number[]): number {
  const wanted = proportionsOf(desired)
  const got = proportionsOf(ratios)
  return wanted.reduce((sum, p, index) => sum + (p - got[index]) ** 2, 0)
}

/** Every legal vector, for cross-checking the search on small inputs. */
function everyVector(length: number): number[][] {
  if (length === 0) return [[]]
  const rest = everyVector(length - 1)
  const out: number[][] = []
  for (let value = MIN_ZONE_RATIO; value <= MAX_ZONE_RATIO; value += 1) {
    for (const tail of rest) out.push([value, ...tail])
  }
  return out
}

function bruteForceBest(
  desired: readonly number[],
  accept: (ratios: readonly number[]) => boolean = () => true,
): { ratios: number[]; loss: number } {
  let best: { ratios: number[]; loss: number } | null = null
  for (const ratios of everyVector(desired.length)) {
    if (!accept(ratios)) continue
    const loss = lossOf(desired, ratios)
    const total = ratios.reduce((sum, ratio) => sum + ratio, 0)
    const bestTotal = best ? best.ratios.reduce((sum, ratio) => sum + ratio, 0) : 0
    if (!best || loss < best.loss - 1e-12 || (Math.abs(loss - best.loss) <= 1e-12 && total < bestTotal)) {
      best = { ratios, loss }
    }
  }
  if (!best) throw new Error('no legal vector')
  return best
}

/** Deterministic PRNG so a failure is always reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

describe('quantizeRatios', () => {
  it('leaves a layout that is already legal exactly as it is', () => {
    expect(quantizeRatios([1, 1])).toEqual([1, 1])
    expect(quantizeRatios([1, 2, 3])).toEqual([1, 2, 3])
    expect(quantizeRatios([2, 5, 3, 3, 3])).toEqual([2, 5, 3, 3, 3])
    expect(quantizeRatios([10, 1])).toEqual([10, 1])
    expect(quantizeRatios([7, 9, 10, 4])).toEqual([7, 9, 10, 4])
  })

  it('gives proportionally equivalent inputs the same answer', () => {
    const expected = [1, 2, 1]
    expect(quantizeRatios([1, 2, 1])).toEqual(expected)
    expect(quantizeRatios([10, 20, 10])).toEqual(expected)
    expect(quantizeRatios([0.5, 1, 0.5])).toEqual(expected)
    expect(quantizeRatios([0.25, 0.5, 0.25])).toEqual(expected)
  })

  it('prefers the simplest representation of one layout', () => {
    expect(quantizeRatios([2, 4, 2])).toEqual([1, 2, 1])
    expect(quantizeRatios([4, 8, 4])).toEqual([1, 2, 1])
    expect(quantizeRatios([6, 9])).toEqual([2, 3])
    expect(quantizeRatios([10, 10, 10])).toEqual([1, 1, 1])
  })

  it('reads decimals as relative weights', () => {
    const desired = [0.25, 1.6, 3.14159]
    const ratios = quantizeRatios(desired)
    expect(areRatiosQuantized(ratios)).toBe(true)
    expect(lossOf(desired, ratios)).toBeCloseTo(bruteForceBest(desired).loss, 12)
    expect(ratios).toEqual(bruteForceBest(desired).ratios)
  })

  it('handles weights below one', () => {
    expect(quantizeRatios([0.2, 0.3])).toEqual([2, 3])
    expect(quantizeRatios([0.1, 0.1, 0.2])).toEqual([1, 1, 2])
    expect(quantizeRatios([0.001, 0.002])).toEqual([1, 2])
  })

  it('handles weights above ten', () => {
    expect(quantizeRatios([40, 20])).toEqual([2, 1])
    expect(quantizeRatios([100, 50, 25])).toEqual([4, 2, 1])
    expect(quantizeRatios([1000, 1000])).toEqual([1, 1])
  })

  it('gets as close as the range allows to an extreme wish', () => {
    expect(quantizeRatios([1, 100])).toEqual([1, 10])
    expect(quantizeRatios([100, 1])).toEqual([10, 1])
    expect(quantizeRatios([1, 1, 500])).toEqual([1, 1, 10])
  })

  it('is deterministic', () => {
    const desired = [0.37, 2.4, 1.03, 5.9]
    const first = quantizeRatios(desired)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(quantizeRatios([...desired])).toEqual(first)
    }
  })

  it('rejects weights that are not positive numbers', () => {
    expect(() => quantizeRatios([])).toThrow()
    expect(() => quantizeRatios([1, 0])).toThrow()
    expect(() => quantizeRatios([1, -2])).toThrow()
    expect(() => quantizeRatios([1, Number.NaN])).toThrow()
    expect(() => quantizeRatios([1, Number.POSITIVE_INFINITY])).toThrow()
    // Individually finite, but there is no distribution to approximate.
    expect(() => quantizeRatios([1e308, 1e308])).toThrow()
  })

  it('finds the same optimum an exhaustive sweep finds', () => {
    const random = makeRandom(20260904)
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const length = 2 + Math.floor(random() * 3)
      const desired = Array.from({ length }, () => 0.01 + random() * 40)
      const ratios = quantizeRatios(desired)
      const best = bruteForceBest(desired)
      expect(areRatiosQuantized(ratios)).toBe(true)
      expect(ratios).toEqual(best.ratios)
    }
  })

  it('always commits whole numbers inside the range', () => {
    const random = makeRandom(7919)
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const length = 2 + Math.floor(random() * 9)
      const desired = Array.from({ length }, () => 0.0001 + random() ** 4 * 900)
      const ratios = quantizeRatios(desired)
      expect(ratios).toHaveLength(length)
      expect(areRatiosQuantized(ratios)).toBe(true)
    }
  })
})

describe('equality groups', () => {
  it('keeps untouched zones that shared a ratio sharing one', () => {
    const before = [2, 5, 3, 3, 3]
    // The author drags the first boundary a long way right.
    const dragged = [5.6, 1.4, 3, 3, 3]
    const ratios = quantizeRatios(dragged, {
      equalityKeys: equalityKeysForDrag(before, 0),
    })
    expect(ratios[2]).toBe(ratios[3])
    expect(ratios[3]).toBe(ratios[4])
    expect(areRatiosQuantized(ratios)).toBe(true)
  })

  it('keeps the untouched half of a group together when the drag splits it', () => {
    const before = [3, 3, 3, 3]
    const dragged = [4.4, 1.6, 3, 3]
    const ratios = quantizeRatios(dragged, {
      equalityKeys: equalityKeysForDrag(before, 0),
    })
    expect(ratios[2]).toBe(ratios[3])
  })

  it('lets the dragged boundary break an equality it was pointed at', () => {
    const before = [2, 2, 5]
    const dragged = [3.1, 0.9, 5]
    const keys = equalityKeysForDrag(before, 0)
    expect(keys).toEqual([null, null, 5])
    const ratios = quantizeRatios(dragged, { equalityKeys: keys })
    expect(ratios[0]).not.toBe(ratios[1])
  })

  it('is the best answer among the ones the constraint allows', () => {
    const before = [2, 5, 3, 3, 3]
    const dragged = [4.1, 2.9, 3, 3, 3]
    const keys = equalityKeysForDrag(before, 0)
    const ratios = quantizeRatios(dragged, { equalityKeys: keys })
    // Small enough to sweep: the three tied zones move as one.
    let best: { ratios: number[]; loss: number } | null = null
    for (const [a, b, c] of everyVector(3)) {
      const candidate = [a, b, c, c, c]
      const loss = lossOf(dragged, candidate)
      const total = candidate.reduce((sum, value) => sum + value, 0)
      const bestTotal = best ? best.ratios.reduce((sum, value) => sum + value, 0) : 0
      if (!best || loss < best.loss - 1e-12 || (Math.abs(loss - best.loss) <= 1e-12 && total < bestTotal)) {
        best = { ratios: candidate, loss }
      }
    }
    expect(ratios).toEqual(best?.ratios)
  })

  it('never returns a total the group sizes cannot reach', () => {
    // Three zones locked together can only ever sum to a multiple of three.
    const ratios = quantizeRatios([1, 1, 1], { equalityKeys: ['a', 'a', 'a'] })
    expect(ratios).toEqual([1, 1, 1])
  })
})

describe('rankedRatioQuantizations', () => {
  it('lists distinct layouts, closest first', () => {
    const desired = [1, 2.4]
    const ranked = rankedRatioQuantizations(desired, {}, 5)
    expect(ranked.length).toBe(5)
    for (const ratios of ranked) expect(areRatiosQuantized(ratios)).toBe(true)
    const losses = ranked.map((ratios) => lossOf(desired, ratios))
    for (let index = 1; index < losses.length; index += 1) {
      expect(losses[index]).toBeGreaterThanOrEqual(losses[index - 1] - 1e-12)
    }
  })

  it('never offers the same geometry twice', () => {
    const ranked = rankedRatioQuantizations([1, 2, 1], {}, 6)
    const seen = new Set(ranked.map((ratios) => proportionsOf(ratios).join(':')))
    expect(seen.size).toBe(ranked.length)
    expect(ranked[0]).toEqual([1, 2, 1])
  })

  it('agrees with quantizeRatios about the best one', () => {
    const desired = [0.4, 3.3, 1.1]
    expect(rankedRatioQuantizations(desired)[0]).toEqual(quantizeRatios(desired))
  })
})
