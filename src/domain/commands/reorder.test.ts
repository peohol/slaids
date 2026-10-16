import { describe, expect, it } from 'vitest'
import { createPresentation } from '../presentation'
import { collectNodes, findNode } from '../layout'
import { computeSlideGeometry } from '../geometry'
import { geometryForTheme } from '../metrics'
import { containerWithDoc } from '../content'
import { paragraphDoc } from '../richdoc'
import type { ContentFitChecker } from '../fit'
import type { LayoutNode, Presentation, SplitNode } from '../types'
import { reorderLayoutNode, setZoneContent, splitLeaf } from './index'
import { contentAt } from '../testDecks'

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

function split(deck: Presentation, nodeId: string, axis: 'x' | 'y', weights: number[]): Presentation {
  return unwrap(splitLeaf(deck, { slideId: contentAt(deck, 1).id, nodeId, axis, weights })).presentation
}

function rootOf(deck: Presentation): SplitNode {
  const root = contentAt(deck, 1).root
  if (root.kind !== 'split') throw new Error('roten skulle vært delt')
  return root
}

/** A slide split into `weights.length` zones, with the zones' ids in order. */
function splitDeck(axis: 'x' | 'y', weights: number[]): { deck: Presentation; slideId: string; ids: string[] } {
  const base = createPresentation({ title: 'Omrokkering' })
  const deck = split(base, contentAt(base, 1).root.id, axis, weights)
  return { deck, slideId: contentAt(deck, 1).id, ids: rootOf(deck).children.map((child) => child.id) }
}

function sizesOf(deck: Presentation, nodes: readonly LayoutNode[]): Map<string, { width: number; height: number }> {
  const geometry = computeSlideGeometry(contentAt(deck, 1), geometryForTheme(deck.theme))
  return new Map(
    nodes.map((node) => {
      const rect = geometry.rects.get(node.id)
      if (!rect) throw new Error(`fant ikke ${node.id}`)
      return [node.id, { width: rect.width, height: rect.height }]
    }),
  )
}

function expectSameSizes(
  a: Map<string, { width: number; height: number }>,
  b: Map<string, { width: number; height: number }>,
): void {
  expect([...b.keys()].sort()).toEqual([...a.keys()].sort())
  for (const [id, size] of a) {
    expect(b.get(id)?.width).toBeCloseTo(size.width, 6)
    expect(b.get(id)?.height).toBeCloseTo(size.height, 6)
  }
}

