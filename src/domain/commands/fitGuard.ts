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
 * There are three things above a single zone that decide what it renders, and
 * all three are part of the prospective state a command is measured against:
 * the geometry it sits in, the global typography, and the citation numbers
 * derived from first-occurrence order across the whole deck. The third is the
 * reason a command that never touches slide 9 can still be refused because of
 * slide 9.
 *
 * Which command is in which category — the full list, so a new command is added
 * to it deliberately rather than by omission:
 *
 *  - **Regression-gated** (calls `guardFit`): every command that funnels through
 *    `updateZoneContent` (`setContentKind`, `setContainerPayload`,
 *    `setSubfieldCount`, `setBodyAxis`, `setBodyWeights`, `setCardTitle`,
 *    `setSubfieldDoc`, `setCardColor`), plus `setTheme`,
 *    `setSlideTitle`, `setSlideHasTitle`, `setCoverTitle`, `setCoverSubtitle`,
 *    `updateSplit` / `setSplitWeights`,
 *    and — because they change first-occurrence order — `addSlide`,
 *    `moveSlide`, `setZoneContent`, `moveZoneContent` and `placeSandboxItem`.
 *  - **Placement-gated as well** (calls the checker directly, absolutely,
 *    against the prospective document): `setZoneContent`, `moveZoneContent`,
 *    `canAcceptContent`, `splitLeaf`, `placeSandboxItem`, `addSlide`. Placement
 *    cannot be expressed as a regression: replacing content that already
 *    overflowed must not license content that overflows slightly less.
 *  - **Cannot shrink anything, deliberately ungated**: `duplicateSlide` (a copy
 *    lands after its original, so no earlier first occurrence moves),
 *    `setPresentationTitle`, `setFolder`, `setCoverPillColor` (a colour is not
 *    a size), every idea command, and every asset command.
 *  - **Deliberate exception — removals**: `deleteSlide`, `deleteLayoutNode`,
 *    `clearLayoutNode`, `moveContentToSandbox` and `deleteReference` take
 *    content off the deck. They cannot shrink a zone, but they *can* renumber
 *    citations elsewhere, and renumbering is not purely shrinking: dropping the
 *    middle of a run turns `1–3` back into `1, 2`, which is wider. They are
 *    still ungated, deliberately: a removal is how an over-full deck gets
 *    repaired, and a rule that refuses to delete a slide until some other slide
 *    has been shortened would make an imported document unfixable. The bounded
 *    cost is a few characters in a citation pill; the cost of the alternative
 *    is a document you cannot edit your way out of.
 *
 * What is *not* gated here, deliberately, and why:
 *
 *  - **Undo and redo** restore a state the document has already been in. There
 *    is nothing to validate; refusing would strand the user in the state they
 *    are trying to leave.
 *  - **Loading, migrating and importing** a document must never be blocked by a
 *    rule about how much text fits — see `commands/types.ts`. A document that
 *    arrives overflowing is repaired by editing it, which is gated.
 *  - **Derived reference slides** are recomputed on every render and repaginate
 *    themselves: they add a column, then a slide, rather than clipping.
 *  - **A font that is still downloading.** Nothing here can see that; it is the
 *    caller's job to wait for readiness before asking, which is what
 *    `ui/fonts.ts` and the theme picker do.
 *
 * A note on what actually renumbers, because it is easy to get backwards:
 * `addReference` and `updateReference` do *not*. A reference gets a number by
 * being *cited*, so the numbering changes when a citation node is inserted or
 * removed (a document edit, already gated), when slides or citation-bearing
 * content move relative to each other, or when `deleteReference` strips
 * citations. Editing a reference's title only changes the derived reference
 * slides, which repaginate themselves.
 */

import {
  COVER_SUBTITLE_NODE_ID,
  COVER_TITLE_NODE_ID,
  computeCoverGeometry,
  computeLayoutRects,
  computeSlideGeometry,
  TITLE_NODE_ID,
} from '../geometry'
import { collectContent, collectLeaves } from '../layout'
import { contentDocs } from '../content'
import { FIT_TOLERANCE } from '../constants'
import { coverGeometryForTheme, geometryForTheme, themeMetrics } from '../metrics'
import { sameFitRelevantTheme, type FitContext } from '../fit'
import { citationLabel, computeReferenceNumbering, type ReferenceNumbering } from '../references'
import { COVER_PAGE_ID } from '../pages'
import { walkRichNodes } from '../richdoc'
import { err, ok, type Result } from '../result'
import type {
  DeckCover,
  LayoutNode,
  NodeId,
  Presentation,
  Rect,
  RichDoc,
  Slide,
} from '../types'
import type { StructuralOptions } from './types'

/**
 * The render context a presentation implies.
 *
 * Both halves are derived from the whole document: typography from the theme,
 * citation labels from first-occurrence order across every slide. Commands
 * build this from the presentation they are about to commit, so what is
 * measured is what will be rendered.
 */
export function fitContextFor(presentation: Presentation): FitContext {
  return { theme: presentation.theme, numbering: computeReferenceNumbering(presentation) }
}

/** Every document rendered on a slide, including its title zone. */
function slideDocs(slide: Slide): RichDoc[] {
  const docs: RichDoc[] = slide.title ? [slide.title] : []
  for (const content of collectContent(slide.root)) docs.push(...contentDocs(content))
  return docs
}

