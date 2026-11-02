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
import { containerWithDoc, createContainer, createNegativeSpace } from '../../domain/content'
import { estimateFit, estimateFitChecker } from '../../domain/fit'
import { computeLayoutRects, computeSlideGeometry, minimumSizeFor } from '../../domain/geometry'
import { collectLeaves, createLeaf, createSplit, findNode, replaceNode, validateTree } from '../../domain/layout'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { isNegativeSpace, mergeNegativeSpace } from '../../domain/negativeSpace'
import { createPresentation, withSlide } from '../../domain/presentation'
import { paragraphDoc } from '../../domain/richdoc'
import { airMeetsAir, contentAt } from '../../domain/testDecks'
import type { LayoutNode, Presentation, Rect, SplitNode } from '../../domain/types'
import { commitDraggedRatios } from './ratioDrag'
import {
  liveLengths,
  previewFor,
  releaseOf,
  sameLayout,
  shownFor,
  startZoneDrag,
  type ZoneDrag,
  type ZoneDragStart,
  type ZoneDragView,
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

/** The slide's layout as the stage draws `view`: normalised, as it will be stored. */
function drawn(deck: Deck, view: ZoneDragView): LayoutNode {
  return mergeNegativeSpace(replaceNode(rootOf(deck), view.nodeId, view.node))
}

/** The command a release of a drag that touched air runs, as the stage runs it. */
function arrange(deck: Deck, nodeId: string, layout: LayoutNode) {
  return rearrangeZones(deck.presentation, { slideId: deck.slideId, nodeId, layout, fits: estimateFitChecker })
}

/** The stage's question while the pointer is down: would the release store this? */
const accepts = (deck: Deck) => (nodeId: string, layout: LayoutNode): boolean => arrange(deck, nodeId, layout).ok

/** Release the drag at `lengths` and commit it as the stage would. */
function release(deck: Deck, drag: ZoneDrag, lengths: readonly number[]): Deck {
  const view = shownFor(drag, lengths, accepts(deck))
  if (view.kind === 'arrangement') {
    // What the stage does: store exactly the step that was shown, or nothing.
    if (!view.commit) return deck
    const result = arrange(deck, view.nodeId, view.commit)
    if (!result.ok) throw new Error(`refused: ${result.error.message}`)
    return { ...deck, presentation: result.value.presentation }
  }
  const released = releaseOf(drag, lengths)
  if (released?.kind !== 'ratios') throw new Error('nothing to release')
  const result = commitDraggedRatios(
    released.rules.equalityKeys,
    released.released,
    (weights) =>
      setSplitWeights(deck.presentation, {
        slideId: deck.slideId,
        nodeId: released.nodeId,
        weights,
        fits: estimateFitChecker,
      }),
    released.rules.preference,
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
    const after = splitAt(rootOf(drag(deck, { kind: 'zone', nodeId: a.id }, 0, -60)), split.id)
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

describe('pressing inside a zone that has nowhere to slide', () => {
  const column = (): { deck: Deck; top: LayoutNode; split: SplitNode } => {
    const top = text()
    const split = createSplit('y', [1, 1], [top, text()])
    return { deck: deckWith(split), top, split }
  }
  const press = (node: LayoutNode): ZoneDragStart => ({ kind: 'zone', nodeId: node.id })

  it('compresses it across its split, symmetrically, as the movement along the split goes on', () => {
    const { deck, top } = column()
    const before = geometryOf(deck).get(top.id)
    const gesture = begin(deck, press(top))
    // Down is smaller, as in a resize across a row: the coupling the zone keeps
    // once it has air beside it.
    for (const down of [80, 120, 30, 0, 60]) {
      const lengths = liveLengths(gesture, 0, down)
      expect(lengths).not.toBeNull()
      if (!lengths || !before) return
      expect(gesture.operation).toBe('compress')
      const rect = live(deck, gesture, lengths).get(top.id)
      expect(rect?.x).toBeCloseTo(before.x + down / 2, 6)
      expect(rect?.width).toBeCloseTo(before.width - down, 6)
      expect(rect?.height).toBeCloseTo(before.height, 6)
    }
  })

  it('commits the same n : a : n as Shift on its edge, on the zone’s own level', () => {
    const fromInside = column()
    const inside = drag(fromInside.deck, press(fromInside.top), 0, 200)
    const fromEdge = column()
    const edge = drag(
      fromEdge.deck,
      { kind: 'edge', nodeId: fromEdge.top.id, axis: 'x', side: 'start', shift: true },
      100,
      0,
    )
    const wrapOf = (deck: Deck, split: SplitNode): SplitNode => {
      const wrap = splitAt(rootOf(deck), split.id).children[0]
      if (wrap.kind !== 'split') throw new Error('the zone was not wrapped')
      return wrap
    }
    const wrap = wrapOf(inside, fromInside.split)
    expect(wrap.axis).toBe('x')
    expect(shape(wrap)).toBe('ncn')
    expect(wrap.children[1].id).toBe(fromInside.top.id)
    expect(wrap.weights).toEqual(wrapOf(edge, fromEdge.split).weights)
    expect(validateTree(rootOf(inside))).toEqual([])
  })

  it('carries on with the same movement once the air is there, without adding more', () => {
    const { deck, top, split } = column()
    const once = drag(deck, press(top), 0, 200)
    const wrapped = splitAt(rootOf(once), split.id).children[0]
    if (wrapped.kind !== 'split') throw new Error('the zone was not wrapped')
    const width = (d: Deck): number => geometryOf(d).get(top.id)?.width ?? NaN
    const twice = drag(once, press(top), 0, 150)
    const again = splitAt(rootOf(twice), wrapped.id)
    expect(shape(again)).toBe('ncn')
    expect(again.weights[0]).toBe(again.weights[2])
    expect(width(twice)).toBeLessThan(width(once))
  })

  it('compresses the root in the direction each movement stands for', () => {
    const lone = text()
    const deck = deckWith(lone)
    const narrower = rootOf(drag(deck, press(lone), 0, 300))
    expect(narrower.kind === 'split' && narrower.axis).toBe('x')
    if (narrower.kind === 'split') expect(shape(narrower)).toBe('ncn')
    // Across a column, right is bigger: left makes the root lower.
    const lower = rootOf(drag(deck, press(lone), -200, 0))
    expect(lower.kind === 'split' && lower.axis).toBe('y')
    if (lower.kind === 'split') expect(shape(lower)).toBe('ncn')
  })

  it('still slides a zone that has somewhere to go', () => {
    const [a, b, c] = [text(), text(), text()]
    const split = createSplit('y', [1, 1, 1], [a, b, c])
    const deck = deckWith(split)
    const gesture = begin(deck, press(b))
    liveLengths(gesture, 0, 40)
    expect(gesture.operation).toBe('translate')
    expect(gesture.span.split.id).toBe(split.id)
  })
})

describe('growing content into air takes all of it, gap and all', () => {
  const row = (weights: number[]): { deck: Deck; a: LayoutNode; split: SplitNode } => {
    const a = text()
    const split = createSplit('x', weights, [air(), a, air()])
    return { deck: deckWith(split), a, split }
  }

  it('lets the air fade to no room at all, evenly, and brings it back when reversed', () => {
    for (const weights of [
      [1, 4, 1],
      [1, 4, 2],
    ]) {
      const { deck, a, split } = row(weights)
      const whole = geometryOf(deck).get(split.id)
      const gesture = begin(deck, { kind: 'zone', nodeId: a.id })
      // Far past the end: the zone has taken everything the air had.
      const full = liveLengths(gesture, 0, -5000)
      if (!full || !whole) throw new Error('no lengths')
      expect(full[0]).toBeCloseTo(-gapOf(deck), 6)
      expect(full[2]).toBeCloseTo(-gapOf(deck), 6)
      expectSameRect(live(deck, gesture, full).get(a.id), whole)
      // Without letting go, the air comes back as it was.
      const back = liveLengths(gesture, 0, 0)
      expect(back).toEqual(gesture.span.lengths)
    }
  })

  it('commits what was drawn: no jump when the air is let go', () => {
    const { deck, a, split } = row([1, 4, 2])
    const whole = geometryOf(deck).get(split.id)
    const after = drag(deck, { kind: 'zone', nodeId: a.id }, 0, -5000)
    expect(rootOf(after).id).toBe(a.id)
    expectSameRect(geometryOf(after).get(a.id), whole)
  })
})

describe('a split that is already full', () => {
  const empty = (): LayoutNode => createLeaf()
  const full = (): { deck: Deck; split: SplitNode; zones: LayoutNode[] } => {
    const zones = Array.from({ length: 10 }, empty)
    const split = createSplit('x', [1, 2, 1, 2, 1, 2, 1, 2, 1, 2], zones)
    return { deck: deckWith(split), split, zones }
  }
  const contentShares = (deck: Deck, zones: readonly LayoutNode[]): number[] => {
    const rects = geometryOf(deck)
    return shares(zones.map((zone) => rects.get(zone.id)?.width ?? NaN))
  }

  for (const [label, start, x, y, expected] of [
    ['from a divider, on both sides', (s: SplitNode) => ({ kind: 'boundary', splitId: s.id, boundary: 4, shift: false }), 0, 200, 'ncn'],
    ['from an outer edge, on one side', (s: SplitNode) => ({ kind: 'edge', nodeId: s.children[0].id, axis: 'x', side: 'start', shift: false }), 150, 0, 'nc'],
    ['from an outer edge with Shift', (s: SplitNode) => ({ kind: 'edge', nodeId: s.children[9].id, axis: 'x', side: 'end', shift: true }), -100, 0, 'ncn'],
  ] as const) {
    it(`compresses it ${label}, and stores the block one level down`, () => {
      const { deck, split, zones } = full()
      const before = contentShares(deck, zones)
      const after = drag(deck, start(split) as ZoneDragStart, x, y)
      const root = rootOf(after)
      expect(validateTree(root)).toEqual([])
      expect(root.kind).toBe('split')
      if (root.kind !== 'split') return
      expect(root.axis).toBe('x')
      expect(shape(root)).toBe(expected)
      // The ten zones, in order, in exactly the proportions they had.
      const block = root.children.find((child) => !isNegativeSpace(child))
      expect(block?.kind).toBe('split')
      if (block?.kind !== 'split') return
      expect(block.children.map((child) => child.id)).toEqual(zones.map((zone) => zone.id))
      expect(block.weights).toEqual(split.weights)
      contentShares(after, zones).forEach((share, index) => expect(share).toBeCloseTo(before[index], 9))
    })
  }

  it('keeps the flat split when the air is given back before release', () => {
    const { deck, split } = full()
    const gesture = begin(deck, { kind: 'boundary', splitId: split.id, boundary: 4, shift: false })
    liveLengths(gesture, 0, 200)
    const lengths = liveLengths(gesture, 0, 0)
    if (!lengths) throw new Error('no lengths')
    const released = releaseOf(gesture, lengths)
    if (released?.kind !== 'arrangement') throw new Error('not an arrangement')
    expect(sameLayout(released.candidates[0], released.original)).toBe(true)
  })
})

describe('a symmetric compression is stored centred, however far it went', () => {
  it('keeps both pieces of air or neither, at one ratio', () => {
    for (let down = 20; down <= 900; down += 37) {
      const zone = text()
      const deck = deckWith(createSplit('y', [1, 1], [zone, text()]))
      const lone = text()
      const blockDeck = deckWith(createSplit('x', [1, 2, 1], [text(), lone, text()]))
      const results = [
        rootOf(drag(deck, { kind: 'zone', nodeId: zone.id }, 0, down)),
        rootOf(drag(blockDeck, { kind: 'boundary', splitId: rootOf(blockDeck).id, boundary: 0, shift: false }, 0, down)),
      ]
      for (const root of results) {
        for (const node of [root, ...(root.kind === 'split' ? root.children : [])]) {
          if (node.kind !== 'split') continue
          const pattern = shape(node)
          if (!pattern.includes('n')) continue
          expect(pattern.startsWith('n') && pattern.endsWith('n')).toBe(true)
          expect(node.weights[0]).toBe(node.weights[node.weights.length - 1])
        }
      }
    }
  })
})

describe('what is stored on release is what was shown just before it', () => {
  /** The slide as `shownFor` draws it with the pointer at `x`/`y`, and as the release stores it. */
  function settle(deck: Deck, start: ZoneDragStart, x: number, y: number) {
    const gesture = begin(deck, start)
    const lengths = liveLengths(gesture, x, y)
    // A movement too small to be read as a drag shows nothing and stores nothing.
    if (!lengths) return { shownRoot: rootOf(deck), after: deck }
    const view = shownFor(gesture, lengths, accepts(deck))
    return { shownRoot: drawn(deck, view), after: release(deck, gesture, lengths) }
  }

  const column = (): { deck: Deck; zone: LayoutNode } => {
    const zone = text()
    return { deck: deckWith(createSplit('y', [1, 1], [zone, text()])), zone }
  }
  const row = (): { deck: Deck; split: SplitNode } => {
    const split = createSplit('x', [1, 2, 1], [text(), text(), text()])
    return { deck: deckWith(split), split }
  }
  const cases: Array<{ label: string; setup: () => { deck: Deck; start: ZoneDragStart }; move: (amount: number) => [number, number] }> = [
    {
      label: 'one zone, symmetrically, with Shift on its edge',
      setup: () => {
        const { deck, zone } = column()
        return { deck, start: { kind: 'edge', nodeId: zone.id, axis: 'x', side: 'start', shift: true } }
      },
      move: (amount) => [amount, 0],
    },
    {
      label: 'one zone, symmetrically, from inside it',
      setup: () => {
        const { deck, zone } = column()
        return { deck, start: { kind: 'zone', nodeId: zone.id } }
      },
      // The movement is shared between the two sides, as on a divider.
      move: (amount) => [0, 2 * amount],
    },
    {
      label: 'one zone, from one side',
      setup: () => {
        const { deck, zone } = column()
        return { deck, start: { kind: 'edge', nodeId: zone.id, axis: 'x', side: 'end', shift: false } }
      },
      move: (amount) => [-amount, 0],
    },
    {
      label: 'a row of three, from one side',
      setup: () => {
        const { deck, split } = row()
        return { deck, start: { kind: 'edge', nodeId: split.children[0].id, axis: 'x', side: 'start', shift: false } }
      },
      move: (amount) => [amount, 0],
    },
    {
      label: 'a row of three, symmetrically, from a divider',
      setup: () => {
        const { deck, split } = row()
        return { deck, start: { kind: 'boundary', splitId: split.id, boundary: 0, shift: false } }
      },
      move: (amount) => [0, 2 * amount],
    },
  ]

  /** Every rect on the slide is where it was shown, and the tree is the one shown. */
  function expectStoredAsShown(deck: Deck, shownRoot: LayoutNode, after: Deck, label: string): void {
    expect(validateTree(shownRoot), label).toEqual([])
    const shown = geometryOf(deck, shownRoot)
    const stored = geometryOf(after)
    for (const [id, rect] of shown) {
      const node = findNode(shownRoot, id)
      if (node?.kind !== 'leaf') continue
      expectSameRect(stored.get(id), rect)
    }
    expect(sameLayout(rootOf(after), shownRoot), label).toBe(true)
  }

  for (const { label, setup, move } of cases) {
    it.each([40, 80, 120, 160])(`${label}: %i px`, (amount) => {
      const { deck, start } = setup()
      const { shownRoot, after } = settle(deck, start, ...move(amount))
      expectStoredAsShown(deck, shownRoot, after, `${amount} px`)
    })

    it(`${label}: all the way, the step where air appears included`, () => {
      let stepped = false
      for (let amount = 1; amount <= 240; amount += 3) {
        const { deck, start } = setup()
        const { shownRoot, after } = settle(deck, start, ...move(amount))
        expectStoredAsShown(deck, shownRoot, after, `${amount} px`)
        stepped ||= !sameLayout(shownRoot, rootOf(deck))
      }
      expect(stepped).toBe(true)
    })
  }

  it('shows the steps it can store, and the hand between them', () => {
    const { deck, zone } = column()
    const gesture = begin(deck, { kind: 'edge', nodeId: zone.id, axis: 'x', side: 'start', shift: true })
    // A little movement asks for air thinner than a whole ratio can hold: the
    // slide stays as it was until the first step is nearer than none.
    const small = liveLengths(gesture, 10, 0)
    if (!small) throw new Error('no lengths')
    const unchanged = shownFor(gesture, small, accepts(deck))
    expect(sameLayout(drawn(deck, unchanged), rootOf(deck))).toBe(true)
    // …while the live layout, which the outline follows, has moved.
    expect(live(deck, gesture, small).get(zone.id)?.x).toBeCloseTo((geometryOf(deck).get(zone.id)?.x ?? 0) + 10, 6)
  })

  it('stores what was shown when content grows back into air', () => {
    const { deck, zone } = column()
    const shift: ZoneDragStart = { kind: 'edge', nodeId: zone.id, axis: 'x', side: 'start', shift: true }
    const compressed = drag(deck, shift, 160, 0)
    for (let amount = 10; amount <= 160; amount += 10) {
      const { shownRoot, after } = settle(compressed, shift, -amount, 0)
      expectStoredAsShown(compressed, shownRoot, after, `${amount} px`)
    }
  })
})

describe('a step is only shown where what is in it still fits', () => {
  /** A zone of running text, `words` long. */
  const wordy = (words: number): LayoutNode =>
    createLeaf(containerWithDoc(paragraphDoc(Array.from({ length: words }, (_, at) => `ord${at % 7}`).join(' '))))

  /** Whether any content on the slide would be cut off with `root` as its layout. */
  function hides(deck: Deck, root: LayoutNode): boolean {
    const rects = geometryOf(deck, root)
    return collectLeaves(root).some((leaf) => {
      const rect = rects.get(leaf.id)
      return leaf.content !== null && rect !== undefined && !estimateFit(leaf.content, rect, { theme: deck.presentation.theme }).fits
    })
  }

  const shift = (nodeId: string): ZoneDragStart => ({ kind: 'edge', nodeId, axis: 'x', side: 'start', shift: true })
  const oneSide = (nodeId: string): ZoneDragStart => ({ kind: 'edge', nodeId, axis: 'x', side: 'end', shift: false })

  for (const [label, start, sign] of [
    ['symmetrically', shift, 1],
    ['from one side', oneSide, -1],
  ] as const) {
    it(`never shows a step that would cut text off, ${label}, and stores the step it shows`, () => {
      let refusedNearest = 0
      let compressed = 0
      // Text from short to as much as the zone holds at full width: somewhere
      // in there is text that fits while the hand asks for a little less room,
      // and does not fit in the nearest step that can be stored.
      for (let words = 40; ; words += 4) {
        const zone = wordy(words)
        const deck = deckWith(createSplit('y', [1, 1], [zone, text()]))
        if (hides(deck, rootOf(deck))) break
        for (let amount = 8; amount <= 300; amount += 8) {
          const gesture = begin(deck, start(zone.id))
          const lengths = liveLengths(gesture, sign * amount, 0)
          if (!lengths) continue
          // The stage stops the hand where the hand's own layout would cut
          // content off; past that point nothing new is shown.
          if (hides(deck, replaceNode(rootOf(deck), previewFor(gesture, lengths).nodeId, previewFor(gesture, lengths).node))) break
          const view = shownFor(gesture, lengths, accepts(deck))
          const shownRoot = drawn(deck, view)
          const where = `${words} words, ${amount} px`
          expect(hides(deck, shownRoot), where).toBe(false)
          const after = release(deck, gesture, lengths)
          expect(sameLayout(rootOf(after), shownRoot), where).toBe(true)
          const shownRects = geometryOf(deck, shownRoot)
          const storedRects = geometryOf(after)
          for (const leaf of collectLeaves(shownRoot)) expectSameRect(storedRects.get(leaf.id), shownRects.get(leaf.id))

          const released = releaseOf(gesture, lengths)
          if (released?.kind !== 'arrangement') continue
          const [nearest] = released.candidates
          if (nearest && !sameLayout(nearest, released.original) && !sameLayout(nearest, view.node)) refusedNearest += 1
          if (view.kind === 'arrangement' && view.commit) compressed += 1
        }
      }
      // Both happened: steps that fit were shown and stored, and steps nearer
      // to the hand that would have cut text off were passed over.
      expect(compressed).toBeGreaterThan(0)
      expect(refusedNearest).toBeGreaterThan(0)
    })
  }

  it('goes back to the layout it started from when the hand does', () => {
    const zone = wordy(80)
    const deck = deckWith(createSplit('y', [1, 1], [zone, text()]))
    const gesture = begin(deck, shift(zone.id))
    for (const amount of [200, 0]) {
      const lengths = liveLengths(gesture, amount, 0)
      if (!lengths) throw new Error('no lengths')
      const view = shownFor(gesture, lengths, accepts(deck))
      const shownRoot = drawn(deck, view)
      expect(sameLayout(shownRoot, rootOf(deck))).toBe(amount === 0)
    }
  })
})

describe('resizing a zone between air shows and stores the same steps, both ways', () => {
  const wordy = (words: number): LayoutNode =>
    createLeaf(containerWithDoc(paragraphDoc(Array.from({ length: words }, (_, at) => `ord${at % 7}`).join(' '))))

  /** A stored `n : a : n` above an empty zone, with `a` holding `content`. */
  const between = (a: LayoutNode): Deck =>
    deckWith(createSplit('y', [1, 1], [createSplit('x', [1, 4, 1], [air(), a, air()]), text()]))

  for (const [label, zone] of [
    ['an empty zone', () => text()],
    ['text close to filling it', () => wordy(60)],
  ] as const) {
    it(`${label}: the air grows or shrinks in steps, and what is shown is stored`, () => {
      const seen = new Set<string>()
      for (const sign of [1, -1]) {
        for (let amount = 4; amount <= 240; amount += 4) {
          const a = zone()
          const deck = between(a)
          const gesture = begin(deck, { kind: 'zone', nodeId: a.id })
          const lengths = liveLengths(gesture, 0, sign * amount)
          if (!lengths) continue
          const view = shownFor(gesture, lengths, accepts(deck))
          const where = `${sign * amount} px`
          // The air changed, so the slide shows a step it can store.
          expect(view.kind, where).toBe('arrangement')
          const shownRoot = drawn(deck, view)
          const after = release(deck, gesture, lengths)
          expect(sameLayout(rootOf(after), shownRoot), where).toBe(true)
          const shown = geometryOf(deck, shownRoot)
          const stored = geometryOf(after)
          for (const leaf of collectLeaves(shownRoot)) expectSameRect(stored.get(leaf.id), shown.get(leaf.id))
          // Centred it was, and centred it stays: the two pieces of air keep one ratio.
          const root = rootOf(after)
          const wrap = root.kind === 'split' ? root.children[0] : null
          if (wrap?.kind === 'split' && wrap.children.length === 3) expect(wrap.weights[0], where).toBe(wrap.weights[2])
          if (view.kind === 'arrangement' && view.commit) seen.add(sign > 0 ? 'one way' : 'the other')
        }
      }
      // Both directions stepped somewhere along the way.
      expect(seen.size).toBe(2)
    })
  }
})

describe('compressing a group that already has air at its sides', () => {
  /** A zone compressed once to `n : a : n` across its column, and that group. */
  function compressedOnce(): { deck: Deck; a: LayoutNode; groupId: string } {
    const a = text()
    const fresh = deckWith(createSplit('y', [1, 1], [a, text()]))
    const deck = drag(fresh, { kind: 'edge', nodeId: a.id, axis: 'x', side: 'start', shift: true }, 160, 0)
    const root = rootOf(deck)
    if (root.kind !== 'split' || root.children[0].kind !== 'split') throw new Error('no group')
    return { deck, a, groupId: root.children[0].id }
  }

  for (const [label, start, sign] of [
    ['with Shift', (id: string): ZoneDragStart => ({ kind: 'edge', nodeId: id, axis: 'x', side: 'start', shift: true }), 1],
    ['from one side', (id: string): ZoneDragStart => ({ kind: 'edge', nodeId: id, axis: 'x', side: 'end', shift: false }), -1],
  ] as const) {
    it(`${label}, reuses that air on the group's own level instead of adding more beside it`, () => {
      for (const amount of [-120, -60, 40, 80, 160]) {
        const { deck, a, groupId } = compressedOnce()
        const gesture = begin(deck, start(groupId))
        const lengths = liveLengths(gesture, sign * amount, 0)
        if (!lengths) continue
        const view = shownFor(gesture, lengths, accepts(deck))
        const shownRoot = drawn(deck, view)
        const after = release(deck, gesture, lengths)
        const where = `${sign * amount} px`
        for (const root of [shownRoot, rootOf(after)]) {
          expect(airMeetsAir(root), where).toBe(false)
          expect(validateTree(root), where).toEqual([])
        }
        expect(sameLayout(rootOf(after), shownRoot), where).toBe(true)
        // The zone is still in a row with air, one level down from the column.
        const row = rootOf(after).kind === 'split' ? (rootOf(after) as SplitNode).children[0] : null
        if (row?.kind === 'split') {
          expect(row.children.some((child) => child.id === a.id), where).toBe(true)
          expect(row.children.every((child) => child.kind === 'leaf'), where).toBe(true)
        } else expect(row?.id, where).toBe(a.id)
      }
    })
  }

  it('normalises a stored row of air around a nested row of air on the edge both share', () => {
    const [n1, n2, a, n3, n4] = [air(), air(), text(), air(), air()]
    const deck = deckWith(
      createSplit('y', [1, 1], [createSplit('x', [1, 10, 1], [n1, createSplit('x', [1, 10, 1], [n2, a, n3]), n4]), text()]),
    )
    expect(airMeetsAir(rootOf(deck))).toBe(false)
    const row = (rootOf(deck) as SplitNode).children[0]
    expect(row.kind === 'split' && shape(row)).toBe('ncn')
  })
})
