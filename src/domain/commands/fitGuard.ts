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
 *     `copyZoneContent`, `placeSandboxItem`, `splitLeaf`) by calling the fit
 *     checker directly.
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
 *    `setBodyLayout` — and with it `setSubfieldCount`, `setBodyAxis` and
 *    `setBodyWeights`, which are that one command with a single field filled
 *    in, so the count, the axis and the ratios are gated *together* against the
 *    layout asked for rather than one intermediate at a time —
 *    `setCardTitle`, `setSubfieldDoc`, `setCardColor`), plus `setTheme`,
 *    `setSlideTitle`, `setSlideHasTitle` — **both directions**, and the
 *    removing one is the easy half to get wrong: it can only give *this* slide
 *    room, so it looks like it cannot hide anything. A title may cite, and
 *    removing it takes a reference's first occurrence away, which renumbers
 *    every citation after it on slides nobody touched. It is gated rather than
 *    listed with the removals below because the same citation is already gated
 *    when `setSlideTitle` edits it out of the text, and one way of dropping a
 *    citation must not be the way around the other —
 *    `setSectionTitle`, `setSectionSubtitle`,
 *    `updateSplit` / `setSplitWeights`,
 *    and — because they change first-occurrence order — `addSlide`,
 *    `moveSlide`, `setZoneContent`, `moveZoneContent`, `copyZoneContent` and
 *    `placeSandboxItem`. `copyZoneContent` belongs here and not with
 *    `duplicateSlide` below: a copied slide lands right after its original, but
 *    copied *content* can land anywhere, so it can give a reference an earlier
 *    first occurrence and widen a pill on a slide nobody touched.
 *  - **Placement-gated as well** (calls the checker directly, absolutely,
 *    against the prospective document): `setZoneContent`, `moveZoneContent`,
 *    `copyZoneContent`, `canAcceptContent`, `splitLeaf`, `placeSandboxItem`,
 *    `addSlide`. Placement
 *    cannot be expressed as a regression: replacing content that already
 *    overflowed must not license content that overflows slightly less.
 *  - **Cannot shrink anything, deliberately ungated**: `duplicateSlide` (a copy
 *    lands after its original, so no earlier first occurrence moves),
 *    `setPresentationTitle`, `setFolder`, `setSectionAccentColor` and
 *    `setSectionBackgroundColor` (a colour is not a size), every idea command,
 *    every asset command, and the three interactive-slide commands
 *    (`addInteractiveSlide`, `setInteractiveSlideName`,
 *    `setInteractiveSlideHtml`): a miniapp's own layout is never measured as a
 *    zone tree, its cover draws no text a font could push out of a box, and it
 *    cannot cite — so inserting one renumbers nothing. `pageOverflow` says the
 *    same thing in code: an interactive slide has no overflow to report.
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
  SECTION_SUBTITLE_NODE_ID,
  SECTION_TITLE_NODE_ID,
  computeSectionGeometry,
  computeLayoutRects,
  computeSlideGeometry,
  TITLE_NODE_ID,
  validateSlideGeometry,
} from '../geometry'
import { collectContent, collectLeaves } from '../layout'
import { contentDocs } from '../content'
import { FIT_TOLERANCE, GEOMETRY_EPSILON, MIN_ZONE_HEIGHT, MIN_ZONE_WIDTH } from '../constants'
import { sectionGeometryForTheme, geometryForTheme, themeMetrics } from '../metrics'
import { sameFitRelevantTheme, type FitContext } from '../fit'
import { citationLabel, computeReferenceNumbering, type ReferenceNumbering } from '../references'
import { walkRichNodes } from '../richdoc'
import { err, ok, type Result } from '../result'
import type { GeometryOptions } from '../geometry'
import type {
  ContentSlide,
  LayoutNode,
  NodeId,
  Presentation,
  Rect,
  RichDoc,
  SectionSlide,
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
  switch (slide.kind) {
    case 'section':
      // A section cannot cite — that is why it has no numbering-sensitive docs
      // to list here — but it still has two lines, and listing them keeps this
      // the honest answer to "what text does this page draw".
      return [slide.title, slide.subtitle]
    case 'interactive':
      // The cover draws the slide's name as plain text, and the miniapp's own
      // markup is not a document of the deck's: nothing here is rich text.
      return []
    case 'content': {
      const docs: RichDoc[] = slide.title ? [slide.title] : []
      for (const content of collectContent(slide.root)) docs.push(...contentDocs(content))
      return docs
    }
  }
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
  slide: ContentSlide,
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
 * Overflow per line for a section slide.
 *
 * A section is two single lines of heading type in pills only as wide as their
 * text, so it fails the same way a slide title does — sideways — and is
 * measured by the same checker. The two lines are set in different sizes, which
 * is why the checker is told which size it is looking at.
 *
 * Nothing here consults the citation numbering: a section cannot cite, so the
 * one thing that makes a slide's fit depend on the rest of the deck does not
 * reach it.
 */
export function sectionOverflow(
  section: SectionSlide,
  context: FitContext,
  options: StructuralOptions = {},
): Map<NodeId, number> {
  const overflow = new Map<NodeId, number>()
  if (!options.fitsTitle) return overflow
  const resolved = { ...sectionGeometryForTheme(context.theme), ...options.geometry }
  const geometry = computeSectionGeometry(resolved)
  overflow.set(
    SECTION_TITLE_NODE_ID,
    options.fitsTitle(section.title, geometry.titleRect, context, resolved.titleFontSize).overflow,
  )
  overflow.set(
    SECTION_SUBTITLE_NODE_ID,
    options.fitsTitle(section.subtitle, geometry.subtitleRect, context, resolved.subtitleFontSize)
      .overflow,
  )
  return overflow
}

/**
 * Overflow per node for whichever kind of slide this is.
 *
 * The one place the kinds are told apart for measuring, so every caller — the
 * guard, the read-only validator, the editor's after-the-fact count — measures
 * a page the same way. An interactive slide answers with nothing: the deck
 * draws a cover for it whose only text is a name that wraps, and the miniapp's
 * own layout is the miniapp's, never a zone tree Slaids measures.
 */
export function pageOverflow(
  slide: Slide,
  context: FitContext,
  options: StructuralOptions = {},
): Map<NodeId, number> {
  switch (slide.kind) {
    case 'section':
      return sectionOverflow(slide, context, options)
    case 'content':
      return slideOverflow(slide, context, options)
    case 'interactive':
      return new Map()
  }
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

  // Sections go through the same loop as everything else. They are pages with
  // two lines of text on them and the rule is the one rule — a change may not
  // end with a line the audience can no longer read — so what decides how a
  // slide is measured is its kind, not which loop it happens to be in.
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

    const next = pageOverflow(slide, afterContext, options)
    let baseline: Map<NodeId, number> | null = null
    const entries = overflowRegressions(next, (nodeId) => {
      baseline ??= pageOverflow(previous, beforeContext, options)
      return baseline.get(nodeId) ?? 0
    })
    for (const entry of entries) regressions.push({ slideId: slide.id, ...entry })
  }
  return regressions
}