describe('reorderLayoutNode', () => {
  it('moves a zone together with its own ratio', () => {
    const { deck, slideId, ids } = splitDeck('x', [1, 2, 1])
    const [a, b, c] = ids

    const bFirst = rootOf(unwrap(reorderLayoutNode(deck, { slideId, nodeId: b, toIndex: 0 })).presentation)
    expect(bFirst.children.map((child) => child.id)).toEqual([b, a, c])
    expect(bFirst.weights).toEqual([2, 1, 1])

    const bLast = rootOf(unwrap(reorderLayoutNode(deck, { slideId, nodeId: b, toIndex: 2 })).presentation)
    expect(bLast.children.map((child) => child.id)).toEqual([a, c, b])
    expect(bLast.weights).toEqual([1, 1, 2])
  })

  it('reaches every order, and every zone and nested zone keeps its size', () => {
    const { deck: flat, slideId, ids } = splitDeck('y', [3, 1, 2, 4])
    // A nested split, so "keeps its size" covers a whole subtree too.
    const deck = split(flat, ids[2], 'x', [1, 3])
    const before = sizesOf(deck, collectNodes(contentAt(deck, 1).root))

    for (const nodeId of ids) {
      for (let toIndex = 0; toIndex < ids.length; toIndex += 1) {
        const next = unwrap(reorderLayoutNode(deck, { slideId, nodeId, toIndex })).presentation
        const root = rootOf(next)
        expect(root.children[toIndex].id).toBe(nodeId)
        // The others keep their relative order.
        expect(root.children.map((child) => child.id).filter((id) => id !== nodeId)).toEqual(
          ids.filter((id) => id !== nodeId),
        )
        expect(root.weights[toIndex]).toBe(rootOf(deck).weights[ids.indexOf(nodeId)])
        const nested = findNode(root, ids[2])
        expect(nested?.kind === 'split' && nested.weights).toEqual([1, 3])
        expectSameSizes(before, sizesOf(next, collectNodes(root)))
      }
    }
  })

  it('reorders inside a nested split without touching the outer one', () => {
    const { deck: flat, slideId, ids } = splitDeck('x', [1, 1])
    const deck = split(flat, ids[0], 'y', [1, 2, 3])
    const inner = rootOf(deck).children[0] as SplitNode
    const [p, q, r] = inner.children.map((child) => child.id)

    const next = unwrap(reorderLayoutNode(deck, { slideId, nodeId: r, toIndex: 0 })).presentation
    const moved = rootOf(next).children[0] as SplitNode
    expect(moved.children.map((child) => child.id)).toEqual([r, p, q])
    expect(moved.weights).toEqual([3, 1, 2])
    expect(rootOf(next).weights).toEqual([1, 1])
  })

  it('keeps content and ids where they belong', () => {
    const { deck, slideId, ids } = splitDeck('x', [1, 2])
    const content = containerWithDoc(paragraphDoc('Tekst'))
    const filled = unwrap(setZoneContent(deck, { slideId, nodeId: ids[1], content })).presentation

    const next = rootOf(unwrap(reorderLayoutNode(filled, { slideId, nodeId: ids[1], toIndex: 0 })).presentation)
    const first = next.children[0]
    expect(first.id).toBe(ids[1])
    expect(first.kind === 'leaf' && first.content).toBe(content)
  })

  it('answers a move to where the zone already is with the same document', () => {
    const { deck, slideId, ids } = splitDeck('x', [1, 2])
    expect(unwrap(reorderLayoutNode(deck, { slideId, nodeId: ids[1], toIndex: 1 })).presentation).toBe(deck)
  })

  it('refuses the root, unknown zones and positions outside the split', () => {
    const { deck, slideId, ids } = splitDeck('x', [1, 2, 1])
    const root = contentAt(deck, 1).root.id
    const code = (input: { nodeId: string; toIndex: number }): string | undefined => {
      const result = reorderLayoutNode(deck, { slideId, ...input })
      return result.ok ? undefined : result.error.code
    }
    expect(code({ nodeId: root, toIndex: 0 })).toBe('INVALID_ARGUMENT')
    expect(code({ nodeId: 'nope', toIndex: 0 })).toBe('NODE_NOT_FOUND')
    expect(code({ nodeId: ids[0], toIndex: -1 })).toBe('INVALID_ARGUMENT')
    expect(code({ nodeId: ids[0], toIndex: 3 })).toBe('INVALID_ARGUMENT')
    expect(code({ nodeId: ids[0], toIndex: 1.5 })).toBe('INVALID_ARGUMENT')
  })

  it('is refused when the new order makes content fit worse', () => {
    // A checker that only lets content fit in the left half of the slide —
    // standing in for citation renumbering, which is what can make a reorder
    // hide text in the real deck.
    const leftOnly: ContentFitChecker = (_content, rect) => {
      const overflow = Math.max(0, rect.x + rect.width - 800)
      return { fits: overflow === 0, overflow, parts: {} }
    }
    const { deck, slideId, ids } = splitDeck('x', [1, 1])
    const content = containerWithDoc(paragraphDoc('Tekst'))
    const filled = unwrap(setZoneContent(deck, { slideId, nodeId: ids[0], content })).presentation

    const result = reorderLayoutNode(filled, { slideId, nodeId: ids[0], toIndex: 1, fits: leftOnly })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
  })
})
