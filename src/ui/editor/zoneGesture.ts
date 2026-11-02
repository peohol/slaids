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
 * | inside a zone              | slide the zone ¹           | resize it in proportion ²      |
 * | a zone's outer edge        | compress from that side    |                                |
 * |   … with Shift             | compress from both sides   |                                |
 *
 * ¹ A zone at either end of its split has nowhere to slide. The same movement
 *   then compresses it across its split instead — the direction it fills
 *   completely — with air on both sides (`n : a : n`), in a split of that
 *   direction made around it. The coupling is the one a resize in that split
 *   uses (a row grows upwards), so the drag that follows, inside the zone that
 *   now has air beside it, carries on doing the same thing.
 * ² The root has no split and no siblings to resize against; it is treated as
 *   the one zone of a row, so both movements compress it, each in its own
 *   direction.
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
import { equalityKeysForDrag, equalityKeysForZoneDrag, equalityKeysForZoneResize } from '../../domain/ratios'
import { splitRect } from '../../domain/geometry'
import type { Axis, LayoutNode, NodeId, Rect } from '../../domain/types'
import {
  boundarySnapRules,
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
  ownSpan,
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
  | { kind: 'zone'; nodeId: NodeId }
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
  /** Where a pressed zone sits in `span`; `null` for the other starts. */
  index: number | null
  /** What a pressed zone that cannot slide compresses instead: see the table. */
  across: { span: Span; rect: Rect } | null
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

  const idle = { operation: null, gap, block: null, sides: null, index: null, across: null }

  if (start.kind === 'boundary') {
    const split = findSplit(root, start.splitId)
    const rect = rects.get(start.splitId)
    if (!split || !rect) return null
    return { ...idle, start, span: spanOfSplit(split, rect, gap, floorFor(split.axis)), rect }
  }

  if (start.kind === 'zone') {
    const node = findNode(root, start.nodeId)
    const rect = rects.get(start.nodeId)
    if (!node || !rect) return null
    const parent = findParent(root, start.nodeId)
    const parentRect = parent ? rects.get(parent.id) : rect
    if (!parentRect) return null
    const axis = parent?.axis ?? 'x'
    const across = otherAxis(axis)
    return {
      ...idle,
      start,
      span: parent ? spanOfSplit(parent, parentRect, gap, floorFor(axis)) : wrappedSpan(node, rect, axis, floorFor(axis)),
      rect: parentRect,
      index: parent ? parent.children.findIndex((child) => child.id === node.id) : 0,
      across: { span: wrappedSpan(node, rect, across, floorFor(across)), rect },
    }
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
    return { ...idle, start, operation, rect: parentRect, ...prepared, sides }
  }
  const own = ownSpan(node, rect, start.axis, gap, floorFor(start.axis))
  const prepared = withAirBeside(own.span, own.block, sides, gap)
  return { ...idle, start, operation, rect, ...prepared, sides }
}

function otherAxis(axis: Axis): Axis {
  return axis === 'x' ? 'y' : 'x'
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

  const mode: ZoneDragMode | null = operationMode(drag) ?? zoneDragMode(drag.span.split.axis, deltaX, deltaY)
  if (!mode) return null
  if (!drag.operation) decide(drag, mode)
  // Read after deciding: a compression gets its air, and perhaps a split of
  // its own, at that moment.
  const { span, index } = drag
  const axis = span.split.axis

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
      return index !== null ? translatedWeights(span.lengths, index, along, span.floors) : null
    case 'resize':
      return index !== null
        ? resizedWeights(span.lengths, index, zoneDragAmount(axis, 'resize', deltaX, deltaY), span.floors)
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
  const { start, index, across } = drag
  if (start.kind === 'zone' && index !== null) {
    const count = drag.span.split.children.length
    // Nothing to resize against: the zone is compressed where it is.
    if (mode === 'resize' && count === 1) compress(drag, drag.span, { from: 0, to: 0 }, drag.rect)
    // Nowhere to slide: the same movement compresses it across its split.
    else if (mode === 'translate' && (index === 0 || index === count - 1) && across) {
      compress(drag, across.span, { from: 0, to: 0 }, across.rect)
    } else drag.operation = mode
    return
  }
  if (start.kind !== 'boundary') return
  if (mode === 'translate') {
    drag.operation = start.shift ? 'shift-boundary' : 'boundary'
    return
  }
  compress(drag, drag.span, blockAtBoundary(drag.span, start.boundary), drag.rect)
}

