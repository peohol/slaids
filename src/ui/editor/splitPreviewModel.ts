/**
 * What the split dialog's preview draws, worked out from the proposed tree.
 *
 * The dialog edits exactly one level of the zone tree: the split of the target
 * zone into its *direct* children. Everything below those children is kept as
 * it is and only shown for context. The preview therefore draws two kinds of
 * thing, and this module is the one place that decides which is which:
 *
 *  - **zones** — the direct children, numbered 1…N in the order of the fields
 *    that set their ratios. They are what «Bruk» gives new rects.
 *  - **dividers** — where a direct child (or something deeper) is itself split,
 *    one line down the middle of each gap between its children. A divider and
 *    not a frame: the outer edges of those children coincide with the edges of
 *    the direct child, so a frame per descendant would draw a second, dashed
 *    border on top of the solid one and make a split child look like one more
 *    zone being edited.
 *
 * Every rect comes from `computeLayoutRects` on the proposal — the same
 * recursive geometry, gap and quantised weights the command will commit — so
 * nothing here is a second layout engine. It only names and sorts what the
 * engine returned, in the target zone's own coordinates (its top-left is 0, 0).
 */

import { computeLayoutRects } from '../../domain/geometry'
import type { LayoutNode, Rect, SplitNode } from '../../domain/types'

export interface Size {
  width: number
  height: number
}

/** A direct child of the target: a zone the dialog is giving a new rect. */
export interface PreviewZone {
  /** 0-based, the index of its ratio field. */
  index: number
  /** «1», «2» … — what the preview and the fields call it. */
  label: string
  rect: Rect
  /** The minimum-size check says what this child holds would not fit. */
  tooSmall: boolean
  /** The leaf zones inside it that are kept as they are; 0 when it is a leaf itself. */
  keptZones: number
}

/** A boundary inside a direct child: structure that is kept, drawn for context. */
export interface PreviewDivider {
  /** 2 for a boundary between grandchildren of the target, 3 below that, and so on. */
  depth: number
  x1: number
  y1: number
  x2: number
  y2: number
}

/** A leaf below the direct children, named by its path from the target («2.1»). */
export interface PreviewContextZone {
  label: string
  depth: number
  rect: Rect
}

export interface SplitPreviewModel {
  size: Size
  zones: PreviewZone[]
  dividers: PreviewDivider[]
  context: PreviewContextZone[]
}

function leafCount(node: LayoutNode): number {
  return node.kind === 'leaf' ? 1 : node.children.reduce((total, child) => total + leafCount(child), 0)
}

/**
 * The preview of `proposal` split over a target of `size`.
 *
 * `tooSmall` is the minimum-size verdict on the direct children, as
 * `previewSplit` gives it; the geometry is drawn either way, so a refused
 * proposal is still shown — with the offending zones marked — rather than
 * replaced by a message.
 */
export function splitPreviewModel(
  proposal: SplitNode,
  size: Size,
  gap: number,
  tooSmall: readonly number[] = [],
): SplitPreviewModel {
  const rects = computeLayoutRects(proposal, { x: 0, y: 0, ...size }, gap)
  const rectOf = (node: LayoutNode): Rect => rects.get(node.id) as Rect
  const dividers: PreviewDivider[] = []
  const context: PreviewContextZone[] = []

  const visit = (node: LayoutNode, path: string[]): void => {
    if (node.kind === 'leaf') {
      if (path.length > 1) context.push({ label: path.join('.'), depth: path.length, rect: rectOf(node) })
      return
    }
    const area = rectOf(node)
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i]
      if (i > 0) {
        // Half-way across the gap: the end of the previous child and the start
        // of this one, whatever the gap is.
        const before = rectOf(node.children[i - 1])
        const after = rectOf(child)
        if (node.axis === 'x') {
          const x = (before.x + before.width + after.x) / 2
          dividers.push({ depth: path.length + 1, x1: x, y1: area.y, x2: x, y2: area.y + area.height })
        } else {
          const y = (before.y + before.height + after.y) / 2
          dividers.push({ depth: path.length + 1, x1: area.x, y1: y, x2: area.x + area.width, y2: y })
        }
      }
      visit(child, [...path, String(i + 1)])
    }
  }

  const zones = proposal.children.map((child, index): PreviewZone => {
    visit(child, [String(index + 1)])
    return {
      index,
      label: String(index + 1),
      rect: rectOf(child),
      tooSmall: tooSmall.includes(index),
      keptZones: child.kind === 'split' ? leafCount(child) : 0,
    }
  })

  return { size, zones, dividers, context }
}

/**
 * The uniform scale that fits `content` inside `box`, in both directions.
 *
 * Contain, never cover: the preview keeps the target's true aspect ratio and
 * leaves the spare room empty, however tall or wide the target is. Zero when
 * either has no area yet — nothing is drawn until the box has been measured.
 */
export function containScale(box: Size, content: Size): number {
  if (box.width <= 0 || box.height <= 0 || content.width <= 0 || content.height <= 0) return 0
  return Math.min(box.width / content.width, box.height / content.height)
}
