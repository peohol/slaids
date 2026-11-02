/**
 * One zone drag, from the press to the commit, without the pointer handlers.
 *
 * The stage owns the events and the measuring; everything a drag *decides* is
 * here, as plain functions of the state captured when it started, so every
 * gesture can be tested the way it is performed. There are three places a drag
 * can start, and what each one does is chosen by the direction the hand first
 * moves (`zoneDragMode`) and by Shift, read once at the press:
 *
 * | Pressed on                 | Along the split            | Across the split               |
 * | -------------------------- | -------------------------- | ------------------------------ |
 * | the gap between two zones  | move that boundary         | compress the block, both sides |
 * |   … with Shift             | rescale the two halves     | (as without Shift)             |
 * | inside a zone              | slide the zone             | resize it in proportion        |
 * | a zone's outer edge        | compress from that side    |                                |
 * |   … with Shift             | compress from both sides   |                                |
 *
 * The operation is fixed for the rest of the drag: passing over another zone,
 * or pressing or letting go of Shift, does not change what is being done.
 *
 * Distances are in design-space pixels throughout. See `spanDrag.ts` for how
 * air appears and disappears without a jump, and `ratioDrag.ts` for the
 * gestures that only share out the room a split already has.
 */

import { collectNodes, findNode, findParent, findSplit } from '../../domain/layout'
import { isNegativeSpace } from '../../domain/negativeSpace'
import { splitRect } from '../../domain/geometry'
import type { Axis, LayoutNode, NodeId, Rect } from '../../domain/types'
import type { StructuralOutcome } from '../../domain/commands'
import type { Result } from '../../domain/result'
import {
  boundarySnapRules,
  firstAccepted,
  draggedWeights,
  range,
  resizedWeights,
  shiftedBoundarySnapRules,
  shiftedBoundaryWeights,
  translatedWeights,
  zoneDragAmount,
  zoneDragMode,
  zoneSnapRules,
  type SnapRules,
  type ZoneDragMode,
} from './ratioDrag'
import {
  arrangementCandidates,
  blockAtBoundary,
  blockMembers,
  compressedLengths,
  contentBlockAround,
  previewOf,
  spanOfSplit,
  withAirBeside,
  wrappedSpan,
  type Block,
  type BlockSides,
  type FloorOf,
  type Span,
} from './spanDrag'

/** Where a drag was started, as the stage reports the press. */
export type ZoneDragStart =
  | { kind: 'boundary'; splitId: NodeId; boundary: number; shift: boolean }
  | { kind: 'zone'; splitId: NodeId; index: number }
  | { kind: 'edge'; nodeId: NodeId; axis: Axis; side: 'start' | 'end'; shift: boolean }

/** What the drag turned out to be doing, once it is doing anything. */
export type ZoneDragOperation =
  | 'boundary'
  | 'shift-boundary'
  | 'compress'
  | 'compress-one-side'
  | 'resize'
  | 'translate'

export interface ZoneDrag {
  start: ZoneDragStart
  /** `null` until the movement says which operation it is. */
  operation: ZoneDragOperation | null
  span: Span
  /** The rect of the node `span.replacedId` names. */
  rect: Rect
  gap: number
  /** The block a compression scales; `null` for the other operations. */
  block: Block | null
  sides: BlockSides | null
}

/** What the scene needs to start a drag: the tree, its rects, and what fits where. */
export interface ZoneDragContext {
  root: LayoutNode
  rects: ReadonlyMap<NodeId, Rect>
  gap: number
  /** The shortest a node may be along an axis, for what it holds. */
  minimumAlong: (node: LayoutNode, axis: Axis) => number
}