/**
 * Whether every citation on this slide renders exactly the same label under
 * both numberings.
 *
 * This is what decides if a renumbering somewhere else in the deck can affect
 * this slide at all — comparing the maps wholesale would re-measure the entire
 * document every time any citation moved.
 */
function sameCitationLabels(
  slide: Slide,
  before: ReferenceNumbering,
  after: ReferenceNumbering,
): boolean {
  let same = true
  for (const doc of slideDocs(slide)) {
    walkRichNodes(doc, (node) => {
      if (!same || node.type !== 'citation') return
      const ids = Array.isArray(node.attrs?.referenceIds)
        ? (node.attrs.referenceIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : []
      if (citationLabel(ids, before) !== citationLabel(ids, after)) same = false
    })
  }
  return same
}

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
  context: FitContext,
  options: StructuralOptions = {},
): Map<NodeId, number> {
  const overflow = new Map<NodeId, number>()
  if (!options.fits) return overflow
  const rects = computeLayoutRects(node, area, options.geometry?.gap ?? themeMetrics(context.theme).gap)
  for (const leaf of collectLeaves(node)) {
    if (!leaf.content) continue
    const rect = rects.get(leaf.id)
    if (!rect) continue
    overflow.set(leaf.id, options.fits(leaf.content, rect, context).overflow)
  }
  return overflow
}

/** Overflow per node for a whole slide, including its deterministic title zone. */
export function slideOverflow(
  slide: Slide,
  context: FitContext,
  options: StructuralOptions = {},
): Map<NodeId, number> {
  // The prospective theme decides the gap and the title zone, so the rects the
  // fit is judged against are the ones the slide will actually have.
  const geometry = computeSlideGeometry(slide, {
    ...geometryForTheme(context.theme),
    ...options.geometry,
  })
  const overflow = subtreeOverflow(slide.root, geometry.mainRect, context, options)
  if (options.fitsTitle && slide.title && geometry.titleRect) {
    overflow.set(TITLE_NODE_ID, options.fitsTitle(slide.title, geometry.titleRect, context).overflow)
  }
  return overflow
}

/**
 * Overflow per line for the cover.
 *
 * The cover is two single lines of heading type in pills only as wide as their
 * text, so it fails the same way a slide title does — sideways — and is
 * measured by the same checker. The two lines are set in different sizes, which
 * is why the checker is told which size it is looking at.
 *
 * Nothing here consults the citation numbering: the cover cannot cite, so the
 * one thing that makes a slide's fit depend on the rest of the deck does not
 * reach it.
 */
export function coverOverflow(
  cover: DeckCover,
  context: FitContext,
  options: StructuralOptions = {},
): Map<NodeId, number> {
  const overflow = new Map<NodeId, number>()
  if (!options.fitsTitle) return overflow
  const resolved = { ...coverGeometryForTheme(context.theme), ...options.geometry }
  const geometry = computeCoverGeometry(resolved)
  overflow.set(
    COVER_TITLE_NODE_ID,
    options.fitsTitle(cover.title, geometry.titleRect, context, resolved.titleFontSize).overflow,
  )
  overflow.set(
    COVER_SUBTITLE_NODE_ID,
    options.fitsTitle(cover.subtitle, geometry.subtitleRect, context, resolved.subtitleFontSize)
      .overflow,
  )
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
 * A slide is skipped only when nothing that decides its rendering changed: the
 * slide object itself, the typography, and the labels its citations resolve to.
 * That last one is why a renumbering caused by an edit on slide 1 is caught on
 * slide 9 — the zone the user touched is not the only zone a command can break.
 *
 * A slide's "before" overflow is only measured once something in it actually
 * overflows: measuring is an offscreen render per zone in the app, so this
 * keeps the cost proportional to the damage rather than to the size of the deck.
 */
export function findFitRegressions(
  before: Presentation,
  after: Presentation,
  options: StructuralOptions = {},
): FitRegression[] {
  if (!options.fits && !options.fitsTitle) return []
  const beforeContext = fitContextFor(before)
  const afterContext = fitContextFor(after)
  const typographyUnchanged = sameFitRelevantTheme(before.theme, after.theme)
  const previousSlides = new Map(before.slides.map((slide) => [slide.id, slide]))
  const regressions: FitRegression[] = []

  // The cover is not a slide, but it is text on a page and the rule is the same
  // one: a change may not end with a line the audience can no longer read. It
  // is checked here rather than in the cover's own commands so that everything
  // above it — a wider font, more air, a larger type scale — is caught too.
  if (after.cover !== before.cover || !typographyUnchanged) {
    const next = coverOverflow(after.cover, afterContext, options)
    let baseline: Map<NodeId, number> | null = null
    for (const entry of overflowRegressions(next, (nodeId) => {
      baseline ??= coverOverflow(before.cover, beforeContext, options)
      return baseline.get(nodeId) ?? 0
    })) {
      regressions.push({ slideId: COVER_PAGE_ID, ...entry })
    }
  }

  for (const slide of after.slides) {
    const previous = previousSlides.get(slide.id)
    // A slide that is new in `after` has no baseline: its content was placed by
    // a command that already checked it absolutely.
    if (!previous) continue
    if (
      previous === slide &&
      typographyUnchanged &&
      sameCitationLabels(slide, beforeContext.numbering, afterContext.numbering)
    ) {
      continue
    }

    const next = slideOverflow(slide, afterContext, options)
    let baseline: Map<NodeId, number> | null = null
    const entries = overflowRegressions(next, (nodeId) => {
      baseline ??= slideOverflow(previous, beforeContext, options)
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
