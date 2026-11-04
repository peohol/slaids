/**
 * The magnet at a zone's soft limit, and the drags it is part of.
 *
 * The pure half first — the mapping of the pointer's travel onto the amount
 * the drag acts on — and then whole drags, done the way the stage does them:
 * a real slide, the drag's own amount-to-lengths function, soft limits learnt
 * with a fit checker (the estimator here, the DOM in the app), the step shown
 * chosen by the very command letting go runs, and that step stored.
 */

import { describe, expect, it } from 'vitest'
import { rearrangeZones, setSplitWeights } from '../../domain/commands'
import { rearrangeZonesByHand, setSplitWeightsByHand } from '../../domain/commands/manualLayout'
import { containerWithDoc, createContainer } from '../../domain/content'
import { FIT_TOLERANCE } from '../../domain/constants'
import { estimateFitChecker } from '../../domain/fit'
import { computeSlideGeometry, minimumSizeFor } from '../../domain/geometry'
import { createLeaf, createSplit, findSplit } from '../../domain/layout'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { createPresentation, withSlide } from '../../domain/presentation'
import { paragraphDoc } from '../../domain/richdoc'
import { contentAt } from '../../domain/testDecks'
import { fitContextFor, subtreeOverflow } from '../../domain/commands'
import type { LayoutNode, Presentation, Rect } from '../../domain/types'
import {
  isPastSoftLimit,
  learnSoftLimit,
  magneticAmount,
  softThresholds,
  type ChildSoftLimit,
  type SoftThreshold,
} from './softLimitDrag'
import {
  childRects,
  dragAmount,
  lengthsAt,
  shownFor,
  startZoneDrag,
  type ZoneDrag,
  type ZoneDragCommit,
  type ZoneDragStart,
} from './zoneGesture'

const R = 16

describe('magneticAmount', () => {
  const leave: SoftThreshold[] = [{ direction: -1, distance: 50, kind: 'leave' }]

  it('follows the hand up to a limit, holds there for the resistance, then follows it that far behind', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [-30, -30],
      [-50, -50],
      [-60, -50],
      [-66, -50],
      [-67, -51],
      [-100, -84],
      // The other direction has no limit at all.
      [40, 40],
    ]
    for (const [raw, expected] of cases) expect(magneticAmount(raw, leave, R), `${raw}`).toBeCloseTo(expected, 9)
  })

  it('never jumps across a limit it lets go of, and never goes back while the hand goes on', () => {
    let previous = magneticAmount(0, leave, R)
    for (let raw = -0.25; raw >= -200; raw -= 0.25) {
      const now = magneticAmount(raw, leave, R)
      expect(previous - now, `${raw}`).toBeGreaterThanOrEqual(-1e-9)
      expect(previous - now, `${raw}`).toBeLessThanOrEqual(0.25 + 1e-9)
      previous = now
    }
  })

  it('pulls a zone that starts below its limit up onto it as the hand comes near', () => {
    const enter: SoftThreshold[] = [{ direction: 1, distance: 40, kind: 'enter' }]
    expect(magneticAmount(20, enter, R)).toBe(20)
    expect(magneticAmount(24, enter, R)).toBe(40)
    expect(magneticAmount(39, enter, R)).toBe(40)
    expect(magneticAmount(41, enter, R)).toBe(41)
  })

  it('holds at every limit on the way, one after another', () => {
    const two: SoftThreshold[] = [
      { direction: 1, distance: 100, kind: 'leave' },
      { direction: 1, distance: 30, kind: 'leave' },
    ]
    expect(magneticAmount(40, two, R)).toBe(30)
    expect(magneticAmount(60, two, R)).toBe(44)
    expect(magneticAmount(120, two, R)).toBe(100)
    expect(magneticAmount(140, two, R)).toBe(108)
  })

  it('is a function of where the hand is, so a flick and a crawl end in the same place', () => {
    const crawl = Array.from({ length: 400 }, (_, step) => magneticAmount(-step * 0.5, leave, R))
    expect(crawl[crawl.length - 1]).toBe(magneticAmount(-199.5, leave, R))
  })
})

