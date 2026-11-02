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
import { createLeaf, createSplit, findNode, validateTree, walkNodes } from './layout'
import { isNegativeSpace, mergeNegativeSpace } from './negativeSpace'
import { createPresentation } from './presentation'
import { airMeetsAir, contentAt } from './testDecks'
import type { LayoutNode, Presentation } from './types'

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
    const group = createSplit('x', [2, 3], [createSplit('x', [1, 4], [n1, a]), b])
    const merged = mergeNegativeSpace(createSplit('x', [1, 6], [n0, group]))
    expect(merged.kind).toBe('split')
    if (merged.kind !== 'split') return
    expect(merged.children[0].id).toBe(n0.id)
    expect(shapes(merged)).toEqual(['nc', 'cc'])
    expect(merged.children[1].id).toBe(group.id)
    expect(validateTree(merged)).toEqual([])
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

  it('never leaves two pieces of air on one edge, and keeps every tree valid', () => {
    const random = makeRandom(1102)
    for (let run = 0; run < 300; run += 1) {
      const merged = mergeNegativeSpace(randomTree(random, 3))
      expect(validateTree(merged)).toEqual([])
      for (const shape of shapes(merged)) expect(shape).not.toContain('nn')
      expect(airMeetsAir(merged)).toBe(false)
      expect(mergeNegativeSpace(merged)).toBe(merged)
    }
    // Three hundred trees, most of them rewritten to whole ratios more than once.
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
