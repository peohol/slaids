/**
 * Zone drags that change how much air there is, not only how the room is shared.
 *
 * `ratioDrag.ts` moves boundaries inside one split whose children never change.
 * The gestures here can also *add* negative space beside a group of zones —
 * compressing it, from one side or from both — and use up negative space the
 * author grows content into, until it is gone. They are built on the same
 * pieces and keep the same promises: every frame is one pure function of the
 * state the drag started from and of where the pointer is, a block of zones the
 * gesture scales keeps its insides exactly, and nothing is snapped until the
 * pointer is let go.
 *
 * Everything is measured in design-space pixels along the split rather than in
 * weights, because the number of children can change: a piece of air that
 * appears costs a gap as well as its own length. The trick that keeps that
 * continuous is that air may be *shorter than nothing* while the pointer is
 * down — down to minus one gap, where it takes no room at all (`splitRect`
 * draws it with zero length, and the next zone starts exactly where it would
 * have without it). So air is inserted at that length when the drag starts, in
 * the place it will appear, and grows from there; a zone expanding into air
 * shrinks it through zero to the same point, where it has vanished. Reversing
 * the pointer reverses all of it, because nothing about the structure is
 * decided until release.
 *
 * On release the live layout is a *wish*, and `arrangementCandidates` turns it
 * into the committed layouts closest to it: with or without each piece of air
 * the gesture shrank or created (air too thin to be worth a ratio of its own
 * goes), and whole ratios that keep the scaled blocks' proportions first.
 */

import { MAX_SPLIT_CHILDREN } from '../../domain/constants'
import { createNegativeSpace } from '../../domain/content'
import { computeLayoutRects, splitRect } from '../../domain/geometry'
import { collectLeaves, createLeaf, createSplit, findNode, findParent } from '../../domain/layout'
import { isNegativeSpace } from '../../domain/negativeSpace'
import { proportionalQuantizations, rankedRatioQuantizations } from '../../domain/ratios'
import type { Axis, LayoutNode, NodeId, Rect, SplitNode } from '../../domain/types'

/**
 * One split as a drag sees it: its children, each one's length along the axis
 * when the drag started, and how short each may get.
 */
export interface Span {
  /** The node a preview or a commit replaces: the split, or the zone it wraps. */
  replacedId: NodeId
  /** The split as it is drawn during the drag; its weights are `lengths`. */
  split: SplitNode
  lengths: number[]
  /** The shortest each child may be. Air may fade to minus one gap. */
  floors: number[]
  /** Each child's committed ratio before the drag, `null` for added air. */
  base: (number | null)[]
}

/** Which ends of a block a compression acts on. */
export type BlockSides = 'both' | 'start' | 'end'

/** A run of children `[from, to]`, inclusive. */
export interface Block {
  from: number
  to: number
}

/** The shortest a child may be along `axis`: what its content needs, or air's floor. */
export type FloorOf = (node: LayoutNode) => number

/** A split's span, measured in the rect it has. */
export function spanOfSplit(split: SplitNode, rect: Rect, gap: number, floorOf: FloorOf): Span {
  const along = (r: Rect): number => (split.axis === 'x' ? r.width : r.height)
  return {
    replacedId: split.id,
    split,
    lengths: splitRect(rect, split.axis, split.weights, gap).map(along),
    floors: split.children.map((child) => (isNegativeSpace(child) ? -gap : floorOf(child))),
    base: [...split.weights],
  }
}

/**
 * A zone with nothing beside it along `axis` — the root, or a zone in a split
 * running the other way — as the one child of a new split along `axis`.
 *
 * This is where air goes when a zone is compressed across its parent's
 * direction: not into the parent, whose children sit the other way, but into a
 * split of the right orientation made around the zone, on the zone's own level.
 */
export function wrappedSpan(node: LayoutNode, rect: Rect, axis: Axis, floorOf: FloorOf): Span {
  const along = axis === 'x' ? rect.width : rect.height
  return {
    replacedId: node.id,
    split: createSplit(axis, [along], [node]),
    lengths: [along],
    floors: [floorOf(node)],
    base: [1],
  }
}

/** The run of non-air children around `index` — the block it belongs to. */
export function contentBlockAround(span: Span, index: number): Block {
  const air = span.split.children.map(isNegativeSpace)
  let from = index
  let to = index
  while (from > 0 && !air[from - 1]) from -= 1
  while (to < air.length - 1 && !air[to + 1]) to += 1
  return { from, to }
}

