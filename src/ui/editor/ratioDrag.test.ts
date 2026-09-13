/**
 * Dragging zones, from the first pointer move to the commit.
 *
 * The halves are tested for the different promises they make. While the pointer
 * is down the arithmetic is exact — a boundary moves and only its two zones
 * change, a resize is symmetric to the last bit, a move leaves the zone's ratio
 * untouched — and every gesture stops where the layout stops being legal rather
 * than running past it and springing back. Once released the layout is a whole
 * ratio, arrived at without pulling apart zones the gesture never touched.
 *
 * The gesture tests go in through the same three steps the stage does: the
 * direction decides the operation, the operation produces a wish, and the wish
 * is committed by the real domain command against a real slide's geometry. So
 * "drag up" means the same thing here as it does under the pointer.
 */

import { describe, expect, it } from 'vitest'
import { setSplitWeights, setZoneContent, splitLeaf } from '../../domain/commands'
import type { StructuralOutcome } from '../../domain/commands'
import { estimateFitChecker } from '../../domain/fit'
import { computeSlideGeometry, minimumSizeFor, sumWeights } from '../../domain/geometry'
import { collectLeaves, findSplit } from '../../domain/layout'
import { createContainer } from '../../domain/content'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { createPresentation } from '../../domain/presentation'
import {
  areRatiosQuantized,
  equalityKeysForDrag,
  equalityKeysForZoneDrag,
} from '../../domain/ratios'
import { err, ok, type Result } from '../../domain/result'
import type { Axis, Presentation } from '../../domain/types'
import {
  RATIO_SNAP_CANDIDATES,
  ZONE_DRAG_THRESHOLD_PX,
  commitDraggedRatios,
  draggedWeights,
  keepsZoneSize,
  resizedWeights,
  translatedWeights,
  zoneDragAmount,
  zoneDragMode,
} from './ratioDrag'
import { contentAt } from '../../domain/testDecks'

/** Minimums small enough to stay out of the way of the arithmetic under test. */
const NO_LIMIT = (count: number): number[] => new Array<number>(count).fill(0.01)

/** Where the zone at `index` starts, in weight units. */
function startOf(weights: readonly number[], index: number): number {
  return sumWeights(weights.slice(0, index))
}

/** A slide whose root is a split with the given ratios. */
function deckWithSplit(
  weights: number[],
  axis: Axis,
): { presentation: Presentation; nodeId: string; slideId: string } {
  const base = createPresentation({ title: 'Test' })
  const slide = contentAt(base, 1)
  const result = splitLeaf(base, { slideId: slide.id, nodeId: slide.root.id, axis, weights })
  if (!result.ok || !result.value) throw new Error('could not build the fixture')
  /*
   * Every zone holds a text container.
   *
   * What these tests are about is where a gesture *stops*, and a zone only
   * stops a gesture if there is something in it that a smaller rectangle would
   * hide. Empty zones have no minimum at all — deliberately, so deliberate air
   * can be made as thin as the composition wants — so a fixture of empty zones
   * would be a fixture with no stop conditions to test.
   */
  let presentation = result.value.presentation
  for (const leaf of collectLeaves(contentAt(presentation, 1).root)) {
    const placed = setZoneContent(presentation, {
      slideId: slide.id,
      nodeId: leaf.id,
      content: createContainer(),
      fits: estimateFitChecker,
    })
    if (!placed.ok) throw new Error('could not fill the fixture')
    presentation = placed.value.presentation
  }
  return { presentation, nodeId: slide.root.id, slideId: slide.id }
}

function ratiosOf(presentation: Presentation, slideId: string, nodeId: string): number[] {
  const slide = presentation.slides.find((entry) => entry.id === slideId)
  const split = slide?.kind === 'content' ? findSplit(slide.root, nodeId) : null
  if (!split) throw new Error('the split disappeared')
  return split.weights
}

