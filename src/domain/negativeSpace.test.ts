/**
 * Adjacent negative space is one piece of air.
 *
 * The rule is tested twice over: as a pure function of a tree, on many random
 * trees, and through the commands that can put two pieces of air side by side
 * — because the promise is that the structure does not depend on how it came
 * about, and the commands are how it comes about.
 */

import { describe, expect, it } from 'vitest'
import { createContainer, createNegativeSpace } from './content'
import { addSlide, deleteLayoutNode, duplicateLayoutNode, setZoneContent, splitLeaf } from './commands'
import { computeLayoutRects } from './geometry'
import { createLeaf, createSplit, findNode, replaceNode, validateTree, walkNodes } from './layout'
import { airMeetings, isNegativeSpace, mergeNegativeSpace } from './negativeSpace'
import { createPresentation } from './presentation'
import { contentAt } from './testDecks'
import type { Axis, LayoutNode, Presentation } from './types'

const air = (): LayoutNode => createLeaf(createNegativeSpace())
const text = (): LayoutNode => createLeaf(createContainer())

/** Every split in the tree, with its children described as `n` or `c`. */
function shapes(root: LayoutNode): string[] {
  const out: string[] = []
  walkNodes(root, (node) => {
    if (node.kind === 'split') {
      out.push(node.children.map((child) => (isNegativeSpace(child) ? 'n' : 'c')).join(''))
    }
  })
  return out
}

/**
 * Whether `after` keeps the content of `before` in proportion: no content zone
 * smaller along either axis, and any two whose nearest common split in
 * `before` runs along an axis grown by the same factor along it — the zones of
 * one row keep their sizes relative to each other exactly.
 *
 * Measured with the geometry itself, without gaps, so a length is exactly the
 * share the ratios give it: an oracle that shares no code with the merge.
 */