/** Turn `drag` into a symmetric compression of `block` in `span`, with air beside it. */
function compress(drag: ZoneDrag, span: Span, block: Block, rect: Rect): void {
  const prepared = withAirBeside(span, block, 'both', drag.gap)
  drag.span = prepared.span
  drag.block = prepared.block
  drag.rect = rect
  drag.sides = 'both'
  drag.operation = 'compress'
}

/** The drag's split as it should be drawn for `lengths`, and what it replaces. */
export function previewFor(drag: ZoneDrag, lengths: readonly number[]): { nodeId: NodeId; node: LayoutNode } {
  return { nodeId: drag.span.replacedId, node: previewOf(drag.span, lengths) }
}

/**
 * What the slide shows while the pointer is down: `node` drawn in place of
 * `nodeId`. For a drag that touches air, `commit` is the layout letting go
 * stores — the one shown — or `null` when letting go stores nothing.
 */
export type ZoneDragView =
  | { kind: 'ratios'; nodeId: NodeId; node: LayoutNode }
  | { kind: 'arrangement'; nodeId: NodeId; node: LayoutNode; commit: LayoutNode | null }

/**
 * What the slide shows while the pointer is at `lengths`.
 *
 * A drag that only shares out a split's room follows the hand exactly and is
 * snapped when it is let go (`previewFor`). One that adds, grows or uses up air
 * is shown as the layout its release stores, so it moves in visible steps and
 * letting go changes nothing on the slide: whole ratios up to `MAX_ZONE_RATIO`
 * cannot hold air thinner than a twelfth of a split beside one zone, and a
 * preview that drew thinner air would promise a layout the release could not
 * keep.
 *
 * The layout shown is the nearest of `arrangementCandidates` that `accepts` —
 * the very command the release runs, with the same fit checks — so a step is
 * never shown that would hide content or be refused on release. Where none
 * nearer than the layout the drag started from is accepted, that layout is
 * what is shown, and letting go stores nothing.
 */
export function shownFor(
  drag: ZoneDrag,
  lengths: readonly number[],
  accepts: (nodeId: NodeId, layout: LayoutNode) => boolean,
): ZoneDragView {
  const release = releaseOf(drag, lengths)
  if (release?.kind !== 'arrangement') return { kind: 'ratios', ...previewFor(drag, lengths) }
  const { nodeId, original } = release
  for (const candidate of release.candidates) {
    if (sameLayout(candidate, original)) break
    if (accepts(nodeId, candidate)) return { kind: 'arrangement', nodeId, node: candidate, commit: candidate }
  }
  return { kind: 'arrangement', nodeId, node: original, commit: null }
}

/** The ids of the zones the drag is acting on as one, for drawing them as one. */
export function manipulatedIds(drag: ZoneDrag): NodeId[] {
  const children = drag.span.split.children
  if (drag.block) return blockMembers(drag.block).map((index) => children[index].id)
  return drag.index !== null ? [children[drag.index].id] : []
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
  const { span } = drag
  const released = [...lengths]
  if (!changesAir(drag, released)) {
    const rules = snapRulesFor(drag, released)
    return rules ? { kind: 'ratios', nodeId: span.split.id, released, rules } : null
  }
  const keys = equalityKeysFor(drag)
  const original = findOriginal(span)
  return {
    kind: 'arrangement',
    nodeId: span.replacedId,
    original,
    candidates: arrangementCandidates(
      span,
      released,
      preservedGroups(drag),
      drag.rect,
      drag.gap,
      mirroredAir(drag),
      keys && arrangementKeys(span, keys),
    ),
  }
}