/* ------------------------------------------------------------------ *
 * Whole drags
 * ------------------------------------------------------------------ */

const words = (count: number): LayoutNode =>
  createLeaf(containerWithDoc(paragraphDoc(Array.from({ length: count }, (_, at) => `ord${at % 7}`).join(' '))))

interface Deck {
  presentation: Presentation
  slideId: string
}

function deckWith(root: LayoutNode): Deck {
  const base = createPresentation({ title: 'Magnet' })
  const slide = contentAt(base, 1)
  return { presentation: withSlide(base, { ...slide, root }), slideId: slide.id }
}

const rootOf = (deck: Deck): LayoutNode => contentAt(deck.presentation, 1).root
const rectsOf = (deck: Deck) =>
  computeSlideGeometry(contentAt(deck.presentation, 1), geometryForTheme(deck.presentation.theme)).rects

function begin(deck: Deck, start: ZoneDragStart): ZoneDrag {
  const options = geometryForTheme(deck.presentation.theme)
  const drag = startZoneDrag(
    {
      root: rootOf(deck),
      rects: rectsOf(deck),
      gap: themeMetrics(deck.presentation.theme).gap,
      minimumAlong: (node, axis) => (axis === 'x' ? minimumSizeFor(node, options).width : minimumSizeFor(node, options).height),
    },
    start,
  )
  if (!drag) throw new Error('no drag')
  return drag
}

/** A drag in progress, as the stage keeps it: limits learnt on the way. */
class Gesture {
  readonly limits = new Map<number, ChildSoftLimit>()
  private readonly startRects: Map<string, Rect>

  constructor(
    readonly deck: Deck,
    readonly drag: ZoneDrag,
  ) {
    this.startRects = childRects(drag, drag.span.lengths)
  }

  private fits(node: LayoutNode, rect: Rect): boolean {
    const overflow = subtreeOverflow(node, rect, fitContextFor(this.deck.presentation), { fits: estimateFitChecker })
    return [...overflow.values()].every((value) => value <= FIT_TOLERANCE)
  }

  /** The pointer `x`/`y` design pixels from the press: the step shown, and how it is stored. */
  at(x: number, y: number) {
    const { drag } = this
    const raw = dragAmount(drag, x, y)
    if (raw === null) throw new Error('no amount')
    const rawLengths = lengthsAt(drag, raw)
    if (!rawLengths) throw new Error('no lengths')
    const axis = drag.span.split.axis
    const room = axis === 'x' ? drag.rect.width : drag.rect.height
    drag.span.split.children.forEach((child, index) => {
      const start = drag.span.lengths[index]
      const rect = this.startRects.get(child.id)
      if (!rect || Math.abs(rawLengths[index] - start) < 1e-9) return
      this.limits.set(
        index,
        learnSoftLimit(this.limits.get(index), index, start, rawLengths[index], drag.span.floors[index], room, (length) =>
          this.fits(child, axis === 'x' ? { ...rect, width: length } : { ...rect, height: length }),
        ),
      )
    })
    const limits = [...this.limits.values()]
    const thresholds = softThresholds((amount) => lengthsAt(drag, amount), limits, room * 4)
    const amount = magneticAmount(raw, thresholds, R)
    const lengths = lengthsAt(drag, amount)
    if (!lengths) throw new Error('no lengths')
    const byHand = isPastSoftLimit(lengths, drag.span.lengths, limits)
    const view = shownFor(drag, lengths, (change) => commit(this.deck, change, byHand).ok)
    return { amount, lengths, byHand, view, thresholds }
  }

  /** Let go at `x`/`y`: exactly the step shown is stored. */
  release(x: number, y: number): Deck {
    const { view, byHand } = this.at(x, y)
    if (!view.commit) return this.deck
    const result = commit(this.deck, view.commit, byHand)
    if (!result.ok) throw new Error(result.error.code)
    return { ...this.deck, presentation: result.value.presentation }
  }
}

