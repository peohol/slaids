/**
 * Immutable layout-tree utilities.
 *
 * Nothing here mutates its input. Every operation returns a new tree, which is
 * what makes snapshot-based undo/redo and React rendering safe.
 */

import { bodyOf, withBody } from './content'
import { newContentId, newNodeId, newSubfieldId } from './ids'
import { MAX_SPLIT_CHILDREN, MAX_ZONE_RATIO, MIN_SPLIT_CHILDREN, MIN_ZONE_RATIO } from './constants'
import { areWeightsValid } from './geometry'
import { areRatiosQuantized, quantizeRatios } from './ratios'
import type { LayoutNode, LeafNode, NodeId, SplitNode, ZoneContent, Axis } from './types'

export function createLeaf(content: ZoneContent | null = null): LeafNode {
  return { id: newNodeId(), kind: 'leaf', content }
}

export function createSplit(axis: Axis, weights: number[], children: LayoutNode[]): SplitNode {
  return { id: newNodeId(), kind: 'split', axis, weights: [...weights], children }
}

export function isSplit(node: LayoutNode): node is SplitNode {
  return node.kind === 'split'
}

export function isLeaf(node: LayoutNode): node is LeafNode {
  return node.kind === 'leaf'
}

/* ------------------------------------------------------------------ *
 * Traversal
 * ------------------------------------------------------------------ */

export function walkNodes(root: LayoutNode, visit: (node: LayoutNode, depth: number) => void): void {
  const go = (node: LayoutNode, depth: number): void => {
    visit(node, depth)
    if (node.kind === 'split') for (const child of node.children) go(child, depth + 1)
  }
  go(root, 0)
}

export function collectNodes(root: LayoutNode): LayoutNode[] {
  const out: LayoutNode[] = []
  walkNodes(root, (node) => out.push(node))
  return out
}

export function collectLeaves(root: LayoutNode): LeafNode[] {
  const out: LeafNode[] = []
  walkNodes(root, (node) => {
    if (node.kind === 'leaf') out.push(node)
  })
  return out
}

export function findNode(root: LayoutNode, id: NodeId): LayoutNode | null {
  let found: LayoutNode | null = null
  walkNodes(root, (node) => {
    if (node.id === id) found = node
  })
  return found
}

export function findLeaf(root: LayoutNode, id: NodeId): LeafNode | null {
  const node = findNode(root, id)
  return node && node.kind === 'leaf' ? node : null
}

export function findSplit(root: LayoutNode, id: NodeId): SplitNode | null {
  const node = findNode(root, id)
  return node && node.kind === 'split' ? node : null
}

export function findParent(root: LayoutNode, id: NodeId): SplitNode | null {
  let parent: SplitNode | null = null
  walkNodes(root, (node) => {
    if (node.kind === 'split' && node.children.some((child) => child.id === id)) {
      parent = node
    }
  })
  return parent
}

/** Ids from the root down to (and including) `id`, or `null` when not found. */
export function pathToNode(root: LayoutNode, id: NodeId): NodeId[] | null {
  const go = (node: LayoutNode, trail: NodeId[]): NodeId[] | null => {
    const next = [...trail, node.id]
    if (node.id === id) return next
    if (node.kind === 'split') {
      for (const child of node.children) {
        const result = go(child, next)
        if (result) return result
      }
    }
    return null
  }
  return go(root, [])
}

/** Human-facing breadcrumb, e.g. `Rot > 2 > 1`. */
export function breadcrumbLabels(root: LayoutNode, id: NodeId): string[] {
  const path = pathToNode(root, id)
  if (!path) return []
  const labels: string[] = ['Rot']
  for (let i = 1; i < path.length; i += 1) {
    const parent = findNode(root, path[i - 1])
    if (!parent || parent.kind !== 'split') continue
    const index = parent.children.findIndex((child) => child.id === path[i])
    labels.push(String(index + 1))
  }
  return labels
}

export function depthOf(root: LayoutNode, id: NodeId): number {
  const path = pathToNode(root, id)
  return path ? path.length - 1 : -1
}

/* ------------------------------------------------------------------ *
 * Immutable edits
 * ------------------------------------------------------------------ */