export function startZoneDrag(context: ZoneDragContext, start: ZoneDragStart): ZoneDrag | null {
  const { root, rects, gap, minimumAlong } = context
  const floorFor = (axis: Axis): FloorOf => (node) => minimumAlong(node, axis)

  if (start.kind !== 'edge') {
    const split = findSplit(root, start.splitId)
    const rect = rects.get(start.splitId)
    if (!split || !rect) return null
    const span = spanOfSplit(split, rect, gap, floorFor(split.axis))
    return { start, operation: null, span, rect, gap, block: null, sides: null }
  }

  const node = findNode(root, start.nodeId)
  const rect = rects.get(start.nodeId)
  if (!node || !rect) return null
  const parent = findParent(root, start.nodeId)
  const sides: BlockSides = start.shift ? 'both' : start.side
  const operation: ZoneDragOperation = start.shift ? 'compress' : 'compress-one-side'
  if (parent && parent.axis === start.axis) {
    const parentRect = rects.get(parent.id)
    if (!parentRect) return null
    const base = spanOfSplit(parent, parentRect, gap, floorFor(parent.axis))
    const index = parent.children.findIndex((child) => child.id === node.id)
    const prepared = withAirBeside(base, contentBlockAround(base, index), sides, gap)
    return { start, operation, rect: parentRect, gap, ...prepared, sides }
  }
  const base = wrappedSpan(node, rect, start.axis, floorFor(start.axis))
  const prepared = withAirBeside(base, { from: 0, to: 0 }, sides, gap)
  return { start, operation, rect, gap, ...prepared, sides }
}

/**
 * The live lengths for a pointer `deltaX`/`deltaY` design-space pixels from the
 * press, or `null` while the movement does not mean anything yet.
 *
 * The first movement big enough to mean something decides the operation, and
 * the drag keeps it; a boundary that turns out to be compressing its block gets
 * its air at that moment, before the first frame that shows it.
 */
export function liveLengths(drag: ZoneDrag, deltaX: number, deltaY: number): number[] | null {
  const { start } = drag
  if (start.kind === 'edge') {
    const along = start.axis === 'x' ? deltaX : deltaY
    const inward = start.side === 'start' ? along : -along
    return drag.block && drag.sides
      ? compressedLengths(drag.span, drag.block, start.shift ? -2 * inward : -inward, drag.sides)
      : null
  }

  const axis = drag.span.split.axis
  const mode: ZoneDragMode | null = operationMode(drag) ?? zoneDragMode(axis, deltaX, deltaY)
  if (!mode) return null
  if (!drag.operation) decide(drag, mode)
  // Read after deciding: a compression gets its air at that moment.
  const { span } = drag

  const along = axis === 'x' ? deltaX : deltaY
  switch (drag.operation) {
    case 'boundary':
      return start.kind === 'boundary'
        ? draggedWeights(span.lengths, start.boundary, along, span.floors)
        : null
    case 'shift-boundary':
      return start.kind === 'boundary'
        ? shiftedBoundaryWeights(span.lengths, start.boundary, along, span.floors)
        : null
    case 'compress':
      return drag.block
        ? compressedLengths(span, drag.block, zoneDragAmount(axis, 'resize', deltaX, deltaY), 'both')
        : null
    case 'translate':
      return start.kind === 'zone'
        ? translatedWeights(span.lengths, start.index, along, span.floors)
        : null
    case 'resize':
      return start.kind === 'zone'
        ? resizedWeights(span.lengths, start.index, zoneDragAmount(axis, 'resize', deltaX, deltaY), span.floors)
        : null
    default:
      return null
  }
}

/** The operation's direction, once it has one. */
function operationMode(drag: ZoneDrag): ZoneDragMode | null {
  switch (drag.operation) {
    case null:
      return null
    case 'boundary':
    case 'shift-boundary':
    case 'translate':
      return 'translate'
    default:
      return 'resize'
  }
}

function decide(drag: ZoneDrag, mode: ZoneDragMode): void {
  const { start } = drag
  if (start.kind === 'zone') {
    drag.operation = mode
    return
  }
  if (start.kind !== 'boundary') return
  if (mode === 'translate') {
    drag.operation = start.shift ? 'shift-boundary' : 'boundary'
    return
  }
  const prepared = withAirBeside(drag.span, blockAtBoundary(drag.span, start.boundary), 'both', drag.gap)
  drag.span = prepared.span
  drag.block = prepared.block
  drag.sides = 'both'
  drag.operation = 'compress'
}

/** The drag's split as it should be drawn for `lengths`, and what it replaces. */
export function previewFor(drag: ZoneDrag, lengths: readonly number[]): { nodeId: NodeId; node: LayoutNode } {
  return { nodeId: drag.span.replacedId, node: previewOf(drag.span, lengths) }
}

/** The ids of the zones the drag is acting on as one, for drawing them as one. */
export function manipulatedIds(drag: ZoneDrag): NodeId[] {
  const children = drag.span.split.children
  const { start } = drag
  if (drag.block) return blockMembers(drag.block).map((index) => children[index].id)
  if (start.kind === 'zone') return [children[start.index].id]
  return []
}