function commit(deck: Deck, change: ZoneDragCommit, byHand: boolean) {
  if (change.kind === 'ratios') {
    const input = { slideId: deck.slideId, nodeId: change.nodeId, weights: change.weights }
    return byHand ? setSplitWeightsByHand(deck.presentation, input) : setSplitWeights(deck.presentation, { ...input, fits: estimateFitChecker })
  }
  const input = { slideId: deck.slideId, nodeId: change.nodeId, layout: change.layout }
  return byHand ? rearrangeZonesByHand(deck.presentation, input) : rearrangeZones(deck.presentation, { ...input, fits: estimateFitChecker })
}

/** Whether every zone on the slide fits at normal size. */
function allFit(deck: Deck): boolean {
  const slide = contentAt(deck.presentation, 1)
  const geometry = computeSlideGeometry(slide, geometryForTheme(deck.presentation.theme))
  const overflow = subtreeOverflow(slide.root, geometry.mainRect, fitContextFor(deck.presentation), { fits: estimateFitChecker })
  return [...overflow.values()].every((value) => value <= FIT_TOLERANCE)
}

const widthOf = (deck: Deck, id: string) => rectsOf(deck).get(id)?.width ?? 0

describe('a divider drag against a zone full of text', () => {
  /** Text that fits half the row with a good margin and a third of it not at all. */
  function row() {
    const text = words(110)
    const deck = deckWith(createSplit('x', [1, 1], [text, createLeaf(createContainer())]))
    return { deck, text, splitId: rootOf(deck).id }
  }
  const divider = (splitId: string): ZoneDragStart => ({ kind: 'boundary', splitId, boundary: 0, shift: false })

  it('stops where the text stops fitting, and shows only steps where it fits', () => {
    const { deck, text, splitId } = row()
    const gesture = new Gesture(deck, begin(deck, divider(splitId)))
    const { thresholds } = gesture.at(-8, 0)
    const limit = thresholds.find((threshold) => threshold.kind === 'leave' && threshold.direction === -1)
    expect(limit).toBeDefined()
    if (!limit) return
    // Anywhere from the limit to the resistance past it, the zone is held on it.
    for (const past of [0, 4, 8, R - 0.5]) {
      const step = gesture.at(-(limit.distance + past), 0)
      expect(step.amount).toBeCloseTo(-limit.distance, 6)
      expect(step.byHand).toBe(false)
    }
    const held = gesture.release(-(limit.distance + R / 2), 0)
    expect(allFit(held)).toBe(true)
    expect(widthOf(held, text.id)).toBeLessThan(widthOf(deck, text.id))
  })

  it('lets the hand push past it, and stores a zone whose text does not fit at normal size', () => {
    const { deck, text, splitId } = row()
    const gesture = new Gesture(deck, begin(deck, divider(splitId)))
    const limit = gesture.at(-8, 0).thresholds.find((threshold) => threshold.kind === 'leave')
    if (!limit) throw new Error('no limit')
    const pushed = gesture.at(-(limit.distance + R + 120), 0)
    expect(pushed.byHand).toBe(true)
    const stored = gesture.release(-(limit.distance + R + 120), 0)
    expect(allFit(stored)).toBe(false)
    expect(widthOf(stored, text.id)).toBeLessThan(widthOf(deck, text.id))
  })

  it('stops at the hard minimum, however far the hand goes', () => {
    const { deck, text, splitId } = row()
    const gesture = new Gesture(deck, begin(deck, divider(splitId)))
    gesture.at(-8, 0)
    const stored = gesture.release(-3000, 0)
    const hard = minimumSizeFor(text, geometryForTheme(deck.presentation.theme)).width
    expect(widthOf(stored, text.id)).toBeGreaterThanOrEqual(hard - 1e-6)
    expect(widthOf(stored, text.id)).toBeLessThan(hard * 1.25)
  })

  it('pulls a zone left below its limit back up onto it as it is made bigger', () => {
    const { deck, text, splitId } = row()
    const first = new Gesture(deck, begin(deck, divider(splitId)))
    const limit = first.at(-8, 0).thresholds.find((threshold) => threshold.kind === 'leave')
    if (!limit) throw new Error('no limit')
    const small = first.release(-(limit.distance + R + 200), 0)
    expect(allFit(small)).toBe(false)

    const second = new Gesture(small, begin(small, divider(splitId)))
    const enter = second.at(8, 0).thresholds.find((threshold) => threshold.kind === 'enter')
    expect(enter?.direction).toBe(1)
    if (!enter) return
    // Within the resistance of the limit the zone is pulled onto it.
    const pulled = second.at(enter.distance - R / 2, 0)
    expect(pulled.amount).toBeCloseTo(enter.distance, 6)
    const repaired = second.release(enter.distance - R / 2, 0)
    expect(allFit(repaired)).toBe(true)
    expect(widthOf(repaired, text.id)).toBeGreaterThan(widthOf(small, text.id))
  })

  it('stores exactly the step it shows, past the limit as before it', () => {
    const { deck, splitId } = row()
    for (let amount = 10; amount <= 900; amount += 23) {
      const gesture = new Gesture(deck, begin(deck, divider(splitId)))
      gesture.at(-8, 0)
      const { view } = gesture.at(-amount, 0)
      const stored = gesture.release(-amount, 0)
      const split = findSplit(rootOf(stored), splitId)
      if (view.commit?.kind === 'ratios') expect(split?.weights, `${amount}`).toEqual(view.commit.weights)
      else expect(split?.weights, `${amount}`).toEqual([1, 1])
    }
  })
})