/** Replace the node with `id` by `replacement`, returning a new tree. */
export function replaceNode(
  root: LayoutNode,
  id: NodeId,
  replacement: LayoutNode,
): LayoutNode {
  if (root.id === id) return replacement
  if (root.kind !== 'split') return root
  let changed = false
  const children = root.children.map((child) => {
    const next = replaceNode(child, id, replacement)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...root, children } : root
}

/** Apply `update` to the node with `id`, returning a new tree. */
export function updateNode(
  root: LayoutNode,
  id: NodeId,
  update: (node: LayoutNode) => LayoutNode,
): LayoutNode {
  const target = findNode(root, id)
  if (!target) return root
  return replaceNode(root, id, update(target))
}

export interface RemoveResult {
  root: LayoutNode
  removed: LayoutNode
}

/**
 * Remove a node from the tree. The parent keeps the remaining children's
 * weights, so surviving siblings expand proportionally, and a split left with a
 * single child collapses into that child.
 */
export function removeNode(root: LayoutNode, id: NodeId): RemoveResult | null {
  if (root.id === id) return null
  const parent = findParent(root, id)
  if (!parent) return null
  const index = parent.children.findIndex((child) => child.id === id)
  if (index < 0) return null
  const removed = parent.children[index]
  const children = parent.children.filter((_, i) => i !== index)
  const weights = parent.weights.filter((_, i) => i !== index)
  const nextParent: LayoutNode =
    children.length === 1 ? children[0] : { ...parent, children, weights }
  return { root: normalizeTree(replaceNode(root, parent.id, nextParent)), removed }
}

/**
 * Bring a tree back to canonical form: weights match children, invalid weights
 * are repaired, empty splits become leaves and single-child splits collapse.
 */
export function normalizeTree(root: LayoutNode): LayoutNode {
  if (root.kind === 'leaf') return root

  const children = root.children.map(normalizeTree)
  if (children.length === 0) return { id: root.id, kind: 'leaf', content: null }
  if (children.length === 1) return children[0]

  const weights: number[] = []
  for (let i = 0; i < children.length; i += 1) {
    const w = root.weights[i]
    weights.push(Number.isFinite(w) && w > 0 ? w : 1)
  }

  const unchanged =
    children.length === root.children.length &&
    children.every((child, i) => child === root.children[i]) &&
    weights.length === root.weights.length &&
    weights.every((w, i) => w === root.weights[i])

  return unchanged ? root : { ...root, children, weights }
}

/**
 * A copy of the tree whose splits carry whole ratios.
 *
 * For a tree that already obeys the rule this returns the very same object, so
 * it costs nothing on the paths where it cannot matter. It exists for the one
 * place a layout arrives from outside rather than from a command — `addSlide`
 * takes a root, for the editor's templates but also for any headless caller —
 * and that door is exactly where the invariant would otherwise be walked past.
 * Splits whose weights are not usable at all are left alone for validation to
 * report; this rewrites numbers, it does not rebuild trees.
 */
export function withQuantizedRatios(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return node
  const children = node.children.map(withQuantizedRatios)
  const usable = node.weights.length === node.children.length && areWeightsValid(node.weights)
  const weights =
    usable && !areRatiosQuantized(node.weights) ? quantizeRatios(node.weights) : node.weights
  const unchanged =
    weights === node.weights && children.every((child, index) => child === node.children[index])
  return unchanged ? node : { ...node, weights, children }
}

/** Deep clone a subtree with brand new ids for every node, content and subfield. */
export function cloneSubtreeWithNewIds(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') {
    return {
      id: newNodeId(),
      kind: 'leaf',
      content: node.content ? cloneContentWithNewIds(node.content) : null,
    }
  }
  return {
    id: newNodeId(),
    kind: 'split',
    axis: node.axis,
    weights: [...node.weights],
    children: node.children.map(cloneSubtreeWithNewIds),
  }
}

/**
 * Deep clone zone content with new ids. Asset references are preserved.
 *
 * Every id inside has to be new, and *every* kind that has a body has one: a
 * plain text zone is a container whose payload is a `CardBody`, with subfields
 * addressable by id exactly like a card's. Asking `bodyOf`/`withBody` rather
 * than listing the kinds is what makes that true by construction — the two
 * card kinds spelled out here left a text zone's subfields sharing their ids
 * with the original, so a copy was not independent and a caller handed those
 * ids back was handed the source's.
 *
 * A file reference is deliberately not renewed: a file is not duplicated by
 * being shown in two places.
 */