/**
 * A zone that stops satisfying the minimum size because the geometry moved.
 *
 * `findFitRegressions` measures *content*, and an empty zone has none: a bigger
 * gap can push a seven-way split below the minimum zone width without hiding a
 * single character, and the document would then be committed in a state
 * `findSlideIssues` immediately reports as `ZONE_TOO_SMALL`. The theme is what
 * moves those numbers — the gap and the title zone's height — so this is the
 * question a theme change has to ask in addition to the fit one.
 *
 * It is the same `validateSlideGeometry` the read-only validator runs, against
 * the prospective geometry, so the guard and the validator cannot disagree
 * about what "too small" means.
 *
 * A regression, like everything else here: a document that is already too tight
 * — an import, or one from before a token changed — must not be locked out of
 * the very change that would repair it. Measured as a *size*, not as a set of
 * ids: a zone that is already 1 px too narrow and would become 40 px too narrow
 * is worse, and comparing which nodes are on the list would call that no change
 * at all. The same shape `overflowRegressions` uses for content, one axis at a
 * time — a change that helps one dimension by hurting the other is not an
 * improvement.
 *
 * The rect comes back with it, and it is the *prospective* one — the size the
 * zone has under the theme that was refused, which is the size that broke the
 * rule. Reported here for the same reason `guardFit` reports its own: a caller
 * measuring afterwards has only the document that still stands, and would
 * answer with a zone comfortably above the minimum while holding an error that
 * says it is below it.
 */
export interface GeometryRegression {
  slideId: string
  nodeId: NodeId
  rect: Rect | null
}

