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
  MAX_RANKED_QUANTIZATIONS,
  areRatiosQuantized,
  equalityKeysForDrag,
  equalityKeysForZoneResize,
  proportionalQuantizations,
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

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b)
}

/** `[2, 4, 2]` and `[1, 2, 1]` are one layout; this is the name they share. */
function layoutOf(ratios: readonly number[]): string {
  const divisor = ratios.reduce((current, ratio) => greatestCommonDivisor(current, ratio), 0)
  return ratios.map((ratio) => ratio / divisor).join(':')
}

/**
 * The `count` closest legal layouts, found by looking at every one of them.
 *
 * Written out here in full — sort everything, then take the front — because
 * that is the definition the implementation is supposed to meet, and it must
 * not share a line of reasoning with it. It is the only honest way to check a
 * ranking whose whole point is that it cannot be assembled one total at a time.
 */
function bruteForceRanked(
  desired: readonly number[],
  count: number,
  accept: (ratios: readonly number[]) => boolean = () => true,
): number[][] {
  const scored = everyVector(desired.length)
    .filter(accept)
    .map((ratios) => ({
      ratios,
      loss: lossOf(desired, ratios),
      total: ratios.reduce((sum, ratio) => sum + ratio, 0),
    }))
  scored.sort((a, b) => {
    if (Math.abs(a.loss - b.loss) > 1e-12) return a.loss - b.loss
    if (a.total !== b.total) return a.total - b.total
    for (let index = 0; index < a.ratios.length; index += 1) {
      if (a.ratios[index] !== b.ratios[index]) return a.ratios[index] - b.ratios[index]
    }
    return 0
  })
  const out: number[][] = []
  const seen = new Set<string>()
  for (const candidate of scored) {
    const layout = layoutOf(candidate.ratios)
    if (seen.has(layout)) continue
    seen.add(layout)
    out.push(candidate.ratios)
    if (out.length >= count) break
  }
  return out
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
    expect(ratios).toEqual(bruteForceRanked(desired, 1)[0])
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
      expect(areRatiosQuantized(ratios)).toBe(true)
      expect(ratios).toEqual(bruteForceRanked(desired, 1)[0])
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
    const tied = (ratios: readonly number[]): boolean =>
      ratios[2] === ratios[3] && ratios[3] === ratios[4]
    expect(quantizeRatios(dragged, { equalityKeys: keys })).toEqual(
      bruteForceRanked(dragged, 1, tied)[0],
    )
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
    const ranked = rankedRatioQuantizations(desired, 5)
    expect(ranked.length).toBe(5)
    for (const ratios of ranked) expect(areRatiosQuantized(ratios)).toBe(true)
    const losses = ranked.map((ratios) => lossOf(desired, ratios))
    for (let index = 1; index < losses.length; index += 1) {
      expect(losses[index]).toBeGreaterThanOrEqual(losses[index - 1] - 1e-12)
    }
  })

  it('never offers the same geometry twice', () => {
    const ranked = rankedRatioQuantizations([1, 2, 1], 6)
    const seen = new Set(ranked.map((ratios) => proportionsOf(ratios).join(':')))
    expect(seen.size).toBe(ranked.length)
    expect(ranked[0]).toEqual([1, 2, 1])
  })

  it('agrees with quantizeRatios about the best one', () => {
    const desired = [0.4, 3.3, 1.1]
    expect(rankedRatioQuantizations(desired, 1)[0]).toEqual(quantizeRatios(desired))
  })

  it('ranks by how close a layout is, not by which total it belongs to', () => {
    // The list used to be built from one winner per total, which looks like a
    // ranking and is not: `9 : 4 : 2` is closer than `7 : 3 : 1`, but total 15
    // was already spoken for, so the further layout was offered and the nearer
    // one never was. On a fallback list that decides which drags are accepted,
    // that is the difference between a handle that works and one that does not.
    const desired = [19.56, 7.177, 4.147]
    const ranked = rankedRatioQuantizations(desired, 6)
    expect(ranked).toEqual(bruteForceRanked(desired, 6))
    expect(ranked.map((ratios) => ratios.join(':'))).toContain('9:4:2')
  })

  it('matches an exhaustive ranking for arbitrary wishes', () => {
    const random = makeRandom(9176)
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const length = 2 + Math.floor(random() * 2)
      const desired = Array.from({ length }, () => 0.05 + random() * 20)
      expect(rankedRatioQuantizations(desired, 6), desired.join(',')).toEqual(
        bruteForceRanked(desired, 6),
      )
    }
  })

  it('matches an exhaustive ranking when zones are tied together', () => {
    const random = makeRandom(3313)
    const tied = (ratios: readonly number[]): boolean => ratios[1] === ratios[2]
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const desired = Array.from({ length: 3 }, () => 0.05 + random() * 20)
      const ranked = rankedRatioQuantizations(desired, 5, { equalityKeys: [null, 7, 7] })
      expect(ranked, desired.join(',')).toEqual(bruteForceRanked(desired, 5, tied))
    }
  })

  it('never hands back more than the search is built to hold', () => {
    expect(rankedRatioQuantizations([1, 2], 1000)).toHaveLength(MAX_RANKED_QUANTIZATIONS)
    expect(rankedRatioQuantizations([1, 2], 0)).toHaveLength(1)
  })
})

