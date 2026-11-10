import { describe, expect, it } from 'vitest'
import { areRatiosQuantized } from '../../domain/ratios'
import {
  lengthsFor,
  sameProportions,
  shownSubfieldWeights,
  startSubfieldDrag,
  subfieldLengthsAt,
  subfieldSnapCandidates,
} from './subfieldDrag'

const accept = (): boolean => true

function drag(weights: number[], lengths: number[], boundary = 0, floor = 20) {
  const started = startSubfieldDrag({ boundary, axis: 'x', weights, lengths, floor })
  if (!started) throw new Error('draget startet ikke')
  return started
}

describe('drag av delestrek', () => {
  it('bytter lengde bare mellom de to feltene ved streken', () => {
    const d = drag([1, 1, 1], [100, 100, 100], 1)
    expect(subfieldLengthsAt(d, 30, false)).toEqual([100, 130, 70])
    expect(subfieldLengthsAt(d, -30, false)).toEqual([100, 70, 130])
  })

  it('stopper på gulvet og lar aldri et felt bli kortere enn det', () => {
    const d = drag([1, 1], [100, 100], 0, 40)
    expect(subfieldLengthsAt(d, 500, false)).toEqual([160, 40])
    expect(subfieldLengthsAt(d, -500, false)).toEqual([40, 160])
  })

  it('gir et felt som alt er under gulvet, sin egen lengde som gulv, så ingenting hopper', () => {
    const d = drag([1, 9], [10, 90], 0, 40)
    expect(d.floors).toEqual([10, 40])
    expect(subfieldLengthsAt(d, 0, false)).toEqual([10, 90])
  })

  it('skalerer med Shift de to blokkene mot hverandre og beholder proporsjonene inni dem', () => {
    const d = drag([1, 2, 1], [50, 100, 50], 1)
    const lengths = subfieldLengthsAt(d, -50, true)
    expect(lengths).not.toBeNull()
    const [a, b, c] = lengths as number[]
    expect(b / a).toBeCloseTo(2)
    expect(a + b).toBeCloseTo(100)
    expect(c).toBeCloseTo(100)
  })

  it('lagrer hele forholdstall 1–10 og lar feltene som ikke ble dratt, beholde forholdet sitt', () => {
    const d = drag([1, 1, 1], [100, 100, 100], 0)
    const shown = shownSubfieldWeights(d, [150, 50, 100], false, accept)
    expect(shown).not.toBeNull()
    expect(areRatiosQuantized(shown as number[])).toBe(true)
    expect(sameProportions(shown as number[], [3, 1, 2])).toBe(true)
  })

  it('lagrer ingenting når nærmeste trinn er inndelingen draget startet fra', () => {
    const d = drag([1, 1], [100, 100])
    expect(shownSubfieldWeights(d, [101, 99], false, accept)).toBeNull()
  })

  it('hopper over trinn kommandoen avviser og viser det nærmeste den godtar', () => {
    const d = drag([1, 1], [100, 100])
    const nearest = subfieldSnapCandidates(d, [140, 60], false)[0]
    const shown = shownSubfieldWeights(d, [140, 60], false, (weights) => !sameProportions(weights, nearest))
    expect(shown).not.toBeNull()
    expect(sameProportions(shown as number[], nearest)).toBe(false)
  })

  it('hopper over trinn som tar et felt under gulvet', () => {
    const d = drag([1, 1], [100, 100], 0, 30)
    const shown = shownSubfieldWeights(d, [170, 30], false, accept) as number[]
    const lengths = lengthsFor(d, shown)
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(30 - 1e-6)
  })

  it('holder blokkene i proporsjon også på trinnet et Shift-drag lagrer', () => {
    const d = drag([1, 2, 2], [40, 80, 80], 1)
    const released = subfieldLengthsAt(d, -40, true) as number[]
    const shown = shownSubfieldWeights(d, released, true, accept) as number[]
    expect(shown).not.toBeNull()
    expect(shown[1]).toBe(shown[0] * 2)
  })

  it('faller tilbake til vanlige trinn med Shift når forholdstallene ikke er hele tall', () => {
    const d = drag([1.5, 1, 1], [120, 80, 80], 1)
    const released = subfieldLengthsAt(d, -40, true) as number[]
    expect(subfieldSnapCandidates(d, released, true).length).toBeGreaterThan(0)
  })

  it('starter ikke for en strek som ikke finnes eller felt uten lengde', () => {
    expect(startSubfieldDrag({ boundary: 1, axis: 'y', weights: [1, 1], lengths: [50, 50], floor: 10 })).toBeNull()
    expect(startSubfieldDrag({ boundary: 0, axis: 'y', weights: [1, 1], lengths: [0, 50], floor: 10 })).toBeNull()
  })
})