interface Fixture {
  presentation: Presentation
  slideId: string
  nodeId: string
  /** The length the zones share, in design-space pixels. */
  usable: number
  total: number
  /** Each zone's minimum size expressed in weight units, as the stage does it. */
  minShare: number[]
}

/**
 * A real split on a real slide, measured exactly the way the stage measures the
 * one under the pointer — so a gesture that is stopped here is stopped there.
 */
function fixture(weights: number[], axis: Axis): Fixture {
  const { presentation, slideId, nodeId } = deckWithSplit(weights, axis)
  const slide = contentAt(presentation, 1)
  const rect = computeSlideGeometry(slide, geometryForTheme(presentation.theme)).rects.get(nodeId)
  const split = findSplit(slide.root, nodeId)
  if (!rect || !split) throw new Error('could not measure the split')
  const total = sumWeights(weights)
  const along = axis === 'x' ? rect.width : rect.height
  const usable = along - themeMetrics(presentation.theme).gap * (weights.length - 1)
  const minShare = split.children.map((child) => {
    const min = minimumSizeFor(child, geometryForTheme(presentation.theme))
    return ((axis === 'x' ? min.width : min.height) / usable) * total
  })
  return { presentation, slideId, nodeId, usable, total, minShare }
}

/** Release a gesture onto the real command and report what it stored. */
function release(
  fx: Fixture,
  equalityKeys: readonly (number | string | null)[],
  released: readonly number[] | null,
  prefer?: (weights: readonly number[]) => boolean,
): number[] {
  if (!released) throw new Error('the gesture produced no layout')
  const committed = commitDraggedRatios(
    equalityKeys,
    released,
    (weights) =>
      setSplitWeights(fx.presentation, {
        slideId: fx.slideId,
        nodeId: fx.nodeId,
        weights,
        fits: estimateFitChecker,
      }),
    prefer,
  )
  if (!committed.ok || !committed.value) {
    throw new Error(`the commit was refused: ${JSON.stringify(committed)}`)
  }
  return ratiosOf(committed.value.presentation, fx.slideId, fx.nodeId)
}

/**
 * Release a boundary drag on a real split: the boundary is moved by
 * `deltaWeight`, and what comes back is what the commands actually stored.
 */
function dragAndRelease(before: number[], boundary: number, deltaWeight: number): number[] {
  const fx = fixture(before, 'x')
  const released = draggedWeights(before, boundary, deltaWeight, fx.minShare)
  return release(fx, equalityKeysForDrag(before, boundary), released)
}

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const

type Direction = keyof typeof DIRECTIONS

/**
 * A whole drag that started inside a zone: `amount` is how far the hand went,
 * given in weight units so the fixture can turn it into the pixels a pointer
 * would have travelled.
 */
function zoneDragAndRelease(
  before: number[],
  axis: Axis,
  index: number,
  direction: Direction,
  amount: number,
): number[] {
  const fx = fixture(before, axis)
  const distance = (amount / fx.total) * fx.usable
  const deltaX = DIRECTIONS[direction].x * distance
  const deltaY = DIRECTIONS[direction].y * distance
  const mode = zoneDragMode(axis, deltaX, deltaY)
  if (!mode) throw new Error('the movement was too small to mean anything')
  const asked = (zoneDragAmount(axis, mode, deltaX, deltaY) / fx.usable) * fx.total
  const released =
    mode === 'resize'
      ? resizedWeights(before, index, asked, fx.minShare)
      : translatedWeights(before, index, asked, fx.minShare)
  return release(
    fx,
    equalityKeysForZoneDrag(before, index),
    released,
    // The same preference the stage applies: a move keeps the zone's size.
    mode === 'translate' ? keepsZoneSize(before, index) : undefined,
  )
}

/** What share of the split a zone holds, so layouts written at different totals compare. */
function shares(weights: readonly number[]): number[] {
  const total = sumWeights(weights)
  return weights.map((weight) => weight / total)
}