export function findGeometryRegression(
  before: Presentation,
  after: Presentation,
  options: StructuralOptions = {},
): GeometryRegression | null {
  const afterGeometry = { ...geometryForTheme(after.theme), ...options.geometry }
  const beforeGeometry = { ...geometryForTheme(before.theme), ...options.geometry }
  const previous = new Map(before.slides.map((slide) => [slide.id, slide]))

  for (const slide of after.slides) {
    // A section has no zone tree, so there is no zone in it to fall below a
    // minimum. Its own failure mode is a line that no longer fits, which is the
    // content check above.
    if (slide.kind !== 'content') continue
    const now = belowMinimum(slide, afterGeometry)
    if (now.size === 0) continue
    const old = previous.get(slide.id)
    // Measured only when something is wrong now, and only then: the baseline
    // costs a full geometry pass per slide.
    let already: Map<NodeId, Undersized> | null = null
    for (const [nodeId, entry] of now) {
      already ??= old?.kind === 'content' ? belowMinimum(old, beforeGeometry) : new Map()
      const was = already.get(nodeId)
      if (
        was &&
        entry.short.width <= was.short.width + GEOMETRY_EPSILON &&
        entry.short.height <= was.short.height + GEOMETRY_EPSILON
      ) {
        continue
      }
      return { slideId: slide.id, nodeId, rect: entry.rect }
    }
  }
  return null
}

/** A zone under the minimum, and by how much on each axis. */
interface Undersized {
  rect: Rect
  short: { width: number; height: number }
}

/**
 * The undersized zones on a slide, in tree order.
 *
 * *Whether* a zone is too small is `validateSlideGeometry`'s answer, so the
 * guard and the read-only validator cannot disagree about it. *How much* is
 * arithmetic on the same rect, and it exists only to compare two states with
 * each other — never to decide the question itself.
 */
function belowMinimum(slide: ContentSlide, geometry: GeometryOptions): Map<NodeId, Undersized> {
  const undersized = new Map<NodeId, Undersized>()
  const violations = validateSlideGeometry(slide, geometry).filter(
    (violation) => violation.kind === 'below-minimum',
  )
  if (violations.length === 0) return undersized

  const rects = computeSlideGeometry(slide, geometry).rects
  const minWidth = geometry.minZoneWidth ?? MIN_ZONE_WIDTH
  const minHeight = geometry.minZoneHeight ?? MIN_ZONE_HEIGHT
  for (const violation of violations) {
    const rect = rects.get(violation.nodeId)
    if (!rect) continue
    undersized.set(violation.nodeId, {
      rect,
      short: {
        width: Math.max(0, minWidth - rect.width),
        height: Math.max(0, minHeight - rect.height),
      },
    })
  }
  return undersized
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
  const rect = failingRect(after, worst, options)
  return err('CONTENT_DOES_NOT_FIT', message, {
    slideId: worst.slideId,
    nodeId: worst.nodeId,
    overflow: worst.overflow,
    previousOverflow: worst.previousOverflow,
    zones: regressions.length,
    ...(rect ? { rect } : {}),
  })
}

/**
 * The rectangle the refusal is about, in the document that was refused.
 *
 * Reported by the guard rather than left to the caller, because the caller only
 * has the document as it still stands. That is the same rect for most commands
 * and the wrong one for a theme change: the measurement failed against the gap
 * and the title height the *new* theme implies, and answering with the room a
 * zone had before it grew would tell an agent to shorten text by an amount that
 * is not the amount missing. The prospective child of a split is the same case
 * from the other direction — a node the previous document does not have at all.
 */
function failingRect(
  after: Presentation,
  regression: FitRegression,
  options: StructuralOptions,
): Rect | null {
  const slide = after.slides.find((candidate) => candidate.id === regression.slideId)
  if (!slide) return null
  if (slide.kind === 'section') {
    const section = computeSectionGeometry({
      ...sectionGeometryForTheme(after.theme),
      ...options.geometry,
    })
    if (regression.nodeId === SECTION_TITLE_NODE_ID) return section.titleRect
    if (regression.nodeId === SECTION_SUBTITLE_NODE_ID) return section.subtitleRect
    return null
  }
  // Nothing on an interactive slide is measured, so nothing on it can regress.
  if (slide.kind !== 'content') return null
  const geometry = { ...geometryForTheme(after.theme), ...options.geometry }
  return computeSlideGeometry(slide, geometry).rects.get(regression.nodeId) ?? null
}
