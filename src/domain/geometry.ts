/**
 * Pure geometry engine.
 *
 * This module is the single source of truth for where anything is on a slide.
 * It is deterministic, framework-free and used by rendering, hit-testing,
 * fit validation and (later) API-side validation alike.
 *
 * The global gap invariant is solved arithmetically here: a split subtracts
 * `gap * (n - 1)` from the available length before distributing the remainder
 * by weight, and structural nodes never introduce padding of their own. That is
 * why nesting can never double a gap.
 */

import {
  GEOMETRY_EPSILON,
  G,
  MIN_ZONE_HEIGHT,
  MIN_ZONE_WIDTH,
  SLIDE_HEIGHT,
  SLIDE_INSET,
  SLIDE_WIDTH,
  TITLE_ZONE_HEIGHT,
} from './constants'
import type { Axis, LayoutNode, NodeId, Rect, Slide } from './types'

export const TITLE_NODE_ID = '__title__'

export interface SlideGeometry {
  /** Rect of the deterministic title zone, or `null` when the slide has none. */
  titleRect: Rect | null
  /** Rect of the layout tree root. */
  mainRect: Rect
  /** Rect for every node in the layout tree, keyed by node id. */
  rects: Map<NodeId, Rect>
}

export interface Size {
  width: number
  height: number
}

export interface GeometryOptions {
  gap?: number
  slideWidth?: number
  slideHeight?: number
  inset?: number
  titleHeight?: number
  minZoneWidth?: number
  minZoneHeight?: number
}

interface ResolvedOptions {
  gap: number
  slideWidth: number
  slideHeight: number
  inset: number
  titleHeight: number
  minZoneWidth: number
  minZoneHeight: number
}

export function resolveOptions(options: GeometryOptions = {}): ResolvedOptions {
  return {
    gap: options.gap ?? G,
    slideWidth: options.slideWidth ?? SLIDE_WIDTH,
    slideHeight: options.slideHeight ?? SLIDE_HEIGHT,
    inset: options.inset ?? SLIDE_INSET,
    titleHeight: options.titleHeight ?? TITLE_ZONE_HEIGHT,
    minZoneWidth: options.minZoneWidth ?? MIN_ZONE_WIDTH,
    minZoneHeight: options.minZoneHeight ?? MIN_ZONE_HEIGHT,
  }
}

/* ------------------------------------------------------------------ *
 * Rect helpers
 * ------------------------------------------------------------------ */

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

export function rectRight(r: Rect): number {
  return r.x + r.width
}

export function rectBottom(r: Rect): number {
  return r.y + r.height
}

export function rectContainsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= rectRight(r) && y >= r.y && y <= rectBottom(r)
}

export function rectsApproximatelyEqual(a: Rect, b: Rect, epsilon = GEOMETRY_EPSILON): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  )
}

/** True when `inner` lies inside `outer`, allowing for floating point noise. */
export function rectContainsRect(outer: Rect, inner: Rect, epsilon = GEOMETRY_EPSILON): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    rectRight(inner) <= rectRight(outer) + epsilon &&
    rectBottom(inner) <= rectBottom(outer) + epsilon
  )
}

/* ------------------------------------------------------------------ *
 * Weights
 * ------------------------------------------------------------------ */

export function areWeightsValid(weights: readonly number[]): boolean {
  if (weights.length === 0) return false
  return weights.every((w) => Number.isFinite(w) && w > 0)
}

export function sumWeights(weights: readonly number[]): number {
  return weights.reduce((total, w) => total + w, 0)
}

/**
 * Split a rect along `axis` into `weights.length` children separated by exactly
 * `gap`.
 *
 * Child boundaries are derived from cumulative weight fractions rather than by
 * accumulating individual child lengths, so rounding error cannot drift and the
 * final child always ends exactly on the parent's edge.
 */
export function splitRect(
  source: Rect,
  axis: Axis,
  weights: readonly number[],
  gap: number,
): Rect[] {
  if (!areWeightsValid(weights)) {
    throw new Error('splitRect: weights must all be finite and greater than zero')
  }
  const count = weights.length
  const total = sumWeights(weights)
  const along = axis === 'x' ? source.width : source.height
  const usable = along - gap * (count - 1)
  const origin = axis === 'x' ? source.x : source.y

  const result: Rect[] = []
  let cumulative = 0
  for (let i = 0; i < count; i += 1) {
    const start = origin + (usable * cumulative) / total + gap * i
    cumulative += weights[i]
    const end = origin + (usable * cumulative) / total + gap * i
    const length = end - start
    result.push(
      axis === 'x'
        ? { x: start, y: source.y, width: length, height: source.height }
        : { x: source.x, y: start, width: source.width, height: length },
    )
  }
  return result
}

/* ------------------------------------------------------------------ *
 * Layout tree geometry
 * ------------------------------------------------------------------ */

