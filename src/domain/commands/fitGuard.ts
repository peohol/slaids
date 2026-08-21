/**
 * The content-fit gate.
 *
 * `overflow: hidden` is the last visual safety net, not the rule. The rule is
 * that a legal editing operation may never end with previously visible content
 * hidden. There are two distinct questions behind that, and this module owns
 * the second one:
 *
 *  1. **Placement** — may this content go into that rect? Absolute, answered by
 *     the commands that place content (`setZoneContent`, `moveZoneContent`,
 *     `placeSandboxItem`, `splitLeaf`) by calling the fit checker directly.
 *
 *  2. **Regression** — does this change make content that already lives on a
 *     slide fit *worse*? That is what a font swap, a ratio change, a subfield
 *     count, an axis flip or a card-type conversion can do, and it is what this
 *     module answers.
 *
 * A regression, not an absolute failure, is the right test for (2) because
 * content can legitimately be overflowing already — an imported document, an
 * image that finished loading, a font chosen before this rule existed.
 * Refusing every change to such a zone would make it unrepairable. So: never
 * worse is allowed, worse is not.
 *
 * Everything here is headless and takes the checkers as arguments, so a REST or
 * MCP caller gets exactly the same rules without going through the UI.
 *
 * Which command is in which category — the full list, so a new command is added
 * to it deliberately rather than by omission:
 *
 *  - **Regression-gated** (calls `guardFit`): every command that funnels through
 *    `updateZoneContent` (`setContentKind`, `setContainerPayload`,
 *    `setSubfieldCount`, `setBodyAxis`, `setBodyWeights`, `setCardTitle`,
 *    `setSubfieldDoc`, `setContainerDoc`, `setCardColor`), plus `setTheme`,
 *    `setSlideTitle`, `setSlideHasTitle`, `updateSplit` / `setSplitWeights`.
 *  - **Placement-gated** (calls the checker directly): `setZoneContent`,
 *    `moveZoneContent`, `canAcceptContent`, `splitLeaf`, `placeSandboxItem`,
 *    `addSlide`.
 *  - **Cannot shrink anything, deliberately ungated**: `deleteSlide`,
 *    `duplicateSlide` (same content, same geometry), `moveSlide`,
 *    `setPresentationTitle`, `setFolder`, `deleteLayoutNode`,
 *    `clearLayoutNode`, every sandbox command that only removes content from a
 *    slide, every idea command, and every asset command. Gating these would
 *    only make an already-overflowing document harder to repair.
 *  - **Knowingly out of scope**: `addReference` / `updateReference` change the
 *    derived citation numbers, so a zone's text can grow by a character or two
 *    when a citation goes from `[9]` to `[10]`. Refusing to add a reference for
 *    that would be worse than the clipping it prevents, and the derived
 *    reference slides repaginate themselves. `deleteReference` only removes
 *    text, so it is safe by construction.
 */

import { computeLayoutRects, computeSlideGeometry, TITLE_NODE_ID } from '../geometry'
import { collectLeaves } from '../layout'
import { FIT_TOLERANCE, G } from '../constants'
import { sameFitRelevantTheme } from '../fit'
import { err, ok, type Result } from '../result'
import type { LayoutNode, NodeId, Presentation, PresentationTheme, Rect, Slide } from '../types'
import type { StructuralOptions } from './types'

export interface OverflowEntry {
  nodeId: NodeId
  overflow: number
  previousOverflow: number
}

export interface FitRegression extends OverflowEntry {
  slideId: string
}

/**
 * Overflow per node for every content-bearing leaf in a subtree placed at
 * `area`. Used both by the slide-level measurement below and by previews that
 * ask about a rect the subtree does not occupy yet.
 */
