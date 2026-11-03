import { describe, expect, it } from 'vitest'
import { containerWithDoc, createContainer, createNegativeSpace } from './content'
import { estimateFit } from './fit'
import { createLeaf, createSplit } from './layout'
import { minimumSizeFor } from './geometry'
import { createPresentation, withSlide } from './presentation'
import { paragraphDoc } from './richdoc'
import { FIT_SCALE_PRECISION, MIN_FIT_SCALE, fitScale, shortestFittingLength } from './softSize'
import { contentAt } from './testDecks'
import { rearrangeZones, setSplitWeights } from './commands'
import { airMeetings } from './negativeSpace'
import { rearrangeZonesByHand, setSplitWeightsByHand } from './commands/manualLayout'
import { estimateFitChecker } from './fit'
import { geometryForTheme } from './metrics'
import type { LayoutNode, ZoneContent } from './types'

const words = (count: number): ZoneContent =>
  containerWithDoc(paragraphDoc(Array.from({ length: count }, (_, at) => `ord${at % 7}`).join(' ')))

/** Fit at normal size, as the estimator answers it, for a box of `w × h`. */
const fitsBox = (content: ZoneContent) => (w: number, h: number) =>
  estimateFit(content, { x: 0, y: 0, width: w, height: h }).fits

describe('fitScale', () => {
  it('is 1 for content that fits, and for a zone of no size', () => {
    expect(fitScale(fitsBox(words(5)), 600, 300)).toBe(1)
    expect(fitScale(() => false, 0, 300)).toBe(1)
  })

  it('finds the largest scale at which the enlarged box fits, within its precision', () => {
    for (const count of [60, 200, 800, 4000]) {
      const content = words(count)
      const [w, h] = [300, 160]
      const scale = fitScale(fitsBox(content), w, h)
      expect(scale, `${count} words`).toBeLessThan(1)
      // Measured to fit at the scale it answers with…
      expect(fitsBox(content)(w / scale, h / scale), `${count} words`).toBe(true)
      // …and not much bigger than that would have fitted.
      const bigger = scale * (1 + FIT_SCALE_PRECISION * 2)
      expect(fitsBox(content)(w / bigger, h / bigger), `${count} words`).toBe(false)
    }
  })

  it('scales further down the more there is, with no floor of its own', () => {
    const scales = [100, 400, 1600, 6400].map((count) => fitScale(fitsBox(words(count)), 300, 160))
    for (let index = 1; index < scales.length; index += 1) expect(scales[index]).toBeLessThan(scales[index - 1])
    // A great deal of text in a small zone is drawn very small indeed, and drawn.
    expect(scales[scales.length - 1]).toBeLessThan(0.2)
  })

  it('reaches the same answer from any hint, and fewer measurements from a close one', () => {
    const content = words(300)
    let cold = 0
    const count = (counter: () => void) => (w: number, h: number) => {
      counter()
      return fitsBox(content)(w, h)
    }
    const answer = fitScale(count(() => (cold += 1)), 300, 160)
    for (const hint of [0.05, 0.3, 0.6, 0.99]) {
      const again = fitScale(fitsBox(content), 300, 160, hint)
      expect(Math.abs(again - answer) / answer).toBeLessThan(FIT_SCALE_PRECISION * 2)
    }
    let warm = 0
    fitScale(count(() => (warm += 1)), 300, 160, answer)
    expect(warm).toBeLessThan(cold)
  })

  it('ends for content no scale can show', () => {
    expect(fitScale(() => false, 300, 160)).toBe(MIN_FIT_SCALE)
  })
})