describe('a resize among siblings and a nested group', () => {
  it('holds every sibling’s soft limit, not only the zone dragged', () => {
    const [a, b, c] = [words(40), createLeaf(createContainer()), words(40)]
    const deck = deckWith(createSplit('x', [1, 1, 1], [a, b, c]))
    // Growing the empty middle zone shrinks both text zones by one factor:
    // they reach their limits together, and the drag holds there.
    const gesture = new Gesture(deck, begin(deck, { kind: 'zone', nodeId: b.id }))
    const first = gesture.at(0, -8)
    const leaving = first.thresholds.filter((threshold) => threshold.kind === 'leave')
    expect(leaving.length).toBeGreaterThan(0)
    const limit = Math.min(...leaving.map((threshold) => threshold.distance))
    const held = gesture.at(0, -(limit + R / 2))
    expect(Math.abs(held.amount)).toBeCloseTo(limit, 6)
    expect(held.byHand).toBe(false)
    const past = gesture.at(0, -(limit + R + 60))
    expect(past.byHand).toBe(true)
  })

  it('treats a nested group as one child whose limit is every zone inside it fitting', () => {
    const inner = createSplit('y', [1, 1], [words(40), words(40)])
    const deck = deckWith(createSplit('x', [1, 1], [inner, createLeaf(createContainer())]))
    const gesture = new Gesture(deck, begin(deck, { kind: 'boundary', splitId: rootOf(deck).id, boundary: 0, shift: false }))
    const limit = gesture.at(-8, 0).thresholds.find((threshold) => threshold.kind === 'leave')
    expect(limit).toBeDefined()
    if (!limit) return
    const before = gesture.release(-(limit.distance + R / 2), 0)
    expect(allFit(before)).toBe(true)
    const after = new Gesture(deck, begin(deck, { kind: 'boundary', splitId: rootOf(deck).id, boundary: 0, shift: false }))
    after.at(-8, 0)
    const pushed = after.release(-(limit.distance + R + 150), 0)
    expect(allFit(pushed)).toBe(false)
    // Still a group of two whole zones above their hard minimum.
    const hard = minimumSizeFor(inner, geometryForTheme(deck.presentation.theme)).width
    expect(widthOf(pushed, inner.id)).toBeGreaterThanOrEqual(hard - 1e-6)
  })
})

describe('isPastSoftLimit', () => {
  const limits: ChildSoftLimit[] = [
    { index: 0, fitsAtStart: true, soft: 300 },
    { index: 1, fitsAtStart: false, soft: 500 },
  ]
  it('is past when a fitting child goes below its limit, or one that did not fit gets smaller still', () => {
    expect(isPastSoftLimit([300, 400], [400, 400], limits)).toBe(false)
    expect(isPastSoftLimit([299, 400], [400, 400], limits)).toBe(true)
    expect(isPastSoftLimit([400, 450], [400, 400], limits)).toBe(false)
    expect(isPastSoftLimit([400, 390], [400, 400], limits)).toBe(true)
  })
})