/**
 * The span with a piece of air on each `side` of `block` that does not already
 * have one, inserted at no length at all — so the drawing does not change
 * until the gesture gives it room. Air already there is reused, which is what
 * keeps a repeated compression from stacking air on air.
 *
 * A split that has no room for another child gets none on that side, and a
 * compression towards it simply has nowhere to put the room it frees.
 */
export function withAirBeside(span: Span, block: Block, sides: BlockSides, gap: number): {
  span: Span
  block: Block
} {
  const children = [...span.split.children]
  const lengths = [...span.lengths]
  const floors = [...span.floors]
  const base = [...span.base]
  let { from, to } = block
  const insert = (at: number): void => {
    children.splice(at, 0, createLeaf(createNegativeSpace()))
    lengths.splice(at, 0, -gap)
    floors.splice(at, 0, -gap)
    base.splice(at, 0, null)
  }
  const wantsStart = sides !== 'end'
  const wantsEnd = sides !== 'start'
  if (wantsEnd && !(to + 1 < children.length && isNegativeSpace(children[to + 1]))) {
    if (children.length < MAX_SPLIT_CHILDREN) insert(to + 1)
  }
  if (wantsStart && !(from > 0 && isNegativeSpace(children[from - 1]))) {
    if (children.length < MAX_SPLIT_CHILDREN) {
      insert(from)
      from += 1
      to += 1
    }
  }
  return {
    span: { ...span, split: { ...span.split, children, weights: lengths }, lengths, floors, base },
    block: { from, to },
  }
}

/**
 * The lengths for `block` grown by `change` (negative compresses it), the room
 * it frees or takes back going to the air beside it.
 *
 * The block is scaled by one factor, so the zones in it keep their proportions
 * exactly, and it stops at the first of them to reach its minimum. With
 * `sides: 'both'` the air on each side changes by the same amount, so a
 * centred block stays centred and two unequal pieces of air keep their
 * difference; growing then stops when the smaller piece is gone, rather than
 * carrying on into one side and moving the block. With one side, that side
 * takes the whole change.
 */
export function compressedLengths(
  span: Span,
  block: Block,
  change: number,
  sides: BlockSides,
): number[] | null {
  if (!Number.isFinite(change)) return null
  const { lengths, floors } = span
  const members: number[] = []
  for (let index = block.from; index <= block.to; index += 1) members.push(index)
  const content = members.reduce((sum, index) => sum + lengths[index], 0)
  if (content <= 0) return null

  const airAt = (index: number): number | null =>
    index >= 0 && index < lengths.length && isNegativeSpace(span.split.children[index]) ? index : null
  const receivers = [
    sides === 'end' ? null : airAt(block.from - 1),
    sides === 'start' ? null : airAt(block.to + 1),
  ].filter((index): index is number => index !== null)
  if (receivers.length === 0) return [...lengths]
  const wanted = sides === 'both' ? 2 : 1
  // Symmetric means both sides or not at all: one missing receiver leaves the
  // block nothing it can do symmetrically.
  if (receivers.length < wanted) return [...lengths]

  const floorFactor = Math.max(0, ...members.map((index) => floors[index] / lengths[index]))
  const largestCompression = content * (1 - floorFactor)
  const largestGrowth =
    receivers.length * Math.min(...receivers.map((index) => lengths[index] - floors[index]))
  const applied = Math.max(-largestCompression, Math.min(change, Math.max(0, largestGrowth)))

  const out = [...lengths]
  const factor = (content + applied) / content
  for (const index of members) out[index] = lengths[index] * factor
  for (const index of receivers) out[index] = lengths[index] - applied / receivers.length
  return out
}

/** The split as it is drawn for `lengths`. */
export function previewOf(span: Span, lengths: readonly number[]): SplitNode {
  return { ...span.split, weights: [...lengths] }
}

/** How many layouts per structure the commit is offered. */
const SNAPS_PER_STRUCTURE = 6

/**
 * The committed layouts closest to the live one, best first.
 *
 * Air the gesture created or shrank may be kept or let go; every other child is
 * kept. For each such structure the closest whole ratios are offered — only
 * those that keep each of `groups` (child indices in the span) in exact
 * proportion, when there are any — and structures are ranked by how far the content
 * zones would end up from where the pointer left them, so a sliver of air too
 * thin to be worth a ratio of its own goes, while air the author clearly made
 * stays. A structure with one child left is that child, in place of the split.
 */