describe('draggedWeights', () => {
  it('moves only the pair beside the boundary and keeps the total', () => {
    const moved = draggedWeights([2, 5, 3, 3, 3], 0, 1.4, [0.2, 0.2, 0.2, 0.2, 0.2])
    expect(moved).not.toBeNull()
    expect(moved?.slice(2)).toEqual([3, 3, 3])
    expect(moved?.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(16, 10)
    expect(moved?.[0]).toBeCloseTo(3.4, 10)
    expect(moved?.[1]).toBeCloseTo(3.6, 10)
  })

  it('stops at the minimum share instead of running past it', () => {
    const moved = draggedWeights([2, 2], 0, 10, [0.5, 0.5])
    expect(moved).toEqual([3.5, 0.5])
  })

  it('refuses a move that would leave nothing on one side', () => {
    expect(draggedWeights([1, 1], 0, 5, [0, 0])).toBeNull()
    expect(draggedWeights([1, 1], 0, Number.NaN, [0.1, 0.1])).toBeNull()
  })
})

describe('zoneDragMode', () => {
  it('says nothing at all until the movement is big enough to mean something', () => {
    const small = ZONE_DRAG_THRESHOLD_PX - 1
    expect(zoneDragMode('x', small, -small)).toBeNull()
    expect(zoneDragMode('y', -small, small)).toBeNull()
    expect(zoneDragMode('x', 0, -ZONE_DRAG_THRESHOLD_PX)).toBe('resize')
  })

  it('reads a row: across it resizes, along it moves', () => {
    expect(zoneDragMode('x', 4, -40)).toBe('resize')
    expect(zoneDragMode('x', 4, 40)).toBe('resize')
    expect(zoneDragMode('x', -40, 4)).toBe('translate')
    expect(zoneDragMode('x', 40, 4)).toBe('translate')
  })

  it('reads a column as the same gesture turned a quarter of a turn', () => {
    expect(zoneDragMode('y', 40, 4)).toBe('resize')
    expect(zoneDragMode('y', -40, 4)).toBe('resize')
    expect(zoneDragMode('y', 4, -40)).toBe('translate')
    expect(zoneDragMode('y', 4, 40)).toBe('translate')
  })

  it('reads an exact diagonal as the gesture that leaves the size alone', () => {
    expect(zoneDragMode('x', 40, 40)).toBe('translate')
    expect(zoneDragMode('y', 40, 40)).toBe('translate')
  })

  it('refuses to decide on a movement that is not a number', () => {
    expect(zoneDragMode('x', Number.NaN, 40)).toBeNull()
  })
})

describe('zoneDragAmount', () => {
  it('grows a row upwards and a column rightwards', () => {
    expect(zoneDragAmount('x', 'resize', 0, -30)).toBe(30)
    expect(zoneDragAmount('x', 'resize', 0, 30)).toBe(-30)
    expect(zoneDragAmount('y', 'resize', 30, 0)).toBe(30)
    expect(zoneDragAmount('y', 'resize', -30, 0)).toBe(-30)
  })

  it('moves a zone with the hand, along whichever axis its split runs', () => {
    expect(zoneDragAmount('x', 'translate', 30, 0)).toBe(30)
    expect(zoneDragAmount('x', 'translate', -30, 0)).toBe(-30)
    expect(zoneDragAmount('y', 'translate', 0, 30)).toBe(30)
    expect(zoneDragAmount('y', 'translate', 0, -30)).toBe(-30)
  })
})

describe('resizedWeights', () => {
  it('moves both of the zone’s boundaries by the same amount, in opposite directions', () => {
    const before = [1, 2, 3, 4]
    const after = resizedWeights(before, 2, 2, NO_LIMIT(4))
    expect(after).not.toBeNull()
    if (!after) return
    const startMoved = startOf(before, 2) - startOf(after, 2)
    const endMoved = startOf(after, 3) - startOf(before, 3)
    expect(startMoved).toBeCloseTo(1, 10)
    expect(endMoved).toBeCloseTo(1, 10)
    expect(after[2]).toBeCloseTo(5, 10)
    expect(sumWeights(after)).toBeCloseTo(sumWeights(before), 10)
  })

  it('leaves the zone where it was: this is resizing, not moving', () => {
    const before = [1, 2, 3, 1]
    const centre = (weights: readonly number[]): number =>
      (startOf(weights, 2) + startOf(weights, 3)) / 2 / sumWeights(weights)
    for (const growth of [-1, -0.25, 0.25, 1, 2]) {
      const after = resizedWeights(before, 2, growth, NO_LIMIT(4))
      expect(after).not.toBeNull()
      if (after) expect(centre(after)).toBeCloseTo(centre(before), 10)
    }
  })

  it('keeps every other zone’s share of its own side', () => {
    const before = [1, 2, 3, 1, 4]
    const after = resizedWeights(before, 2, 1.5, NO_LIMIT(5))
    expect(after).not.toBeNull()
    if (!after) return
    expect(after[0] / after[1]).toBeCloseTo(before[0] / before[1], 10)
    expect(after[3] / after[4]).toBeCloseTo(before[3] / before[4], 10)
  })

  it('gives the sides room back when the zone shrinks', () => {
    const before = [2, 4, 2]
    const after = resizedWeights(before, 1, -2, NO_LIMIT(3))
    expect(after).not.toBeNull()
    if (!after) return
    expect(after[1]).toBeCloseTo(2, 10)
    expect(after[0]).toBeCloseTo(3, 10)
    expect(after[2]).toBeCloseTo(3, 10)
  })

  it('stops at the largest symmetric change rather than carrying on into one side', () => {
    // The right zone can give up 1 and the left 3, so the whole gesture stops
    // once the right one is spent — and stays symmetric doing it.
    const before = [4, 2, 2]
    const minShare = [1, 1, 1]
    const stopped = resizedWeights(before, 1, 100, minShare)
    expect(stopped).not.toBeNull()
    if (!stopped) return
    expect(stopped).toEqual(resizedWeights(before, 1, 2, minShare))
    expect(stopped[0]).toBeCloseTo(3, 10)
    expect(stopped[1]).toBeCloseTo(4, 10)
    expect(stopped[2]).toBeCloseTo(1, 10)
    expect(startOf(before, 1) - startOf(stopped, 1)).toBeCloseTo(
      startOf(stopped, 2) - startOf(before, 2),
      10,
    )
  })

  it('stops at the zone’s own minimum when it is the one shrinking', () => {
    const before = [2, 4, 2]
    const minShare = [0.5, 1.5, 0.5]
    const stopped = resizedWeights(before, 1, -100, minShare)
    expect(stopped?.[1]).toBeCloseTo(1.5, 10)
    expect(stopped).toEqual(resizedWeights(before, 1, -2.5, minShare))
  })

  it('gives the whole change to the one side a zone at the end of the split has', () => {
    // Nothing to be symmetric about: the outer edge is the split's own.
    const grown = resizedWeights([1, 2, 3], 0, 2, NO_LIMIT(3))
    expect(grown).not.toBeNull()
    if (!grown) return
    expect(grown[0]).toBeCloseTo(3, 10)
    expect(grown[1] / grown[2]).toBeCloseTo(2 / 3, 10)
    expect(sumWeights(grown)).toBeCloseTo(6, 10)

    const shrunk = resizedWeights([1, 2, 3], 2, -1, NO_LIMIT(3))
    expect(shrunk?.[2]).toBeCloseTo(2, 10)
    expect(shrunk?.[0]).toBeCloseTo(4 / 3, 10)
    expect(shrunk?.[1]).toBeCloseTo(8 / 3, 10)

    // A split in two is two end zones, and both of them resize.
    expect(resizedWeights([1, 1], 0, 0.5, NO_LIMIT(2))).toEqual([1.5, 0.5])
    expect(resizedWeights([1, 1], 1, 0.5, NO_LIMIT(2))).toEqual([0.5, 1.5])
  })

  it('stops an end zone at its one side’s minimum', () => {
    const before = [2, 4]
    const minShare = [1, 1]
    const stopped = resizedWeights(before, 0, 100, minShare)
    expect(stopped).toEqual([5, 1])
    expect(stopped).toEqual(resizedWeights(before, 0, 3, minShare))
  })

  it('refuses a movement that is not a number', () => {
    expect(resizedWeights([1, 2, 1], 1, Number.NaN, NO_LIMIT(3))).toBeNull()
  })
})

describe('translatedWeights', () => {
  it('slides the zone along without changing its size', () => {
    const before = [2, 3, 4]
    const after = translatedWeights(before, 1, 1, NO_LIMIT(3))
    expect(after).not.toBeNull()
    if (!after) return
    expect(after[1]).toBe(before[1])
    expect(after[0]).toBeCloseTo(3, 10)
    expect(after[2]).toBeCloseTo(3, 10)
    expect(startOf(after, 1) - startOf(before, 1)).toBeCloseTo(1, 10)
    expect(sumWeights(after)).toBeCloseTo(sumWeights(before), 10)
  })

  it('compresses the side it moves towards and expands the other', () => {
    const before = [2, 3, 4]
    const forwards = translatedWeights(before, 1, 1, NO_LIMIT(3))
    const backwards = translatedWeights(before, 1, -1, NO_LIMIT(3))
    expect(forwards?.[0]).toBeGreaterThan(before[0])
    expect(forwards?.[2]).toBeLessThan(before[2])
    expect(backwards?.[0]).toBeLessThan(before[0])
    expect(backwards?.[2]).toBeGreaterThan(before[2])
    expect(backwards?.[1]).toBe(before[1])
  })

  it('keeps both sides’ internal ratios, compressed and expanded alike', () => {
    const before = [1, 2, 5, 3, 6]
    const after = translatedWeights(before, 2, -1.5, NO_LIMIT(5))
    expect(after).not.toBeNull()
    if (!after) return
    expect(after[0] / after[1]).toBeCloseTo(before[0] / before[1], 10)
    expect(after[3] / after[4]).toBeCloseTo(before[3] / before[4], 10)
    expect(after[2]).toBe(before[2])
  })

  it('stops when the side it is compressing has nothing left to give', () => {
    const before = [3, 2, 3]
    const minShare = [1, 1, 1]
    const stopped = translatedWeights(before, 1, 100, minShare)
    expect(stopped).not.toBeNull()
    if (!stopped) return
    expect(stopped).toEqual(translatedWeights(before, 1, 2, minShare))
    expect(stopped[2]).toBeCloseTo(1, 10)
    expect(stopped[0]).toBeCloseTo(5, 10)
    expect(stopped[1]).toBe(before[1])
  })

  it('cannot move a zone the split’s own edge is holding in place', () => {
    const before = [1, 2, 3]
    expect(translatedWeights(before, 0, 1, NO_LIMIT(3))).toEqual(before)
    expect(translatedWeights(before, 2, -1, NO_LIMIT(3))).toEqual(before)
    expect(translatedWeights([1, 1], 0, 0.5, NO_LIMIT(2))).toEqual([1, 1])
  })

  it('refuses a movement that is not a number', () => {
    expect(translatedWeights([1, 2, 1], 1, Number.NaN, NO_LIMIT(3))).toBeNull()
  })
})

describe('a gesture never drifts', () => {
  it('answers from the ratios it started with, however the pointer got there', () => {
    const before = [2, 3, 4, 1]
    const minShare = NO_LIMIT(4)
    // Every frame of a drag is computed from the same starting ratios, so a
    // pointer that wanders and comes back lands exactly where it left.
    const direct = resizedWeights(before, 1, 0.75, minShare)
    for (const detour of [-2, 0.1, 3, -0.4]) {
      resizedWeights(before, 1, detour, minShare)
      expect(resizedWeights(before, 1, 0.75, minShare)).toEqual(direct)
    }
    const moved = translatedWeights(before, 2, -1.25, minShare)
    for (const detour of [2, -0.3, 1.9]) {
      translatedWeights(before, 2, detour, minShare)
      expect(translatedWeights(before, 2, -1.25, minShare)).toEqual(moved)
    }
  })

  it('keeps the split’s total whole, wherever the pointer stops', () => {
    const before = [3, 5, 2, 4]
    for (const amount of [-1.7, -0.3, 0.05, 1.1, 2.9]) {
      expect(sumWeights(resizedWeights(before, 1, amount, NO_LIMIT(4)) ?? [])).toBeCloseTo(14, 10)
      expect(sumWeights(translatedWeights(before, 2, amount, NO_LIMIT(4)) ?? [])).toBeCloseTo(14, 10)
    }
  })
})

describe('releasing a boundary drag', () => {
  it('snaps to a whole ratio', () => {
    expect(dragAndRelease([1, 1], 0, 0.5)).toEqual([3, 1])
    expect(dragAndRelease([1, 1], 0, 0.25)).toEqual([5, 3])
    expect(dragAndRelease([1, 3], 0, 1)).toEqual([1, 1])
  })

  it('leaves the ratios alone when the pointer barely moved', () => {
    expect(dragAndRelease([2, 3], 0, 0.001)).toEqual([2, 3])
  })

  it('keeps untouched zones that shared a ratio sharing one', () => {
    const committed = dragAndRelease([3, 5, 4, 4, 4], 0, 1.4)
    expect(committed[2]).toBe(committed[3])
    expect(committed[3]).toBe(committed[4])
    expect(areRatiosQuantized(committed)).toBe(true)
  })

  it('lets the dragged boundary break an equality it was pointed at', () => {
    const committed = dragAndRelease([2, 2, 5], 0, 0.5)
    expect(committed[0]).not.toBe(committed[1])
    expect(areRatiosQuantized(committed)).toBe(true)
  })

  it('is deterministic, and always commits whole ratios in range', () => {
    for (const delta of [-1.5, -0.4, -0.05, 0.05, 0.4, 1.5, 3]) {
      const committed = dragAndRelease([3, 5, 4, 4, 4], 1, delta)
      expect(areRatiosQuantized(committed)).toBe(true)
      expect(committed[3]).toBe(committed[4])
      expect(dragAndRelease([3, 5, 4, 4, 4], 1, delta)).toEqual(committed)
    }
  })
})

describe('releasing a drag inside a zone', () => {
  it('grows the zone dragged up in a row, and shrinks the one dragged down', () => {
    expect(zoneDragAndRelease([3, 2, 3], 'x', 1, 'up', 2)).toEqual([1, 2, 1])

    const smaller = zoneDragAndRelease([2, 4, 2], 'x', 1, 'down', 2)
    expect(shares(smaller)[1]).toBeLessThan(shares([2, 4, 2])[1])
    expect(smaller[0]).toBe(smaller[2])
    expect(areRatiosQuantized(smaller)).toBe(true)
  })

  it('grows the zone dragged right in a column, and shrinks the one dragged left', () => {
    expect(zoneDragAndRelease([3, 2, 3], 'y', 1, 'right', 2)).toEqual([1, 2, 1])

    const smaller = zoneDragAndRelease([2, 4, 2], 'y', 1, 'left', 2)
    expect(shares(smaller)[1]).toBeLessThan(shares([2, 4, 2])[1])
    expect(smaller[0]).toBe(smaller[2])
    expect(areRatiosQuantized(smaller)).toBe(true)
  })

  it('moves the zone along its row without resizing it', () => {
    expect(zoneDragAndRelease([2, 3, 3], 'x', 1, 'right', 1)).toEqual([3, 3, 2])
    expect(zoneDragAndRelease([3, 3, 2], 'x', 1, 'left', 1)).toEqual([2, 3, 3])
  })

  it('moves the zone along its column without resizing it', () => {
    expect(zoneDragAndRelease([2, 3, 3], 'y', 1, 'down', 1)).toEqual([3, 3, 2])
    expect(zoneDragAndRelease([3, 3, 2], 'y', 1, 'up', 1)).toEqual([2, 3, 3])
  })

  it('keeps the moved zone’s own share of the split', () => {
    const before = [2, 2, 2, 2, 2]
    for (const direction of ['left', 'right'] as const) {
      const committed = zoneDragAndRelease(before, 'x', 2, direction, 1)
      expect(shares(committed)[2]).toBeCloseTo(shares(before)[2], 10)
      expect(committed[0]).toBe(committed[1])
      expect(committed[3]).toBe(committed[4])
      expect(areRatiosQuantized(committed)).toBe(true)
    }
  })

  it('keeps the moved zone exactly the size it was, snapped and all', () => {
    // Closeness alone would trade a few per cent off the moved zone for a
    // better fit elsewhere — 3 : 2 : 3 nudged right lands on 9 : 5 : 5, where
    // the middle has quietly grown from a quarter of the split to 5/19.
    const cases = [
      { before: [3, 2, 3], index: 1, direction: 'right' as const, amount: 0.85 },
      { before: [3, 2, 3], index: 1, direction: 'left' as const, amount: 0.85 },
      { before: [2, 3, 4, 3], index: 2, direction: 'right' as const, amount: 0.7 },
      { before: [4, 3, 2, 3], index: 1, direction: 'left' as const, amount: 0.4 },
    ]
    for (const { before, index, direction, amount } of cases) {
      const committed = zoneDragAndRelease(before, 'x', index, direction, amount)
      expect(shares(committed)[index]).toBeCloseTo(shares(before)[index], 12)
      expect(areRatiosQuantized(committed)).toBe(true)
      expect(committed).not.toEqual(before)
    }
  })

  it('keeps zones on the same side that shared a ratio sharing one', () => {
    const committed = zoneDragAndRelease([2, 2, 3, 2, 2], 'x', 2, 'up', 1)
    expect(committed[0]).toBe(committed[1])
    expect(committed[3]).toBe(committed[4])
    expect(shares(committed)[2]).toBeGreaterThan(shares([2, 2, 3, 2, 2])[2])
    expect(areRatiosQuantized(committed)).toBe(true)
  })

  it('stops at the largest change the split allows instead of refusing the drag', () => {
    const before = [3, 2, 3]
    const stopped = zoneDragAndRelease(before, 'x', 1, 'up', 100)
    expect(areRatiosQuantized(stopped)).toBe(true)
    expect(stopped[0]).toBe(stopped[2])
    expect(shares(stopped)[1]).toBeGreaterThan(shares(before)[1])
    // Far past the limit is the same layout as far enough: the gesture stops.
    expect(zoneDragAndRelease(before, 'x', 1, 'up', 1000)).toEqual(stopped)
  })

  it('resizes a zone at the end of its split into its one neighbour', () => {
    // Its outer edge cannot move, so the whole change lands on the inner one:
    // 2 : 3 : 3 grown by two whole units is 4 : 2 : 2, written 2 : 1 : 1.
    expect(zoneDragAndRelease([2, 3, 3], 'x', 0, 'up', 2)).toEqual([2, 1, 1])

    const smaller = zoneDragAndRelease([4, 3, 3], 'x', 0, 'down', 1)
    expect(shares(smaller)[0]).toBeLessThan(shares([4, 3, 3])[0])
    expect(smaller[1]).toBe(smaller[2])
    // A split in two is two end zones, and both of them resize.
    expect(zoneDragAndRelease([1, 1], 'x', 0, 'up', 0.5)).toEqual([3, 1])
    expect(zoneDragAndRelease([1, 1], 'x', 1, 'up', 0.5)).toEqual([1, 3])
    expect(zoneDragAndRelease([1, 1], 'y', 0, 'right', 0.5)).toEqual([3, 1])
  })

  it('cannot move a zone the split’s own edge is holding in place', () => {
    for (const direction of ['left', 'right'] as const) {
      expect(zoneDragAndRelease([2, 3, 3], 'x', 0, direction, 1)).toEqual([2, 3, 3])
      expect(zoneDragAndRelease([2, 3, 3], 'x', 2, direction, 1)).toEqual([2, 3, 3])
      expect(zoneDragAndRelease([1, 1], 'x', 0, direction, 0.4)).toEqual([1, 1])
    }
    for (const direction of ['up', 'down'] as const) {
      expect(zoneDragAndRelease([2, 3, 3], 'y', 0, direction, 1)).toEqual([2, 3, 3])
      expect(zoneDragAndRelease([2, 3, 3], 'y', 2, direction, 1)).toEqual([2, 3, 3])
    }
  })

  it('is deterministic, and always commits whole ratios in range', () => {
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      for (const amount of [0.2, 0.9, 1.7]) {
        const committed = zoneDragAndRelease([2, 3, 4, 3], 'x', 1, direction, amount)
        expect(areRatiosQuantized(committed)).toBe(true)
        expect(zoneDragAndRelease([2, 3, 4, 3], 'x', 1, direction, amount)).toEqual(committed)
      }
    }
  })
})

