import { describe, expect, it } from 'vitest'
import {
  breadcrumbLabels,
  cloneSubtreeWithNewIds,
  collectContent,
  collectLeaves,
  countContent,
  createLeaf,
  createSplit,
  depthOf,
  findParent,
  firstChildIdOf,
  normalizeTree,
  parentIdOf,
  pathToNode,
  removeNode,
  replaceNode,
  siblingIdOf,
  stripContent,
  validateTree,
  withQuantizedRatios,
} from './layout'
import { createTitledCard, createUntitledCard } from './content'
import type { LayoutNode, SplitNode } from './types'

describe('normalizeTree', () => {
  it('collapses a split left with a single child', () => {
    const only = createLeaf()
    const split: SplitNode = { id: 'split', kind: 'split', axis: 'x', weights: [1], children: [only] }
    expect(normalizeTree(split)).toBe(only)
  })

  it('turns an empty split into an empty leaf', () => {
    const split: SplitNode = { id: 'split', kind: 'split', axis: 'x', weights: [], children: [] }
    const normalized = normalizeTree(split)
    expect(normalized.kind).toBe('leaf')
    expect(normalized.id).toBe('split')
  })

  it('repairs invalid weights', () => {
    const split: SplitNode = {
      id: 'split',
      kind: 'split',
      axis: 'x',
      weights: [0, Number.NaN],
      children: [createLeaf(), createLeaf()],
    }
    const normalized = normalizeTree(split) as SplitNode
    expect(normalized.weights).toEqual([1, 1])
  })

  it('pads missing weights', () => {
    const split: SplitNode = {
      id: 'split',
      kind: 'split',
      axis: 'y',
      weights: [2],
      children: [createLeaf(), createLeaf(), createLeaf()],
    }
    const normalized = normalizeTree(split) as SplitNode
    expect(normalized.weights).toEqual([2, 1, 1])
  })

  it('is identity for an already canonical tree', () => {
    const tree = createSplit('x', [1, 2], [createLeaf(), createLeaf()])
    expect(normalizeTree(tree)).toBe(tree)
  })

  it('collapses nested single-child splits recursively', () => {
    const bottom = createLeaf()
    const inner: SplitNode = { id: 'i', kind: 'split', axis: 'x', weights: [1], children: [bottom] }
    const outer: SplitNode = { id: 'o', kind: 'split', axis: 'y', weights: [1], children: [inner] }
    expect(normalizeTree(outer)).toBe(bottom)
  })
})

describe('removeNode', () => {
  it('keeps surviving siblings and their weights', () => {
    const a = createLeaf()
    const b = createLeaf()
    const c = createLeaf()
    const root = createSplit('x', [1, 2, 3], [a, b, c])
    const result = removeNode(root, b.id)
    expect(result).not.toBeNull()
    const next = result?.root as SplitNode
    expect(next.kind).toBe('split')
    expect(next.children.map((child) => child.id)).toEqual([a.id, c.id])
    expect(next.weights).toEqual([1, 3])
  })

  it('collapses the parent when only one child remains', () => {
    const a = createLeaf()
    const b = createLeaf()
    const root = createSplit('x', [1, 1], [a, b])
    const result = removeNode(root, b.id)
    expect(result?.root.id).toBe(a.id)
  })

  it('refuses to remove the root', () => {
    const root = createSplit('x', [1, 1], [createLeaf(), createLeaf()])
    expect(removeNode(root, root.id)).toBeNull()
  })

  it('returns the removed subtree so its content can be rescued', () => {
    const withCard = createLeaf(createUntitledCard())
    const root = createSplit('x', [1, 1], [withCard, createLeaf()])
    const result = removeNode(root, withCard.id)
    expect(collectContent(result?.removed as LayoutNode)).toHaveLength(1)
  })
})

describe('navigation', () => {
  const c1 = createLeaf()
  const c2 = createLeaf()
  const c3 = createLeaf()
  const inner = createSplit('y', [1, 1, 1], [c1, c2, c3])
  const other = createLeaf()
  const root = createSplit('x', [1, 1], [inner, other])

  it('finds the parent of a node', () => {
    expect(parentIdOf(root, c2.id)).toBe(inner.id)
    expect(parentIdOf(root, root.id)).toBeNull()
    expect(findParent(root, inner.id)?.id).toBe(root.id)
  })

  it('walks down to the first child', () => {
    expect(firstChildIdOf(root, root.id)).toBe(inner.id)
    expect(firstChildIdOf(root, c1.id)).toBeNull()
  })

  it('wraps around siblings in both directions', () => {
    expect(siblingIdOf(root, c1.id, 1)).toBe(c2.id)
    expect(siblingIdOf(root, c3.id, 1)).toBe(c1.id)
    expect(siblingIdOf(root, c1.id, -1)).toBe(c3.id)
  })

  it('builds a breadcrumb path', () => {
    expect(breadcrumbLabels(root, c2.id)).toEqual(['Rot', '1', '2'])
    expect(breadcrumbLabels(root, other.id)).toEqual(['Rot', '2'])
    expect(pathToNode(root, c3.id)).toEqual([root.id, inner.id, c3.id])
    expect(depthOf(root, c3.id)).toBe(2)
  })
})