/**
 * What releasing the drag commits.
 *
 * A drag that only shared out a split's room is a ratio change and is snapped
 * by the rules `ratioDrag.ts` has for it. One that involved air — added it,
 * shrank it, or wrapped a zone to make room for it — is a rearrangement, and
 * is offered as whole layouts closest first.
 */
export type ZoneDragRelease =
  | { kind: 'ratios'; nodeId: NodeId; released: number[]; rules: SnapRules }
  | { kind: 'arrangement'; nodeId: NodeId; original: LayoutNode; candidates: LayoutNode[] }

export function releaseOf(drag: ZoneDrag, lengths: readonly number[]): ZoneDragRelease | null {
  const { span, start } = drag
  const released = [...lengths]
  if (!changesAir(drag, released)) {
    const before = span.base as number[]
    const rules =
      start.kind === 'boundary'
        ? drag.operation === 'shift-boundary'
          ? shiftedBoundarySnapRules(before, start.boundary, released)
          : boundarySnapRules(before, start.boundary)
        : start.kind === 'zone' && (drag.operation === 'resize' || drag.operation === 'translate')
          ? zoneSnapRules(before, start.index, drag.operation, released)
          : null
    return rules ? { kind: 'ratios', nodeId: span.split.id, released, rules } : null
  }
  const original = findOriginal(span)
  return {
    kind: 'arrangement',
    nodeId: span.replacedId,
    original,
    candidates: arrangementCandidates(span, released, preservedGroups(drag), drag.rect, drag.gap),
  }
}

/**
 * Whether a release touches air: a compression, which always gives room to air,
 * a split made for the drag, air added to it, or air it shrank — which may be
 * gone. Anything else is a ratio change.
 */
function changesAir(drag: ZoneDrag, lengths: readonly number[]): boolean {
  const { span } = drag
  return (
    drag.operation === 'compress' ||
    drag.operation === 'compress-one-side' ||
    span.replacedId !== span.split.id ||
    span.base.some((ratio) => ratio === null) ||
    span.split.children.some((child, index) => isNegativeSpace(child) && lengths[index] < span.lengths[index])
  )
}

/** The node the span replaces, as it was before the drag. */
function findOriginal(span: Span): LayoutNode {
  if (span.replacedId !== span.split.id) {
    return span.split.children.find((child) => child.id === span.replacedId) ?? span.split
  }
  return {
    ...span.split,
    children: span.split.children.filter((_, index) => span.base[index] !== null),
    weights: span.base.filter((ratio): ratio is number => ratio !== null),
  }
}

/** Which children the operation promised to keep in proportion. */
function preservedGroups(drag: ZoneDrag): number[][] {
  const count = drag.span.split.children.length
  const { start } = drag
  switch (drag.operation) {
    case 'compress':
    case 'compress-one-side':
      return drag.block ? [blockMembers(drag.block)] : []
    case 'shift-boundary':
      return start.kind === 'boundary'
        ? [range(0, start.boundary + 1), range(start.boundary + 1, count)]
        : []
    case 'resize':
      return start.kind === 'zone' ? [range(0, count).filter((index) => index !== start.index)] : []
    default:
      return []
  }
}

/**
 * The rect each of the drag's children has for `lengths`, by node id — the
 * stage measures content against these.
 */
export function childRects(drag: ZoneDrag, lengths: readonly number[]): Map<NodeId, Rect> {
  const rects = splitRect(drag.rect, drag.span.split.axis, lengths, drag.gap)
  return new Map(drag.span.split.children.map((child, index) => [child.id, rects[index]]))
}

/** Whether two layouts are the same arrangement: same nodes, same ratios. */
export function sameLayout(a: LayoutNode, b: LayoutNode): boolean {
  const shape = (node: LayoutNode): string =>
    collectNodes(node)
      .map((entry) =>
        entry.kind === 'split'
          ? `${entry.id}:${entry.axis}:${entry.weights.join(',')}:${entry.children.length}`
          : `${entry.id}:${isNegativeSpace(entry) ? 'n' : 'c'}`,
      )
      .join('|')
  return shape(a) === shape(b)
}

/** Commit the first of a release's layouts that `attempt` accepts. */
export function commitArrangement(
  candidates: readonly LayoutNode[],
  attempt: (layout: LayoutNode) => Result<StructuralOutcome>,
): Result<StructuralOutcome> {
  return firstAccepted(candidates, attempt)
}