/** Compute the rect of every node in a layout subtree. */
export function computeLayoutRects(
  node: LayoutNode,
  rootRect: Rect,
  gap: number = G,
): Map<NodeId, Rect> {
  const rects = new Map<NodeId, Rect>()
  const visit = (current: LayoutNode, area: Rect): void => {
    rects.set(current.id, area)
    if (current.kind === 'split') {
      const childRects = splitRect(area, current.axis, current.weights, gap)
      for (let i = 0; i < current.children.length; i += 1) {
        visit(current.children[i], childRects[i])
      }
    }
  }
  visit(node, rootRect)
  return rects
}

/** Rect of the title zone (or `null`) for a slide with the given options. */
export function computeTitleRect(hasTitle: boolean, options: GeometryOptions = {}): Rect | null {
  const o = resolveOptions(options)
  if (!hasTitle) return null
  return {
    x: o.inset,
    y: o.inset,
    width: o.slideWidth - o.inset * 2,
    height: o.titleHeight,
  }
}

/** Rect of the main layout area, accounting for the optional title zone. */
export function computeMainRect(hasTitle: boolean, options: GeometryOptions = {}): Rect {
  const o = resolveOptions(options)
  const contentWidth = o.slideWidth - o.inset * 2
  const contentHeight = o.slideHeight - o.inset * 2
  if (!hasTitle) {
    return { x: o.inset, y: o.inset, width: contentWidth, height: contentHeight }
  }
  return {
    x: o.inset,
    y: o.inset + o.titleHeight + o.gap,
    width: contentWidth,
    height: contentHeight - o.titleHeight - o.gap,
  }
}

/** Full geometry for a slide: title rect, main rect and every node rect. */
export function computeSlideGeometry(slide: Slide, options: GeometryOptions = {}): SlideGeometry {
  const o = resolveOptions(options)
  const hasTitle = slide.title !== null
  const titleRect = computeTitleRect(hasTitle, o)
  const mainRect = computeMainRect(hasTitle, o)
  const rects = computeLayoutRects(slide.root, mainRect, o.gap)
  if (titleRect) rects.set(TITLE_NODE_ID, titleRect)
  return { titleRect, mainRect, rects }
}

/* ------------------------------------------------------------------ *
 * Minimum size analysis
 * ------------------------------------------------------------------ */

/**
 * The smallest rect a subtree can occupy while every leaf inside it still
 * satisfies the minimum zone size.
 *
 * For a split along an axis, the binding constraint is the child that needs the
 * largest share: `usable >= minLength_i * sum(weights) / weights[i]`.
 */
export function minimumSizeFor(node: LayoutNode, options: GeometryOptions = {}): Size {
  const o = resolveOptions(options)
  if (node.kind === 'leaf') {
    return { width: o.minZoneWidth, height: o.minZoneHeight }
  }
  const total = sumWeights(node.weights)
  const childSizes = node.children.map((child) => minimumSizeFor(child, o))
  const count = node.children.length

  if (node.axis === 'x') {
    let usable = 0
    let height = 0
    for (let i = 0; i < count; i += 1) {
      usable = Math.max(usable, (childSizes[i].width * total) / node.weights[i])
      height = Math.max(height, childSizes[i].height)
    }
    return { width: usable + o.gap * (count - 1), height }
  }

  let usable = 0
  let width = 0
  for (let i = 0; i < count; i += 1) {
    usable = Math.max(usable, (childSizes[i].height * total) / node.weights[i])
    width = Math.max(width, childSizes[i].width)
  }
  return { width, height: usable + o.gap * (count - 1) }
}

export function rectSatisfiesMinimum(r: Rect, options: GeometryOptions = {}): boolean {
  const o = resolveOptions(options)
  return (
    r.width >= o.minZoneWidth - GEOMETRY_EPSILON && r.height >= o.minZoneHeight - GEOMETRY_EPSILON
  )
}

/** Whether a subtree can legally be placed into `area`. */
export function subtreeFitsInRect(
  node: LayoutNode,
  area: Rect,
  options: GeometryOptions = {},
): boolean {
  const min = minimumSizeFor(node, options)
  return (
    area.width >= min.width - GEOMETRY_EPSILON && area.height >= min.height - GEOMETRY_EPSILON
  )
}

export interface SplitPreview {
  childRects: Rect[]
  /** Indices of children that would be smaller than the minimum zone size. */
  tooSmall: number[]
  valid: boolean
}

/**
 * Preview the geometry of a proposed split without touching the tree.
 * `existingChildren` lets an edit of an existing split validate that nested
 * subtrees still fit into their new allocation.
 */