describe('proportionalQuantizations', () => {
  /** Whether `ratios` keeps the proportions `base` has at `members`. */
  const keeps = (ratios: readonly number[], base: readonly number[], members: readonly number[]) =>
    members.every((index) => ratios[index] * base[members[0]] === base[index] * ratios[members[0]])

  it('only offers layouts that keep every block exactly, closest first', () => {
    const base = [1, 2, 3, 4]
    const desired = [0.9, 2.7, 2.7, 3.6]
    const block = [0, 2, 3]
    const offered = proportionalQuantizations(desired, base, [block], 6)
    expect(offered.length).toBe(6)
    for (const ratios of offered) {
      expect(areRatiosQuantized(ratios)).toBe(true)
      expect(keeps(ratios, base, block)).toBe(true)
    }
    const losses = offered.map((ratios) => lossOf(desired, ratios))
    expect([...losses].sort((a, b) => a - b)).toEqual(losses)
  })

  it('is the closest such layout there is, checked against every vector', () => {
    const base = [2, 1, 3]
    const desired = [3.1, 1.6, 4.4]
    const blocks = [[0, 2]]
    const [best] = proportionalQuantizations(desired, base, blocks, 1)
    const legal = everyVector(3).filter((ratios) => keeps(ratios, base, blocks[0]))
    const bestLoss = Math.min(...legal.map((ratios) => lossOf(desired, ratios)))
    expect(lossOf(desired, best)).toBeCloseTo(bestLoss, 12)
  })

  it('scales two blocks independently of each other', () => {
    const base = [1, 2, 3, 3, 1]
    const blocks = [
      [0, 1, 2],
      [3, 4],
    ]
    for (const ratios of proportionalQuantizations([1.5, 3, 4.5, 1.5, 0.5], base, blocks, 8)) {
      expect(keeps(ratios, base, blocks[0])).toBe(true)
      expect(keeps(ratios, base, blocks[1])).toBe(true)
    }
  })

  it('never offers one layout twice', () => {
    const offered = proportionalQuantizations([1, 3, 1], [1, 1, 1], [[0, 2]], 12)
    const reduced = new Set(
      offered.map((ratios) => proportionsOf(ratios).map((share) => share.toFixed(12)).join(':')),
    )
    expect(reduced.size).toBe(offered.length)
  })
})

describe('equalityKeysForZoneResize', () => {
  it('keeps equal zones together on both sides of the resized one', () => {
    expect(equalityKeysForZoneResize([2, 3, 2, 3], 1)).toEqual([2, null, 2, 3])
  })
})
