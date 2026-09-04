/**
 * Dragging a zone boundary, from the first pointer move to the commit.
 *
 * The two halves are tested for the two different promises they make: while the
 * pointer is down the boundary is free and only the two zones beside it move,
 * and once it is released the layout is a whole ratio — arrived at without
 * pulling apart zones that the gesture never touched.
 */

import { describe, expect, it } from 'vitest'
import { setSplitWeights, splitLeaf } from '../../domain/commands'
import type { StructuralOutcome } from '../../domain/commands'
import { estimateFitChecker } from '../../domain/fit'
import { computeSlideGeometry, minimumSizeFor } from '../../domain/geometry'
import { findSplit } from '../../domain/layout'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { createPresentation } from '../../domain/presentation'
import { areRatiosQuantized } from '../../domain/ratios'
import { err, ok, type Result } from '../../domain/result'
import type { Presentation } from '../../domain/types'
import { RATIO_SNAP_CANDIDATES, commitDraggedRatios, draggedWeights } from './ratioDrag'

/** A slide whose root is a split with the given ratios. */
function deckWithSplit(weights: number[]): { presentation: Presentation; nodeId: string; slideId: string } {
  const base = createPresentation({ title: 'Test' })
  const slide = base.slides[0]
  const result = splitLeaf(base, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights })
  if (!result.ok || !result.value) throw new Error('could not build the fixture')
  return { presentation: result.value.presentation, nodeId: slide.root.id, slideId: slide.id }
}

function ratiosOf(presentation: Presentation, slideId: string, nodeId: string): number[] {
  const slide = presentation.slides.find((entry) => entry.id === slideId)
  const split = slide ? findSplit(slide.root, nodeId) : null
  if (!split) throw new Error('the split disappeared')
  return split.weights
}

/**
 * Release a drag on a real split: the boundary is moved by `deltaWeight`, and
 * what comes back is what the commands actually stored.
 *
 * The minimum shares are the ones the stage computes — each zone's minimum size
 * expressed in weight units — so a delta that would push a zone under its
 * minimum is stopped here exactly as the handle stops, and the commit is asked
 * the same question the editor asks it.
 */
function dragAndRelease(before: number[], boundary: number, deltaWeight: number): number[] {
  const { presentation, slideId, nodeId } = deckWithSplit(before)
  const slide = presentation.slides[0]
  const rect = computeSlideGeometry(slide, geometryForTheme(presentation.theme)).rects.get(nodeId)
  const split = findSplit(slide.root, nodeId)
  if (!rect || !split) throw new Error('could not measure the split')
  const total = before.reduce((sum, weight) => sum + weight, 0)
  const usable = rect.width - themeMetrics(presentation.theme).gap * (before.length - 1)
  const minShare = split.children.map((child) => (minimumSizeFor(child).width / usable) * total)
  const released = draggedWeights(before, boundary, deltaWeight, minShare)
  if (!released) throw new Error('the drag collapsed a zone')
  const committed = commitDraggedRatios(before, boundary, released, (weights) =>
    setSplitWeights(presentation, {
      slideId,
      nodeId,
      weights,
      fits: estimateFitChecker,
    }),
  )
  if (!committed.ok || !committed.value) {
    throw new Error(`the commit was refused: ${JSON.stringify(committed)}`)
  }
  return ratiosOf(committed.value.presentation, slideId, nodeId)
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

describe('releasing a drag', () => {
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

describe('commitDraggedRatios', () => {
  const outcome = (weights: number[]): Result<StructuralOutcome> =>
    ok({ presentation: { weights } as unknown as Presentation, movedToSandbox: [], discarded: [] })

  it('takes the next-closest ratio when the nearest one is refused', () => {
    const tried: number[][] = []
    const result = commitDraggedRatios([1, 1], 0, [3.1, 0.9], (weights) => {
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
    const result = commitDraggedRatios([1, 1], 0, [3.1, 0.9], (weights) => {
      tried.push(weights)
      return err('ZONE_TOO_SMALL', `for liten: ${weights.join(':')}`)
    })
    expect(tried).toHaveLength(RATIO_SNAP_CANDIDATES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe(`for liten: ${tried[0].join(':')}`)
  })

  it('never offers the same layout twice', () => {
    const tried: number[][] = []
    commitDraggedRatios([1, 1, 1], 1, [1, 1.5, 0.5], (weights) => {
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
})