export function previewSplit(
  area: Rect,
  axis: Axis,
  weights: readonly number[],
  options: GeometryOptions = {},
  existingChildren?: readonly (LayoutNode | null)[],
): SplitPreview {
  const o = resolveOptions(options)
  if (!areWeightsValid(weights)) {
    return { childRects: [], tooSmall: [], valid: false }
  }
  const childRects = splitRect(area, axis, weights, o.gap)
  const tooSmall: number[] = []
  for (let i = 0; i < childRects.length; i += 1) {
    const child = existingChildren?.[i]
    const fits = child
      ? subtreeFitsInRect(child, childRects[i], o)
      : rectSatisfiesMinimum(childRects[i], o)
    if (!fits) tooSmall.push(i)
  }
  return { childRects, tooSmall, valid: tooSmall.length === 0 }
}

/* ------------------------------------------------------------------ *
 * Hit-testing
 * ------------------------------------------------------------------ */

interface DepthEntry {
  id: NodeId
  depth: number
}

function collectDepths(node: LayoutNode, depth: number, out: DepthEntry[]): void {
  out.push({ id: node.id, depth })
  if (node.kind === 'split') {
    for (const child of node.children) collectDepths(child, depth + 1, out)
  }
}

/**
 * Find the deepest node whose rect contains the point.
 *
 * A point inside the gap between siblings is contained by the parent rect but by
 * none of the child rects, so the parent wins naturally — this is how a super
 * zone is targeted through the gap, with no z-index tricks.
 */
export function hitTestLayout(
  root: LayoutNode,
  rects: ReadonlyMap<NodeId, Rect>,
  x: number,
  y: number,
): NodeId | null {
  const entries: DepthEntry[] = []
  collectDepths(root, 0, entries)
  let best: NodeId | null = null
  let bestDepth = -1
  for (const entry of entries) {
    const area = rects.get(entry.id)
    if (!area) continue
    if (rectContainsPoint(area, x, y) && entry.depth > bestDepth) {
      best = entry.id
      bestDepth = entry.depth
    }
  }
  return best
}

/** Convert a viewport point into slide coordinates given the stage rect and scale. */
export function viewportToSlide(
  clientX: number,
  clientY: number,
  stage: { left: number; top: number },
  scale: number,
): { x: number; y: number } {
  return { x: (clientX - stage.left) / scale, y: (clientY - stage.top) / scale }
}

/** Uniform scale factor to fit the logical slide inside an available box. */
export function fitScale(
  availableWidth: number,
  availableHeight: number,
  options: GeometryOptions = {},
): number {
  const o = resolveOptions(options)
  if (availableWidth <= 0 || availableHeight <= 0) return 0
  return Math.min(availableWidth / o.slideWidth, availableHeight / o.slideHeight)
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface GeometryViolation {
  nodeId: NodeId
  kind: 'outside-parent' | 'outside-slide' | 'below-minimum' | 'negative-size'
  detail: string
}

/**
 * Verify the structural geometry invariants for a slide: nothing escapes its
 * parent, nothing escapes the slide, and no rect is degenerate.
 */
export function validateSlideGeometry(
  slide: Slide,
  options: GeometryOptions = {},
): GeometryViolation[] {
  const o = resolveOptions(options)
  const geometry = computeSlideGeometry(slide, o)
  const slideRect = rect(0, 0, o.slideWidth, o.slideHeight)
  const violations: GeometryViolation[] = []

  const visit = (node: LayoutNode, parentRect: Rect | null): void => {
    const area = geometry.rects.get(node.id)
    if (!area) return
    if (area.width < -GEOMETRY_EPSILON || area.height < -GEOMETRY_EPSILON) {
      violations.push({ nodeId: node.id, kind: 'negative-size', detail: 'Negative dimensions' })
    }
    if (parentRect && !rectContainsRect(parentRect, area)) {
      violations.push({ nodeId: node.id, kind: 'outside-parent', detail: 'Escapes parent rect' })
    }
    if (!rectContainsRect(slideRect, area)) {
      violations.push({ nodeId: node.id, kind: 'outside-slide', detail: 'Escapes the slide' })
    }
    if (node.kind === 'leaf' && !rectSatisfiesMinimum(area, o)) {
      violations.push({ nodeId: node.id, kind: 'below-minimum', detail: 'Below minimum zone size' })
    }
    if (node.kind === 'split') {
      for (const child of node.children) visit(child, area)
    }
  }

  visit(slide.root, geometry.mainRect)
  return violations
}

/** All gaps between adjacent siblings, useful for asserting the global invariant. */
export function measureSiblingGaps(
  node: LayoutNode,
  rects: ReadonlyMap<NodeId, Rect>,
): number[] {
  const gaps: number[] = []
  const visit = (current: LayoutNode): void => {
    if (current.kind !== 'split') return
    for (let i = 0; i < current.children.length - 1; i += 1) {
      const a = rects.get(current.children[i].id)
      const b = rects.get(current.children[i + 1].id)
      if (!a || !b) continue
      gaps.push(current.axis === 'x' ? b.x - rectRight(a) : b.y - rectBottom(a))
    }
    for (const child of current.children) visit(child)
  }
  visit(node)
  return gaps
}