describe('shortestFittingLength', () => {
  const fitsAt = (content: ZoneContent) => (length: number) => fitsBox(content)(length, 300)

  it('answers the floor itself when the content fits there', () => {
    expect(shortestFittingLength(fitsAt(words(3)), 180, 800)).toBe(180)
  })

  it('finds the soft limit: fitting there, and not half a pixel short of it', () => {
    const content = words(120)
    const soft = shortestFittingLength(fitsAt(content), 180, 1500)
    expect(soft).not.toBeNull()
    if (soft === null) return
    expect(fitsAt(content)(soft)).toBe(true)
    expect(fitsAt(content)(soft - 1)).toBe(false)
  })

  it('answers null for content that does not fit even with all the room there is', () => {
    expect(shortestFittingLength(fitsAt(words(20000)), 180, 1500)).toBeNull()
  })
})

describe('hard and soft minimum through the commands', () => {
  /** A row of two containers, the left one with `count` words. */
  function row(count: number, weights = [1, 1]) {
    const base = createPresentation({ title: 'Grenser' })
    const slide = contentAt(base, 1)
    const left = createLeaf(words(count))
    const split = createSplit('x', weights, [left, createLeaf(createContainer())])
    const presentation = withSlide(base, { ...slide, root: split })
    return { presentation, slideId: slide.id, split, left }
  }
  const strict = (deck: ReturnType<typeof row>, weights: number[]) =>
    setSplitWeights(deck.presentation, { slideId: deck.slideId, nodeId: deck.split.id, weights, fits: estimateFitChecker })
  const byHand = (deck: ReturnType<typeof row>, weights: number[]) =>
    setSplitWeightsByHand(deck.presentation, { slideId: deck.slideId, nodeId: deck.split.id, weights })

  it('lets a hand take a zone below its soft minimum where the fit rule refuses', () => {
    const deck = row(90)
    expect(strict(deck, [1, 1]).ok).toBe(true)
    const refused = strict(deck, [1, 3])
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(byHand(deck, [1, 3]).ok).toBe(true)
  })

  it('never lets a hand below the hard minimum of what the zone holds', () => {
    const deck = row(90)
    // 1 : 10 leaves the text column a twelfth of the row: narrower than any
    // text column may be, whatever it says.
    const result = byHand(deck, [1, 10])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ZONE_TOO_SMALL')
  })

  it('holds a nested group to every child’s hard minimum plus the gaps between them', () => {
    const base = createPresentation({ title: 'Nøstet' })
    const slide = contentAt(base, 1)
    const inner = createSplit('x', [1, 1], [createLeaf(words(30)), createLeaf(words(30))])
    const root = createSplit('x', [1, 1], [inner, createLeaf(createContainer())])
    const presentation = withSlide(base, { ...slide, root })
    const options = geometryForTheme(presentation.theme)
    const hard = minimumSizeFor(inner, options).width
    // Two text columns and a gap: more than twice a single text column.
    expect(hard).toBeGreaterThan(2 * minimumSizeFor(createLeaf(words(1)), options).width)
    const tooSmall = setSplitWeightsByHand(presentation, { slideId: slide.id, nodeId: root.id, weights: [1, 4] })
    expect(tooSmall.ok).toBe(false)
    if (!tooSmall.ok) expect(tooSmall.error.code).toBe('ZONE_TOO_SMALL')
  })

  it('compresses into air by hand past the soft minimum, and stores the air merged', () => {
    const base = createPresentation({ title: 'Luft' })
    const slide = contentAt(base, 1)
    const a: LayoutNode = createLeaf(words(90))
    const root = createSplit('y', [1, 1], [a, createLeaf(createContainer())])
    const presentation = withSlide(base, { ...slide, root })
    const compressed = createSplit('y', [1, 1], [
      createSplit('x', [1, 2, 1], [createLeaf(createNegativeSpace()), a, createLeaf(createNegativeSpace())]),
      root.children[1],
    ])
    const input = { slideId: slide.id, nodeId: root.id, layout: { ...compressed, id: root.id } }
    const refused = rearrangeZones(presentation, { ...input, fits: estimateFitChecker })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('CONTENT_DOES_NOT_FIT')
    const stored = rearrangeZonesByHand(presentation, input)
    expect(stored.ok).toBe(true)
    if (stored.ok) expect(airMeetings(contentAt(stored.value.presentation, 1).root)).toBe(0)

  })
})