export function arrangementCandidates(
  span: Span,
  lengths: readonly number[],
  groups: readonly (readonly number[])[],
  rect: Rect,
  gap: number,
): LayoutNode[] {
  const children = span.split.children
  const optional = children
    .map((_, index) => index)
    .filter(
      (index) =>
        isNegativeSpace(children[index]) &&
        (span.base[index] === null || lengths[index] < span.lengths[index]),
    )
  const live = computeLayoutRects(previewOf(span, lengths), rect, gap)
  const error = (layout: LayoutNode): number => {
    const rects = computeLayoutRects(layout, rect, gap)
    let total = 0
    for (const leaf of collectLeaves(layout)) {
      if (isNegativeSpace(leaf)) continue
      const a = rects.get(leaf.id)
      const b = live.get(leaf.id)
      if (!a || !b) continue
      total +=
        Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height)
    }
    return total
  }

  const structures: Array<{ layouts: LayoutNode[]; best: number }> = []
  for (let mask = 0; mask < 1 << optional.length; mask += 1) {
    const dropped = new Set(optional.filter((_, bit) => mask & (1 << bit)))
    const kept = children.map((_, index) => index).filter((index) => !dropped.has(index))
    if (kept.length > MAX_SPLIT_CHILDREN || kept.length === 0) continue
    const layouts =
      kept.length === 1 ? [children[kept[0]]] : snapped(span, lengths, kept, groups)
    if (layouts.length === 0) continue
    structures.push({ layouts, best: Math.min(...layouts.map(error)) })
  }
  structures.sort((a, b) => a.best - b.best)
  return structures.flatMap((structure) => structure.layouts)
}

/** The closest whole-ratio versions of the span with only `kept` children. */
function snapped(
  span: Span,
  lengths: readonly number[],
  kept: readonly number[],
  groups: readonly (readonly number[])[],
): SplitNode[] {
  const scale = Math.max(...kept.map((index) => Math.abs(lengths[index])), 1)
  // Air kept at no length or less is still air the author keeps: it is offered
  // its smallest ratio by asking for very little of the split.
  const desired = kept.map((index) => Math.max(lengths[index], scale * 1e-6))
  const position = new Map(kept.map((index, at) => [index, at]))
  const base = kept.map((index) => span.base[index] ?? 1)
  const preserved = groups
    .map((group) =>
      group.flatMap((index) => {
        const at = position.get(index)
        return at !== undefined && span.base[index] !== null ? [at] : []
      }),
    )
    .filter((members) => members.length > 1)

  const children = kept.map((index) => span.split.children[index])
  // A block the gesture promised to keep in proportion is held to it on the
  // snap as well: the plain ladder would gladly bend it for a closer total.
  const layouts =
    preserved.length > 0
      ? proportionalQuantizations(desired, base, preserved, SNAPS_PER_STRUCTURE)
      : rankedRatioQuantizations(desired, SNAPS_PER_STRUCTURE)
  return layouts.map((weights) => ({ ...span.split, children, weights }))
}

/** The indices of a block, in order. */
export function blockMembers(block: Block): number[] {
  return Array.from({ length: block.to - block.from + 1 }, (_, offset) => block.from + offset)
}

/**
 * The block a press on the divider after child `boundary` compresses: the run
 * of content on either side of it, or — beside air — the content it borders.
 */
export function blockAtBoundary(span: Span, boundary: number): Block {
  const children = span.split.children
  return contentBlockAround(span, isNegativeSpace(children[boundary]) ? boundary + 1 : boundary)
}

/** An edge of a zone: across which axis it lies, and at which end. */
export interface EdgeGrip {
  axis: Axis
  side: 'start' | 'end'
}

/**
 * The outer edges of the zone `nodeId` that can be dragged inwards to compress
 * it — every edge that does not border other content in the zone's own split.
 *
 * An edge along the parent's direction is the edge of the block the zone
 * belongs to, so it has a grip when the block ends there: at the split's own
 * edge, or at air. An edge across it has nothing beside it at this level, so it
 * always does — compressing it wraps the zone in a split of the right
 * orientation. Air itself has no grips: there is nothing in it to compress.
 */
export function edgeGrips(root: LayoutNode, nodeId: NodeId): EdgeGrip[] {
  const node = findNode(root, nodeId)
  if (!node || isNegativeSpace(node)) return []
  const parent = findParent(root, nodeId)
  const index = parent ? parent.children.findIndex((child) => child.id === nodeId) : -1
  const grips: EdgeGrip[] = []
  for (const axis of ['x', 'y'] as const) {
    for (const side of ['start', 'end'] as const) {
      if (!parent || parent.axis !== axis) {
        grips.push({ axis, side })
        continue
      }
      const neighbour = parent.children[side === 'start' ? index - 1 : index + 1]
      if (!neighbour || isNegativeSpace(neighbour)) grips.push({ axis, side })
    }
  }
  return grips
}