export function cloneContentWithNewIds(content: ZoneContent): ZoneContent {
  const base = structuredCloneSafe(content)
  base.id = newContentId()
  const body = bodyOf(base)
  if (!body) return base
  // `base` is already a deep clone, so only the ids are left to replace.
  return withBody(base, {
    ...body,
    subfields: body.subfields.map((field) => ({ ...field, id: newSubfieldId() })),
  })
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

/** Layout-only copy of a tree: structure is preserved, all content is dropped. */
export function stripContent(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return { id: newNodeId(), kind: 'leaf', content: null }
  return {
    id: newNodeId(),
    kind: 'split',
    axis: node.axis,
    weights: [...node.weights],
    children: node.children.map(stripContent),
  }
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export function countContent(node: LayoutNode): number {
  let count = 0
  walkNodes(node, (current) => {
    if (current.kind === 'leaf' && current.content) count += 1
  })
  return count
}

export function collectContent(node: LayoutNode): ZoneContent[] {
  const out: ZoneContent[] = []
  walkNodes(node, (current) => {
    if (current.kind === 'leaf' && current.content) out.push(current.content)
  })
  return out
}

export function hasContent(node: LayoutNode): boolean {
  return countContent(node) > 0
}

/* ------------------------------------------------------------------ *
 * Hierarchy navigation
 * ------------------------------------------------------------------ */

export function parentIdOf(root: LayoutNode, id: NodeId): NodeId | null {
  return findParent(root, id)?.id ?? null
}

export function firstChildIdOf(root: LayoutNode, id: NodeId): NodeId | null {
  const node = findNode(root, id)
  if (!node || node.kind !== 'split') return null
  return node.children[0]?.id ?? null
}

/** Sibling navigation with wraparound, as specified for the arrow keys. */
export function siblingIdOf(root: LayoutNode, id: NodeId, direction: -1 | 1): NodeId | null {
  const parent = findParent(root, id)
  if (!parent) return null
  const index = parent.children.findIndex((child) => child.id === id)
  if (index < 0) return null
  const count = parent.children.length
  const next = (index + direction + count) % count
  return parent.children[next].id
}

/* ------------------------------------------------------------------ *
 * Invariant checking
 * ------------------------------------------------------------------ */

export interface TreeViolation {
  nodeId: NodeId
  message: string
}

export function validateTree(root: LayoutNode): TreeViolation[] {
  const violations: TreeViolation[] = []
  const seen = new Set<NodeId>()
  walkNodes(root, (node) => {
    if (seen.has(node.id)) {
      violations.push({ nodeId: node.id, message: 'Duplicate node id' })
    }
    seen.add(node.id)
    if (node.kind === 'split') {
      if (node.children.length !== node.weights.length) {
        violations.push({ nodeId: node.id, message: 'children.length !== weights.length' })
      }
      if (node.children.length < MIN_SPLIT_CHILDREN) {
        violations.push({ nodeId: node.id, message: 'split has fewer than 2 children' })
      }
      if (node.children.length > MAX_SPLIT_CHILDREN) {
        violations.push({ nodeId: node.id, message: 'split has more than 10 children' })
      }
      // The same predicate the commands and the geometry engine use, rather
      // than a second copy of it here: a stored tree whose weights `splitRect`
      // would refuse has to be reported as broken, not measured — see
      // `findSlideIssues`, which skips the geometry when the tree is.
      if (!areWeightsValid(node.weights)) {
        violations.push({ nodeId: node.id, message: 'weights must be finite, > 0 and sum to a finite number' })
      } else if (!areRatiosQuantized(node.weights)) {
        // A committed layout is written in whole ratios. The geometry engine
        // would happily measure decimals — the drag preview feeds it nothing
        // else — but a *stored* tree carrying them is one the commands could
        // not have produced, so it is reported rather than quietly measured.
        violations.push({
          nodeId: node.id,
          message: `weights must be whole numbers between ${MIN_ZONE_RATIO} and ${MAX_ZONE_RATIO}`,
        })
      }
    }
  })
  return violations
}
