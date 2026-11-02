/**
 * Zone drags that create, reuse and remove negative space.
 *
 * Every test goes in the way the stage does: a press decides where the drag
 * starts, pointer movement (in design-space pixels) produces live lengths, and
 * the release is committed by the real domain command against a real slide's
 * geometry. What is checked is the live layout under the pointer — that it is
 * continuous and reversible — and the structure the slide ends up with.
 */

import { describe, expect, it } from 'vitest'
import { rearrangeZones, setSplitWeights } from '../../domain/commands'
import { createContainer, createNegativeSpace } from '../../domain/content'
import { estimateFitChecker } from '../../domain/fit'
import { computeLayoutRects, computeSlideGeometry, minimumSizeFor } from '../../domain/geometry'
import { createLeaf, createSplit, findNode, replaceNode, validateTree } from '../../domain/layout'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { isNegativeSpace } from '../../domain/negativeSpace'
import { createPresentation, withSlide } from '../../domain/presentation'
import { contentAt } from '../../domain/testDecks'
import type { LayoutNode, Presentation, Rect, SplitNode } from '../../domain/types'
import { commitDraggedRatios } from './ratioDrag'
import {
  commitArrangement,
  liveLengths,
  previewFor,
  releaseOf,
  sameLayout,
  startZoneDrag,
  type ZoneDrag,
  type ZoneDragStart,
} from './zoneGesture'

const text = (): LayoutNode => createLeaf(createContainer())
const air = (): LayoutNode => createLeaf(createNegativeSpace())

interface Deck {
  presentation: Presentation
  slideId: string
}

function deckWith(root: LayoutNode): Deck {
  const base = createPresentation({ title: 'Luft' })
  const slide = contentAt(base, 1)
  return { presentation: withSlide(base, { ...slide, root }), slideId: slide.id }
}

const rootOf = (deck: Deck): LayoutNode => contentAt(deck.presentation, 1).root

function geometryOf(deck: Deck, root: LayoutNode = rootOf(deck)): Map<string, Rect> {
  const slide = { ...contentAt(deck.presentation, 1), root }
  return computeSlideGeometry(slide, geometryForTheme(deck.presentation.theme)).rects
}

const gapOf = (deck: Deck): number => themeMetrics(deck.presentation.theme).gap

function begin(deck: Deck, start: ZoneDragStart): ZoneDrag {
  const options = geometryForTheme(deck.presentation.theme)
  const drag = startZoneDrag(
    {
      root: rootOf(deck),
      rects: geometryOf(deck),
      gap: gapOf(deck),
      minimumAlong: (node, axis) => {
        const min = minimumSizeFor(node, options)
        return axis === 'x' ? min.width : min.height
      },
    },
    start,
  )
  if (!drag) throw new Error('the drag did not start')
  return drag
}

/** The slide as it is drawn mid-drag, and the rect of every node in it. */
function live(deck: Deck, drag: ZoneDrag, lengths: readonly number[]): Map<string, Rect> {
  const preview = previewFor(drag, lengths)
  return geometryOf(deck, replaceNode(rootOf(deck), preview.nodeId, preview.node))
}

/** Release the drag at `lengths` and commit it as the stage would. */
function release(deck: Deck, drag: ZoneDrag, lengths: readonly number[]): Deck {
  const released = releaseOf(drag, lengths)
  if (!released) throw new Error('nothing to release')
  const fits = { fits: estimateFitChecker }
  if (released.kind === 'ratios') {
    const result = commitDraggedRatios(
      released.rules.equalityKeys,
      released.released,
      (weights) =>
        setSplitWeights(deck.presentation, { slideId: deck.slideId, nodeId: released.nodeId, weights, ...fits }),
      released.rules.preference,
    )
    if (!result.ok) throw new Error(`refused: ${result.error.message}`)
    return { ...deck, presentation: result.value.presentation }
  }
  if (released.candidates.length === 0 || sameLayout(released.candidates[0], released.original)) {
    return deck
  }
  const result = commitArrangement(released.candidates, (layout) =>
    rearrangeZones(deck.presentation, { slideId: deck.slideId, nodeId: released.nodeId, layout, ...fits }),
  )
  if (!result.ok) throw new Error(`refused: ${result.error.message}`)
  return { ...deck, presentation: result.value.presentation }
}