/** The snap rules `ratioDrag.ts` has for a drag that only shares out its split's room. */
function snapRulesFor(drag: ZoneDrag, released: readonly number[]): SnapRules | null {
  const { span, start, operation, index } = drag
  const before = span.base as number[]
  if (start.kind === 'boundary') {
    return operation === 'shift-boundary'
      ? shiftedBoundarySnapRules(before, start.boundary, released)
      : boundarySnapRules(before, start.boundary)
  }
  return index !== null && (operation === 'resize' || operation === 'translate')
    ? zoneSnapRules(before, index, operation, released)
    : null
}

/**
 * Which zones a drag that shares out a split's room keeps sharing a ratio —
 * the keys its own snap rules use — or `null` for a gesture that has none: a
 * compression, Shift on a divider (whose blocks keep their proportions
 * instead), and a split with air the drag made.
 */
function equalityKeysFor(drag: ZoneDrag): (number | string | null)[] | null {
  const { span, start, operation, index } = drag
  if (span.base.some((ratio) => ratio === null)) return null
  const before = span.base as number[]
  if (start.kind === 'boundary' && operation === 'boundary') return equalityKeysForDrag(before, start.boundary)
  if (index === null) return null
  if (operation === 'resize') return equalityKeysForZoneResize(before, index)
  return operation === 'translate' ? equalityKeysForZoneDrag(before, index) : null
}

/**
 * A gesture's equality keys, for a release that changes air: zones it keeps
 * sharing a ratio go on sharing one, but only with zones of their own kind —
 * air is scaled by its footprint and content by its length (see `scaled`), so
 * a piece of air and a zone that happened to be written down as the same
 * number are no longer the same size.
 */
function arrangementKeys(
  span: Span,
  keys: readonly (number | string | null)[],
): (string | null)[] {
  return keys.map((key, index) =>
    key === null ? null : `${isNegativeSpace(span.split.children[index]) ? 'n' : 'c'}:${key}`,
  )
}

/**
 * Whether a release touches air: a compression, which always gives room to air,
 * a split made for the drag, air added to it, or air it grew or shrank — which
 * may be gone. All of these are shown and stored in the steps a whole ratio
 * can hold air in (`shownFor`). Anything else is a ratio change.
 */
function changesAir(drag: ZoneDrag, lengths: readonly number[]): boolean {
  const { span } = drag
  return (
    drag.operation === 'compress' ||
    drag.operation === 'compress-one-side' ||
    span.replacedId !== span.split.id ||
    span.base.some((ratio) => ratio === null) ||
    span.split.children.some(
      (child, index) => isNegativeSpace(child) && Math.abs(lengths[index] - span.lengths[index]) > AIR_UNCHANGED,
    )
  )
}

/** How far, in design pixels, air may move by rounding alone and still be the air it was. */
const AIR_UNCHANGED = 1e-6

/**
 * The air on either side of a symmetric compression's block, when the two are
 * one another's mirror image: made together, or equal when the drag began.
 */
function mirroredAir(drag: ZoneDrag): [number, number] | null {
  const { block, sides, span } = drag
  if (!block || sides !== 'both') return null
  const pair: [number, number] = [block.from - 1, block.to + 1]
  const [start, end] = pair.map((index) => span.split.children[index])
  if (!start || !end || !isNegativeSpace(start) || !isNegativeSpace(end)) return null
  return span.base[pair[0]] === span.base[pair[1]] ? pair : null
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
  const { children } = drag.span.split
  const count = children.length
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
      // The content beside the zone keeps its proportions; air is free to go.
      return drag.index !== null
        ? [range(0, count).filter((index) => index !== drag.index && !isNegativeSpace(children[index]))]
        : []
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

/** One string per arrangement: same nodes, same ratios, same string. */
export function layoutKey(node: LayoutNode): string {
  return collectNodes(node)
    .map((entry) =>
      entry.kind === 'split'
        ? `${entry.id}:${entry.axis}:${entry.weights.join(',')}:${entry.children.length}`
        : `${entry.id}:${isNegativeSpace(entry) ? 'n' : 'c'}`,
    )
    .join('|')
}

/** Whether two layouts are the same arrangement: same nodes, same ratios. */
export function sameLayout(a: LayoutNode, b: LayoutNode): boolean {
  return layoutKey(a) === layoutKey(b)
}