export function subtreeOverflow(
  node: LayoutNode,
  area: Rect,
  theme: PresentationTheme,
  options: StructuralOptions = {},
): Map<NodeId, number> {
  const overflow = new Map<NodeId, number>()
  if (!options.fits) return overflow
  const rects = computeLayoutRects(node, area, options.geometry?.gap ?? G)
  for (const leaf of collectLeaves(node)) {
    if (!leaf.content) continue
    const rect = rects.get(leaf.id)
    if (!rect) continue
    overflow.set(leaf.id, options.fits(leaf.content, rect, theme).overflow)
  }
  return overflow
}

/** Overflow per node for a whole slide, including its deterministic title zone. */
export function slideOverflow(
  slide: Slide,
  theme: PresentationTheme,
  options: StructuralOptions = {},
): Map<NodeId, number> {
  const geometry = computeSlideGeometry(slide, options.geometry)
  const overflow = subtreeOverflow(slide.root, geometry.mainRect, theme, options)
  if (options.fitsTitle && slide.title && geometry.titleRect) {
    overflow.set(TITLE_NODE_ID, options.fitsTitle(slide.title, geometry.titleRect, theme).overflow)
  }
  return overflow
}

/**
 * Nodes that overflow in `next` and were not already overflowing at least as
 * much before. `previousOverflowOf` is a function rather than a map so callers
 * can avoid measuring the previous state at all when nothing overflows now.
 */
export function overflowRegressions(
  next: ReadonlyMap<NodeId, number>,
  previousOverflowOf: (nodeId: NodeId) => number,
): OverflowEntry[] {
  const entries: OverflowEntry[] = []
  for (const [nodeId, overflow] of next) {
    if (overflow <= FIT_TOLERANCE) continue
    const previousOverflow = previousOverflowOf(nodeId)
    if (overflow > previousOverflow + FIT_TOLERANCE) {
      entries.push({ nodeId, overflow, previousOverflow })
    }
  }
  return entries
}

/**
 * Every zone in `after` that shows less of its content than it did in `before`.
 *
 * Slides that are reference-equal and unaffected by a typography change are
 * skipped outright, and a slide's "before" overflow is only measured once
 * something in it actually overflows — measuring is an offscreen render per
 * zone in the app, so this keeps a global font change proportional to the
 * damage rather than to the size of the deck.
 */
export function findFitRegressions(
  before: Presentation,
  after: Presentation,
  options: StructuralOptions = {},
): FitRegression[] {
  if (!options.fits && !options.fitsTitle) return []
  const typographyUnchanged = sameFitRelevantTheme(before.theme, after.theme)
  const previousSlides = new Map(before.slides.map((slide) => [slide.id, slide]))
  const regressions: FitRegression[] = []

  for (const slide of after.slides) {
    const previous = previousSlides.get(slide.id)
    // A slide that is new in `after` has no baseline: its content was placed by
    // a command that already checked it absolutely.
    if (!previous) continue
    if (previous === slide && typographyUnchanged) continue

    const next = slideOverflow(slide, after.theme, options)
    let baseline: Map<NodeId, number> | null = null
    const entries = overflowRegressions(next, (nodeId) => {
      baseline ??= slideOverflow(previous, before.theme, options)
      return baseline.get(nodeId) ?? 0
    })
    for (const entry of entries) regressions.push({ slideId: slide.id, ...entry })
  }
  return regressions
}

/**
 * Commit `after` only if it does not hide content that `before` showed.
 *
 * Every command that can shrink the space available to existing content ends
 * with this call, so the rule lives in one place instead of being re-derived
 * per command.
 */
export function guardFit(
  before: Presentation,
  after: Presentation,
  options: StructuralOptions,
  message: string,
): Result<Presentation> {
  const regressions = findFitRegressions(before, after, options)
  if (regressions.length === 0) return ok(after)
  const worst = regressions.reduce((a, b) => (b.overflow > a.overflow ? b : a))
  return err('CONTENT_DOES_NOT_FIT', message, {
    slideId: worst.slideId,
    nodeId: worst.nodeId,
    overflow: worst.overflow,
    previousOverflow: worst.previousOverflow,
    zones: regressions.length,
  })
}