/** A drag from press to release, `x`/`y` design-space pixels away. */
function drag(deck: Deck, start: ZoneDragStart, x: number, y: number): Deck {
  const gesture = begin(deck, start)
  const lengths = liveLengths(gesture, x, y)
  if (!lengths) throw new Error('the movement meant nothing')
  return release(deck, gesture, lengths)
}

/** The split with `id`, which the test says is one. */
function splitAt(root: LayoutNode, id: string): SplitNode {
  const node = findNode(root, id)
  if (node?.kind !== 'split') throw new Error(`${id} is not a split`)
  return node
}

/** `n` and `c` for each child of a split. */
const shape = (split: SplitNode): string =>
  split.children.map((child) => (isNegativeSpace(child) ? 'n' : 'c')).join('')

const shares = (weights: readonly number[]): number[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

function expectSameRect(a: Rect | undefined, b: Rect | undefined, digits = 6): void {
  expect(a).toBeDefined()
  expect(b).toBeDefined()
  if (!a || !b) return
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
  expect(a.width).toBeCloseTo(b.width, digits)
  expect(a.height).toBeCloseTo(b.height, digits)
}

describe('compressing one zone symmetrically', () => {
  // A column of two; the top zone is compressed sideways, across the column.
  const column = (): { deck: Deck; top: LayoutNode; bottom: LayoutNode; split: SplitNode } => {
    const top = text()
    const bottom = text()
    const split = createSplit('y', [1, 1], [top, bottom])
    return { deck: deckWith(split), top, bottom, split }
  }
  const shift = (nodeId: string): ZoneDragStart => ({ kind: 'edge', nodeId, axis: 'x', side: 'start', shift: true })

  it('puts air on both sides, in a new split across the column, and grows it evenly', () => {
    const { deck, top } = column()
    const before = geometryOf(deck).get(top.id)
    const gesture = begin(deck, shift(top.id))
    const lengths = liveLengths(gesture, 100, 0)
    expect(lengths).not.toBeNull()
    if (!lengths || !before) return
    const rect = live(deck, gesture, lengths).get(top.id)
    expect(rect?.x).toBeCloseTo(before.x + 100, 6)
    expect(rect?.width).toBeCloseTo(before.width - 200, 6)
  })

  it('commits n : a : n on the zone’s own level, with the zone’s identity kept', () => {
    const { deck, top, split } = column()
    const after = drag(deck, shift(top.id), 200, 0)
    const root = splitAt(rootOf(after), split.id)
    expect(root.axis).toBe('y')
    const wrap = root.children[0]
    expect(wrap.kind).toBe('split')
    if (wrap.kind !== 'split') return
    expect(wrap.axis).toBe('x')
    expect(shape(wrap)).toBe('ncn')
    expect(wrap.children[1].id).toBe(top.id)
    expect(wrap.weights[0]).toBe(wrap.weights[2])
    expect(validateTree(rootOf(after))).toEqual([])
  })

  it('does not jump when the air appears, and takes it away again when reversed', () => {
    const { deck, top } = column()
    const before = geometryOf(deck).get(top.id)
    const gesture = begin(deck, shift(top.id))
    // A hair of movement is a hair of change: the air starts from nothing.
    for (const step of [0.5, 40, 0, 20, 0]) {
      const lengths = liveLengths(gesture, step, 0)
      expect(lengths).not.toBeNull()
      if (!lengths || !before) return
      const rect = live(deck, gesture, lengths).get(top.id)
      expect(rect?.x).toBeCloseTo(before.x + step, 6)
      expect(rect?.width).toBeCloseTo(before.width - 2 * step, 6)
    }
  })

  it('leaves nothing behind when released where it started', () => {
    const { deck, top } = column()
    const gesture = begin(deck, shift(top.id))
    const lengths = liveLengths(gesture, 0, 0)
    if (!lengths) throw new Error('no lengths')
    const released = releaseOf(gesture, lengths)
    expect(released?.kind).toBe('arrangement')
    if (released?.kind !== 'arrangement') return
    expect(sameLayout(released.candidates[0], released.original)).toBe(true)
  })

  it('grows back and lets the air go when the zone fills the width again', () => {
    const { deck, top, split } = column()
    const compressed = drag(deck, shift(top.id), 200, 0)
    const wrap = splitAt(rootOf(compressed), split.id).children[0]
    if (wrap.kind !== 'split') throw new Error('no wrap')
    // Now the zone's parent runs along x, so the same edge reuses the air.
    const grown = drag(compressed, { kind: 'edge', nodeId: top.id, axis: 'x', side: 'start', shift: true }, -400, 0)
    const root = splitAt(rootOf(grown), split.id)
    expect(root.children[0].id).toBe(top.id)
    expect(root.children.some(isNegativeSpace)).toBe(false)
  })
})

describe('compressing a group as one block', () => {
  const row = (weights: number[]): { deck: Deck; split: SplitNode } => {
    const split = createSplit('x', weights, weights.map(() => text()))
    return { deck: deckWith(split), split }
  }
  // In a row, across is up and down; up grows, down compresses.
  const across = (splitId: string, boundary: number): ZoneDragStart => ({
    kind: 'boundary',
    splitId,
    boundary,
    shift: false,
  })

  it('turns a : b : c into n : a : b : c : n, keeping a : b : c exactly', () => {
    const { deck, split } = row([1, 2, 3])
    const after = splitAt(rootOf(drag(deck, across(split.id, 0), 0, 300)), split.id)
    expect(shape(after)).toBe('ncccn')
    expect(after.weights[0]).toBe(after.weights[4])
    const inner = shares(after.weights.slice(1, 4))
    shares([1, 2, 3]).forEach((share, index) => expect(inner[index]).toBeCloseTo(share, 12))
  })

  it('keeps the block centred and its proportions exact while the pointer is down', () => {
    const { deck, split } = row([1, 2, 3])
    const gesture = begin(deck, across(split.id, 1))
    const lengths = liveLengths(gesture, 0, 180)
    if (!lengths) throw new Error('no lengths')
    const rects = live(deck, gesture, lengths)
    const parent = geometryOf(deck).get(split.id)
    const [a, , c] = split.children.map((child) => rects.get(child.id))
    if (!parent || !a || !c) throw new Error('no rects')
    expect(a.x - parent.x).toBeCloseTo(parent.x + parent.width - (c.x + c.width), 6)
    expect(a.x - parent.x).toBeCloseTo(90, 6)
  })

  it('reuses the air on a second compression from any divider of the block', () => {
    const { deck, split } = row([1, 1, 1])
    const once = drag(deck, across(split.id, 0), 0, 200)
    const first = splitAt(rootOf(once), split.id)
    expect(shape(first)).toBe('ncccn')
    // The divider between a and b, and the one between b and c, both mean the block.
    for (const boundary of [1, 2]) {
      const twice = splitAt(rootOf(drag(once, across(split.id, boundary), 0, 150)), split.id)
      expect(shape(twice)).toBe('ncccn')
      expect(twice.children[0].id).toBe(first.children[0].id)
      expect(twice.children[4].id).toBe(first.children[4].id)
      expect(shares(twice.weights)[0]).toBeGreaterThan(shares(first.weights)[0])
    }
  })

  it('grows both pieces of air by the same amount, however unequal they are', () => {
    const [n1, a, b, n2] = [air(), text(), text(), air()]
    const split = createSplit('x', [1, 3, 3, 3], [n1, a, b, n2])
    const deck = deckWith(split)
    const gesture = begin(deck, across(split.id, 1))
    const start = gesture.span.lengths
    const lengths = liveLengths(gesture, 0, 100)
    if (!lengths) throw new Error('no lengths')
    expect(lengths[0] - start[0]).toBeCloseTo(50, 6)
    expect(lengths[3] - start[3]).toBeCloseTo(50, 6)
  })

  it('keeps nested groups and their ratios whole inside the block', () => {
    const inner = createSplit('y', [2, 3], [text(), text()])
    const outerA = text()
    const split = createSplit('x', [1, 1], [outerA, inner])
    const after = rootOf(drag(deckWith(split), across(split.id, 0), 0, 250))
    const kept = splitAt(after, inner.id)
    expect(kept.weights).toEqual([2, 3])
    expect(kept.children.map((child) => child.id)).toEqual(inner.children.map((child) => child.id))
    expect(shape(splitAt(after, split.id))).toBe('nccn')
  })
})

describe('compressing from an outer edge', () => {
  const row = (): { deck: Deck; split: SplitNode; ids: string[] } => {
    const split = createSplit('x', [1, 2, 1], [text(), text(), text()])
    return { deck: deckWith(split), split, ids: split.children.map((child) => child.id) }
  }

  it('adds air only on the side it was dragged from', () => {
    const { deck, split, ids } = row()
    const fromLeft = splitAt(rootOf(drag(deck, { kind: 'edge', nodeId: ids[0], axis: 'x', side: 'start', shift: false }, 200, 0)), split.id)
    expect(shape(fromLeft)).toBe('nccc')
    const fromRight = splitAt(rootOf(drag(deck, { kind: 'edge', nodeId: ids[2], axis: 'x', side: 'end', shift: false }, -200, 0)), split.id)
    expect(shape(fromRight)).toBe('cccn')
    for (const after of [fromLeft, fromRight]) {
      const inner = shares(after.weights.filter((_, index) => !isNegativeSpace(after.children[index])))
      shares([1, 2, 1]).forEach((share, index) => expect(inner[index]).toBeCloseTo(share, 12))
    }
  })

  it('follows the pointer with the dragged edge, and only that edge', () => {
    const { deck, split, ids } = row()
    const gesture = begin(deck, { kind: 'edge', nodeId: ids[2], axis: 'x', side: 'end', shift: false })
    const lengths = liveLengths(gesture, -120, 0)
    if (!lengths) throw new Error('no lengths')
    const before = geometryOf(deck)
    const rects = live(deck, gesture, lengths)
    expectSameRect(
      { ...before.get(ids[0])!, width: 0 },
      { ...rects.get(ids[0])!, width: 0 },
    )
    const right = (id: string, map: Map<string, Rect>): number => map.get(id)!.x + map.get(id)!.width
    expect(right(ids[2], rects)).toBeCloseTo(right(ids[2], before) - 120, 6)
    expect(split.children.length).toBe(3)
  })

  it('with Shift compresses from both sides, exactly as the divider does', () => {
    const { deck, split, ids } = row()
    const edge = begin(deck, { kind: 'edge', nodeId: ids[0], axis: 'x', side: 'start', shift: true })
    const divider = begin(deck, { kind: 'boundary', splitId: split.id, boundary: 0, shift: false })
    const byEdge = liveLengths(edge, 60, 0)
    const byDivider = liveLengths(divider, 0, 120)
    expect(byEdge).not.toBeNull()
    byEdge?.forEach((length, index) => expect(byDivider?.[index]).toBeCloseTo(length, 9))
  })

  it('extends the air already on that side instead of adding more', () => {
    const [n, a, b] = [air(), text(), text()]
    const split = createSplit('x', [1, 2, 2], [n, a, b])
    const after = splitAt(
      rootOf(drag(deckWith(split), { kind: 'edge', nodeId: a.id, axis: 'x', side: 'start', shift: false }, 150, 0)),
      split.id,
    )
    expect(shape(after)).toBe('ncc')
    expect(after.children[0].id).toBe(n.id)
    expect(shares(after.weights)[0]).toBeGreaterThan(shares([1, 2, 2])[0])
  })

  it('works the same way down a column', () => {
    const split = createSplit('y', [1, 1], [text(), text()])
    const top = split.children[0]
    const after = splitAt(
      rootOf(drag(deckWith(split), { kind: 'edge', nodeId: top.id, axis: 'y', side: 'start', shift: false }, 0, 120)),
      split.id,
    )
    expect(shape(after)).toBe('ncc')
  })
})

describe('Shift on a divider', () => {
  it('rescales {a, b, c} | {d, e} and keeps both blocks’ insides', () => {
    const split = createSplit('x', [2, 3, 4, 3, 2], [text(), text(), text(), text(), text()])
    const deck = deckWith(split)
    const gesture = begin(deck, { kind: 'boundary', splitId: split.id, boundary: 2, shift: true })
    const lengths = liveLengths(gesture, -60, 0)
    if (!lengths) throw new Error('no lengths')
    const start = gesture.span.lengths
    const left = lengths[0] / start[0]
    const right = lengths[3] / start[3]
    for (const index of [1, 2]) expect(lengths[index] / start[index]).toBeCloseTo(left, 12)
    expect(lengths[4] / start[4]).toBeCloseTo(right, 12)
    expect(left).toBeLessThan(1)

    const after = splitAt(rootOf(release(deck, gesture, lengths)), split.id)
    const [a, b, c, d, e] = after.weights
    expect(a * 3).toBe(b * 2)
    expect(a * 2).toBe(c)
    expect(d * 2).toBe(e * 3)
  })

  it('leaves the plain divider drag as it was: only the pair beside it changes', () => {
    const split = createSplit('x', [2, 2, 2, 2], [text(), text(), text(), text()])
    const gesture = begin(deckWith(split), { kind: 'boundary', splitId: split.id, boundary: 1, shift: false })
    const lengths = liveLengths(gesture, 40, 0)
    if (!lengths) throw new Error('no lengths')
    expect(lengths[0]).toBeCloseTo(gesture.span.lengths[0], 12)
    expect(lengths[3]).toBeCloseTo(gesture.span.lengths[3], 12)
  })
})

describe('growing content into air', () => {
  it('uses up air the author made, until it is gone', () => {
    const [n, a] = [air(), text()]
    const split = createSplit('x', [1, 4], [n, a])
    const deck = deckWith(split)
    const gesture = begin(deck, { kind: 'boundary', splitId: split.id, boundary: 0, shift: false })
    const full = geometryOf(deck).get(split.id)
    const lengths = liveLengths(gesture, -2000, 0)
    if (!lengths || !full) throw new Error('no lengths')
    // At the end of the air the zone fills its parent, with no gap left over.
    expectSameRect(live(deck, gesture, lengths).get(a.id), full)
    const after = rootOf(release(deck, gesture, lengths))
    expect(after.id).toBe(a.id)
  })

  it('brings the air back when the pointer turns round before letting go', () => {
    const [n, a] = [air(), text()]
    const split = createSplit('x', [1, 4], [n, a])
    const deck = deckWith(split)
    const gesture = begin(deck, { kind: 'boundary', splitId: split.id, boundary: 0, shift: false })
    liveLengths(gesture, -2000, 0)
    const back = liveLengths(gesture, 0, 0)
    expect(back).toEqual(gesture.span.lengths)
    const some = liveLengths(gesture, -30, 0)
    if (!some) throw new Error('no lengths')
    expect(some[0]).toBeCloseTo(gesture.span.lengths[0] - 30, 9)
  })

  it('takes a zone’s growth from its air when it is resized between two pieces of it', () => {
    const [n1, a, n2] = [air(), text(), air()]
    const split = createSplit('x', [1, 4, 1], [n1, a, n2])
    const deck = deckWith(split)
    const after = splitAt(rootOf(drag(deck, { kind: 'zone', splitId: split.id, index: 1 }, 0, -60)), split.id)
    expect(shape(after)).toBe('ncn')
    expect(after.weights[0]).toBe(after.weights[2])
    expect(shares(after.weights)[1]).toBeGreaterThan(4 / 6)
  })
})

describe('the live layout is geometry the engine can draw', () => {
  it('keeps every content rect inside the split and the one gap between content', () => {
    const split = createSplit('x', [1, 2, 1], [text(), text(), text()])
    const deck = deckWith(split)
    const gesture = begin(deck, { kind: 'boundary', splitId: split.id, boundary: 0, shift: false })
    const rect = geometryOf(deck).get(split.id)
    for (const amount of [10, 47, 48, 49, 300, 1]) {
      const lengths = liveLengths(gesture, 0, amount)
      if (!lengths || !rect) throw new Error('no lengths')
      const rects = computeLayoutRects(previewFor(gesture, lengths).node, rect, gapOf(deck))
      const content = split.children.map((child) => rects.get(child.id)!)
      for (let index = 1; index < content.length; index += 1) {
        expect(content[index].x - (content[index - 1].x + content[index - 1].width)).toBeCloseTo(gapOf(deck), 6)
      }
      expect(content[0].x).toBeGreaterThanOrEqual(rect.x - 1e-6)
      expect(content[2].x + content[2].width).toBeLessThanOrEqual(rect.x + rect.width + 1e-6)
    }
  })
})