describe('commitDraggedRatios', () => {
  const outcome = (weights: number[]): Result<StructuralOutcome> =>
    ok({ presentation: { weights } as unknown as Presentation, movedToSandbox: [], discarded: [] })

  it('takes the next-closest ratio when the nearest one is refused', () => {
    const tried: number[][] = []
    const result = commitDraggedRatios(equalityKeysForDrag([1, 1], 0), [3.1, 0.9], (weights) => {
      tried.push(weights)
      return tried.length === 1
        ? err('ZONE_TOO_SMALL', 'Sonen blir for liten.')
        : outcome(weights)
    })
    expect(result.ok).toBe(true)
    expect(tried).toHaveLength(2)
    expect(tried[0]).not.toEqual(tried[1])
    for (const weights of tried) expect(areRatiosQuantized(weights)).toBe(true)
  })

  it('reports the nearest ratio’s refusal when every one of them is refused', () => {
    const tried: number[][] = []
    const result = commitDraggedRatios(equalityKeysForDrag([1, 1], 0), [3.1, 0.9], (weights) => {
      tried.push(weights)
      return err('ZONE_TOO_SMALL', `for liten: ${weights.join(':')}`)
    })
    expect(tried).toHaveLength(RATIO_SNAP_CANDIDATES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe(`for liten: ${tried[0].join(':')}`)
  })

  it('never offers the same layout twice', () => {
    const tried: number[][] = []
    commitDraggedRatios(equalityKeysForDrag([1, 1, 1], 1), [1, 1.5, 0.5], (weights) => {
      tried.push(weights)
      return err('ZONE_TOO_SMALL', 'nei')
    })
    const shapes = new Set(
      tried.map((weights) => {
        const total = weights.reduce((sum, weight) => sum + weight, 0)
        return weights.map((weight) => weight / total).join(':')
      }),
    )
    expect(shapes.size).toBe(tried.length)
  })

  it('holds a zone drag’s sides apart while keeping each side together', () => {
    const before = [4, 4, 3, 4, 4]
    const tried: number[][] = []
    // The gesture took twice as much from the near side as from the far one.
    commitDraggedRatios(equalityKeysForZoneDrag(before, 2), [2, 2, 8, 4, 4], (weights) => {
      tried.push(weights)
      return err('ZONE_TOO_SMALL', 'nei')
    })
    expect(tried.length).toBeGreaterThan(1)
    for (const weights of tried) {
      // Zones that shared a ratio on the same side still share one …
      expect(weights[0]).toBe(weights[1])
      expect(weights[3]).toBe(weights[4])
    }
    // … while the two sides, scaled by different factors, are free to part.
    expect(tried[0][0]).not.toBe(tried[0][3])
  })
})