describe('cloning and stripping', () => {
  it('regenerates every id when cloning', () => {
    const original = createSplit('x', [1, 1], [createLeaf(createTitledCard('Tittel')), createLeaf()])
    const copy = cloneSubtreeWithNewIds(original)
    const originalIds = new Set(collectLeaves(original).map((node) => node.id))
    for (const node of collectLeaves(copy)) expect(originalIds.has(node.id)).toBe(false)
    expect(countContent(copy)).toBe(1)
  })

  it('keeps content values while replacing content ids', () => {
    const card = createTitledCard('Tittel')
    const original = createLeaf(card)
    const copy = cloneSubtreeWithNewIds(original)
    const copied = collectContent(copy)[0]
    expect(copied.id).not.toBe(card.id)
    expect(copied.kind).toBe('titled-card')
  })

  it('drops all content when stripping for a template', () => {
    const original = createSplit('x', [1, 2], [createLeaf(createUntitledCard()), createLeaf()])
    const stripped = stripContent(original)
    expect(countContent(stripped)).toBe(0)
    expect((stripped as SplitNode).weights).toEqual([1, 2])
  })
})

describe('replaceNode', () => {
  it('returns the same object when nothing matched', () => {
    const root = createSplit('x', [1, 1], [createLeaf(), createLeaf()])
    expect(replaceNode(root, 'missing', createLeaf())).toBe(root)
  })

  it('replaces deep inside the tree without touching siblings', () => {
    const target = createLeaf()
    const sibling = createLeaf()
    const inner = createSplit('y', [1, 1], [target, sibling])
    const root = createSplit('x', [1, 1], [inner, createLeaf()])
    const replacement = createLeaf(createUntitledCard())
    const next = replaceNode(root, target.id, replacement) as SplitNode
    const nextInner = next.children[0] as SplitNode
    expect(nextInner.children[0].id).toBe(replacement.id)
    expect(nextInner.children[1]).toBe(sibling)
  })
})

describe('validateTree', () => {
  it('accepts a canonical tree', () => {
    expect(validateTree(createSplit('x', [1, 1], [createLeaf(), createLeaf()]))).toEqual([])
  })

  it('rejects mismatched weights', () => {
    const bad: SplitNode = {
      id: 'x',
      kind: 'split',
      axis: 'x',
      weights: [1],
      children: [createLeaf(), createLeaf()],
    }
    expect(validateTree(bad)).toHaveLength(1)
  })

  it('rejects a split with more than ten children', () => {
    const children = Array.from({ length: 11 }, () => createLeaf())
    const bad = createSplit('x', children.map(() => 1), children)
    expect(validateTree(bad).some((v) => v.message.includes('more than 10'))).toBe(true)
  })

  it('detects duplicate node ids', () => {
    const shared = createLeaf()
    const bad = createSplit('x', [1, 1], [shared, shared])
    expect(validateTree(bad).some((v) => v.message === 'Duplicate node id')).toBe(true)
  })

  it('rejects ratios that are not whole numbers on the ladder', () => {
    for (const weights of [[1.5, 2], [0.5, 0.5], [1, 11], [12, 1]]) {
      const bad = createSplit('x', weights, [createLeaf(), createLeaf()])
      expect(
        validateTree(bad).some((violation) => violation.message.includes('whole numbers')),
        weights.join(':'),
      ).toBe(true)
    }
  })
})

describe('withQuantizedRatios', () => {
  it('gives back the very same tree when every ratio is already whole', () => {
    const tree = createSplit('x', [1, 2], [createLeaf(), createSplit('y', [3, 1], [createLeaf(), createLeaf()])])
    expect(withQuantizedRatios(tree)).toBe(tree)
  })

  it('rewrites ratios anywhere in the tree, keeping the layout', () => {
    const inner = createSplit('y', [0.25, 0.75], [createLeaf(), createLeaf()])
    const tree = createSplit('x', [1.5, 2.5], [createLeaf(), inner])
    const fixed = withQuantizedRatios(tree)
    if (fixed.kind !== 'split') throw new Error('expected a split')
    expect(fixed.weights).toEqual([3, 5])
    const child = fixed.children[1]
    if (child.kind !== 'split') throw new Error('expected a nested split')
    expect(child.weights).toEqual([1, 3])
    expect(validateTree(fixed)).toEqual([])
  })

  it('leaves a split it cannot read alone, for validation to report', () => {
    const broken: SplitNode = {
      id: 'x',
      kind: 'split',
      axis: 'x',
      weights: [0.5],
      children: [createLeaf(), createLeaf()],
    }
    expect(withQuantizedRatios(broken)).toBe(broken)
  })
})