function keepsProportions(before: LayoutNode, after: LayoutNode): boolean {
  const frame = { x: 0, y: 0, width: 1600, height: 900 }
  const [was, now] = [computeLayoutRects(before, frame, 0), computeLayoutRects(after, frame, 0)]
  const parents = new Map<string, LayoutNode>()
  walkNodes(before, (node) => {
    if (node.kind === 'split') for (const child of node.children) parents.set(child.id, node)
  })
  const content: string[] = []
  walkNodes(before, (node) => {
    if (node.kind === 'leaf' && !isNegativeSpace(node)) content.push(node.id)
  })
  const growth = (id: string, axis: Axis): number => {
    const [old, next] = [was.get(id), now.get(id)]
    if (!old || !next) return Number.NaN
    return axis === 'x' ? next.width / old.width : next.height / old.height
  }
  const ancestors = (id: string): LayoutNode[] => {
    const chain: LayoutNode[] = []
    for (let parent = parents.get(id); parent; parent = parents.get(parent.id)) chain.push(parent)
    return chain
  }
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(a, b)
  for (const id of content) {
    if (!(growth(id, 'x') >= 1 - 1e-9) || !(growth(id, 'y') >= 1 - 1e-9)) return false
  }
  for (const [index, first] of content.entries()) {
    const around = ancestors(first)
    for (const second of content.slice(index + 1)) {
      const common = ancestors(second).find((node) => around.includes(node))
      if (common?.kind !== 'split') continue
      if (!close(growth(first, common.axis), growth(second, common.axis))) return false
    }
  }
  return true
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomTree(random: () => number, depth: number): LayoutNode {
  if (depth === 0 || random() < 0.35) return random() < 0.5 ? air() : text()
  const count = 2 + Math.floor(random() * 4)
  return createSplit(
    random() < 0.5 ? 'x' : 'y',
    Array.from({ length: count }, () => 1 + Math.floor(random() * 10)),
    Array.from({ length: count }, () => randomTree(random, depth - 1)),
  )
}

describe('mergeNegativeSpace', () => {
  it('merges a run of air into its first leaf, with the run’s whole weight', () => {
    const [a, n1, n2, b] = [text(), air(), air(), text()]
    const merged = mergeNegativeSpace(createSplit('x', [2, 1, 3, 2], [a, n1, n2, b]))
    expect(merged.kind).toBe('split')
    if (merged.kind !== 'split') return
    expect(merged.children.map((child) => child.id)).toEqual([a.id, n1.id, b.id])
    expect(merged.weights).toEqual([2, 4, 2])
    expect(merged.children[1]).toBe(n1)
  })

  it('collapses a split of nothing but air into one leaf, and merges again above it', () => {
    const [a, n0, n1, n2] = [text(), air(), air(), air()]
    const inner = createSplit('y', [1, 1], [n1, n2])
    const root = mergeNegativeSpace(createSplit('x', [2, 1, 1], [a, n0, inner]))
    expect(shapes(root)).toEqual(['cn'])
    if (root.kind !== 'split') return
    expect(root.children[1].id).toBe(n0.id)
    expect(root.weights).toEqual([2, 2])
  })

  it('leaves air across a split that runs the other way alone: it covers only part of the edge', () => {
    const root = createSplit('x', [1, 1, 1], [air(), createSplit('y', [1, 1], [air(), text()]), text()])
    expect(mergeNegativeSpace(root)).toBe(root)
  })

  it('merges air on one edge through a split running the same way: [n, [n, a, n], n] is [n, a, n]', () => {
    const [outerStart, innerStart, a, innerEnd, outerEnd] = [air(), air(), text(), air(), air()]
    const inner = createSplit('x', [1, 10, 1], [innerStart, a, innerEnd])
    const merged = mergeNegativeSpace(createSplit('x', [1, 10, 1], [outerStart, inner, outerEnd]))
    expect(merged.kind).toBe('split')
    if (merged.kind !== 'split') return
    expect(shapes(merged)).toEqual(['ncn'])
    // The content zone keeps who it is, and each run of air its first leaf, as any run does.
    expect(merged.children.map((child) => child.id)).toEqual([outerStart.id, a.id, innerEnd.id])
    expect(merged.weights[0]).toBe(merged.weights[2])
    // What changes is the air: the content's share of the row is no smaller.
    expect(merged.weights[1] / (merged.weights[0] + merged.weights[1] + merged.weights[2])).toBeGreaterThanOrEqual(
      (10 / 12) * (10 / 12),
    )
    expect(validateTree(merged)).toEqual([])
  })

  it('reaches air that is nested more than one level deep, and keeps the group it leaves', () => {
    const [n0, n1, a, b] = [air(), air(), text(), text()]
    const group = createSplit('x', [5, 4], [createSplit('x', [1, 4], [n1, a]), b])
    const root = createSplit('x', [1, 6], [n0, group])
    const merged = mergeNegativeSpace(root)
    expect(merged.kind).toBe('split')
    if (merged.kind !== 'split') return
    expect(merged.children[0].id).toBe(n0.id)
    expect(shapes(merged)).toEqual(['nc', 'cc'])
    expect(merged.children[1].id).toBe(group.id)
    expect(keepsProportions(root, merged)).toBe(true)
    expect(validateTree(merged)).toEqual([])
  })

  it('merges where a split of ten children has no room for another: the two groups become one', () => {
    const [a, b] = [text(), text()]
    const [left, right] = [createSplit('x', [1, 1], [a, air()]), createSplit('x', [1, 1], [air(), b])]
    const rest = Array.from({ length: 8 }, text)
    const root = createSplit('x', Array(10).fill(1), [left, right, ...rest])
    const merged = mergeNegativeSpace(root)
    expect(airMeetings(root)).toBe(1)
    expect(airMeetings(merged)).toBe(0)
    expect(merged.kind).toBe('split')
    if (merged.kind !== 'split') return
    expect(merged.children).toHaveLength(9)
    expect(merged.children[0].id).toBe(left.id)
    expect(shapes(merged)[1]).toBe('cnc')
    // The two pieces were one each half of a pair of ratio-one children: one piece of two now.
    expect(merged.children[0].kind === 'split' && merged.children[0].weights).toEqual([1, 2, 1])
    expect(keepsProportions(root, merged)).toBe(true)
    expect(validateTree(merged)).toEqual([])
  })

  it('leaves the nested air where it is when lifting it out would bend the content: the outer piece goes', () => {
    // a : b is 1 : 110 here, which no two whole ratios from 1 to 10 can say.
    const [n0, n1, a, b] = [air(), air(), text(), text()]
    const group = createSplit('x', [1, 10], [createSplit('x', [10, 1], [n1, a]), b])
    const root = createSplit('x', [1, 10], [n0, group])
    const merged = mergeNegativeSpace(root)
    expect(airMeetings(merged)).toBe(0)
    expect(merged.id).toBe(group.id)
    expect(findNode(merged, n1.id)).not.toBeNull()
    expect(findNode(merged, n0.id)).toBeNull()
    expect(keepsProportions(root, merged)).toBe(true)
    expect(validateTree(merged)).toEqual([])
  })

  it('inside a row, merges only what keeps the rest of the row as it is', () => {
    // The inner row is one part of the outer one: air it gave up would grow its
    // content against `c`, so a sum past ten that the ladder cannot hold exactly
    // is left as it is — and a command that makes one is refused (below).
    const inner = createSplit('x', [8, 7, 2], [air(), air(), text()])
    const root = createSplit('y', [1, 1], [createSplit('x', [1, 1], [text(), inner]), text()])
    const merged = mergeNegativeSpace(root)
    expect(keepsProportions(root, merged)).toBe(true)
    const exact = createSplit('x', [1, 1], [text(), createSplit('x', [4, 2, 3], [air(), air(), text()])])
    const both = mergeNegativeSpace(exact)
    expect(airMeetings(both)).toBe(0)
    expect(keepsProportions(exact, both)).toBe(true)
  })

  it('takes nested air out only where it meets air', () => {
    const lone = createSplit('x', [1, 4], [createSplit('x', [1, 4, 1], [air(), text(), air()]), text()])
    expect(mergeNegativeSpace(lone)).toBe(lone)
  })

  it('returns the same object when there is nothing to merge', () => {
    const root = createSplit('x', [1, 2, 1], [air(), text(), air()])
    expect(mergeNegativeSpace(root)).toBe(root)
  })

  it('keeps a sum past ten inside the range without shrinking any content', () => {
    const merged = mergeNegativeSpace(createSplit('x', [8, 7, 2], [air(), air(), text()]))
    expect(merged.kind).toBe('split')
    if (merged.kind !== 'split') return
    expect(merged.weights.every((weight) => weight >= 1 && weight <= 10)).toBe(true)
    const share = merged.weights[1] / (merged.weights[0] + merged.weights[1])
    expect(share).toBeGreaterThanOrEqual(2 / 17)
  })

  it('never bends the content, never adds a meeting, and keeps every tree valid', () => {
    const random = makeRandom(1102)
    let [met, left] = [0, 0]
    for (let run = 0; run < 300; run += 1) {
      const tree = randomTree(random, 3)
      const merged = mergeNegativeSpace(tree)
      expect(validateTree(merged)).toEqual([])
      expect(keepsProportions(tree, merged)).toBe(true)
      expect(airMeetings(merged)).toBeLessThanOrEqual(airMeetings(tree))
      expect(mergeNegativeSpace(merged)).toBe(merged)
      met += airMeetings(tree)
      left += airMeetings(merged)
    }
    // Random ratios are far harsher than anything an editor makes: some of
    // these rows cannot be shown on whole ratios with one piece of air at all,
    // and those are left as they are rather than bent.
    expect(met).toBeGreaterThan(100)
    expect(left).toBeLessThan(met / 2)
  }, 30_000)
})

/** A content slide whose root is split into the given leaves, filled in order. */
function deckWith(kinds: Array<'n' | 'c' | 'e'>): { presentation: Presentation; slideId: string } {
  const base = createPresentation({ title: 'Luft' })
  const slide = contentAt(base, 1)
  const split = splitLeaf(base, {
    slideId: slide.id,
    nodeId: slide.root.id,
    axis: 'x',
    weights: kinds.map(() => 1),
  })
  if (!split.ok) throw new Error('could not split')
  let presentation = split.value.presentation
  const root = contentAt(presentation, 1).root
  if (root.kind !== 'split') throw new Error('no split')
  root.children.forEach((child, index) => {
    const kind = kinds[index]
    if (kind === 'e') return
    const placed = setZoneContent(presentation, {
      slideId: slide.id,
      nodeId: child.id,
      content: kind === 'n' ? createNegativeSpace() : createContainer(),
    })
    if (!placed.ok) throw new Error('could not fill')
    presentation = placed.value.presentation
  })
  return { presentation, slideId: slide.id }
}

describe('commands that put air next to air', () => {
  it('merges when a zone between two pieces of air is deleted', () => {
    const { presentation, slideId } = deckWith(['c', 'n', 'c', 'n', 'c'])
    const root = contentAt(presentation, 1).root
    if (root.kind !== 'split') throw new Error('no split')
    const deleted = deleteLayoutNode(presentation, { slideId, nodeId: root.children[2].id })
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(shapes(contentAt(deleted.value.presentation, 1).root)).toEqual(['cnc'])
  })

  it('merges when a zone beside air is made into air', () => {
    const { presentation, slideId } = deckWith(['c', 'n', 'e'])
    const root = contentAt(presentation, 1).root
    if (root.kind !== 'split') throw new Error('no split')
    const placed = setZoneContent(presentation, {
      slideId,
      nodeId: root.children[2].id,
      content: createNegativeSpace(),
    })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    const after = contentAt(placed.value.presentation, 1).root
    expect(shapes(after)).toEqual(['cn'])
    expect(findNode(after, root.children[1].id)).not.toBeNull()
  })

  it('merges air in a layout a new slide brings with it — from a template or the agent', () => {
    const layout = createSplit('x', [1, 2, 3, 2], [air(), air(), text(), air()])
    const nested = createSplit('y', [1, 1], [createSplit('x', [2, 3, 1], [text(), air(), air()]), text()])
    for (const root of [layout, nested]) {
      const added = addSlide(createPresentation({ title: 'Mal' }), { root })
      expect(added.ok).toBe(true)
      if (!added.ok) return
      const slide = added.value.slides[added.value.slides.length - 1]
      if (slide.kind !== 'content') throw new Error('not a content slide')
      for (const shape of shapes(slide.root)) expect(shape).not.toMatch(/nn/)
      expect(validateTree(slide.root)).toEqual([])
    }
  })

  /** A deck whose one content slide has `root`. */
  function deckOf(root: LayoutNode): { presentation: Presentation; slideId: string } {
    const added = addSlide(createPresentation({ title: 'Luft' }), { root })
    if (!added.ok) throw new Error('could not add')
    const slide = added.value.slides[added.value.slides.length - 1]
    return { presentation: added.value, slideId: slide.id }
  }
  const rootIn = (presentation: Presentation): LayoutNode => contentAt(presentation, presentation.slides.length - 1).root
  /** The node at `path` of child indices — a new slide's layout is stored under ids of its own. */
  const at = (node: LayoutNode, ...path: number[]): LayoutNode =>
    path.reduce((current, index) => (current.kind === 'split' ? current.children[index] : current), node)

  it('merges when a zone made into air meets air in the neighbouring group of a row of ten', () => {
    const row = createSplit('x', Array(10).fill(1), [
      createSplit('x', [1, 1], [text(), air()]),
      createSplit('x', [1, 1], [createLeaf(null), text()]),
      ...Array.from({ length: 8 }, text),
    ])
    const { presentation, slideId } = deckOf(row)
    const t = at(rootIn(presentation), 1, 0)
    const placed = setZoneContent(presentation, { slideId, nodeId: t.id, content: createNegativeSpace() })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    const after = rootIn(placed.value.presentation)
    expect(airMeetings(after)).toBe(0)
    expect(after.kind === 'split' && after.children.length).toBe(9)
    const converted = replaceNode(rootIn(presentation), t.id, { ...t, kind: 'leaf', content: createNegativeSpace() })
    expect(keepsProportions(converted, after)).toBe(true)
    expect(validateTree(after)).toEqual([])
  })

  for (const [label, act] of [
    [
      'made into air',
      (deck: { presentation: Presentation; slideId: string }, zone: LayoutNode) =>
        setZoneContent(deck.presentation, { slideId: deck.slideId, nodeId: zone.id, content: createNegativeSpace() }),
    ],
    [
      'deleted',
      (deck: { presentation: Presentation; slideId: string }, zone: LayoutNode) =>
        deleteLayoutNode(deck.presentation, { slideId: deck.slideId, nodeId: zone.id }),
    ],
  ] as const) {
    it(`refuses a zone ${label} where the air it brings together cannot be one piece without bending the content`, () => {
      // c : a : b is 220 : 2 : 11 here: no row of whole ratios from 1 to 10
      // with one piece of air between a and b can say it.
      const left = createSplit('x', [1, 10], [text(), air()])
      const root =
        label === 'deleted'
          ? createSplit('x', [10, 1, 1, 1], [text(), left, text(), createSplit('x', [1, 1], [air(), text()])])
          : createSplit('x', [10, 1, 1], [text(), left, createSplit('x', [1, 1], [createLeaf(null), text()])])
      const deck = deckOf(root)
      expect(airMeetings(rootIn(deck.presentation))).toBe(0)
      const zone = label === 'deleted' ? at(rootIn(deck.presentation), 2) : at(rootIn(deck.presentation), 2, 0)
      const result = act(deck, zone)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NEGATIVE_SPACE_CANNOT_MERGE')
    })
  }

  it('merges a duplicated piece of air into the original', () => {
    const { presentation, slideId } = deckWith(['c', 'n'])
    const root = contentAt(presentation, 1).root
    if (root.kind !== 'split') throw new Error('no split')
    const duplicated = duplicateLayoutNode(presentation, { slideId, nodeId: root.children[1].id })
    expect(duplicated.ok).toBe(true)
    if (!duplicated.ok) return
    const after = contentAt(duplicated.value.presentation, 1).root
    expect(shapes(after)).toEqual(['cn'])
    if (after.kind === 'split') expect(after.weights).toEqual([1, 2])
  })
})
