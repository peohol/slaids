/**
 * Read-only invariant checking for a whole presentation.
 *
 * Nothing here repairs anything. Every function answers one question — "what is
 * wrong with this document right now" — and returns a list, so the same check
 * can back an agent's `validate_slide`/`validate_presentation` (see
 * `IMPLEMENTATION_PLAN.md` §44, "Validering") and, later, a warning in the
 * editor, without either of them owning a private idea of what "valid" means.
 *
 * The checks are the invariants that already exist elsewhere in the domain,
 * gathered rather than reimplemented: the layout tree from `layout.ts`, the
 * rectangles and minimum sizes from `geometry.ts`, content fit from
 * `commands/fitGuard.ts`, the stored shape from `schema.ts`. What this module
 * adds on its own is only the referential part — a zone pointing at a file that
 * is not in the document, a citation pointing at a reference that is not — which
 * no single one of those can see.
 *
 * Fit is only checked when a checker is supplied, for the same reason the
 * commands take one: the domain layer does not measure text itself. A headless
 * caller passes the deterministic estimator and gets the same answer the
 * commands would have given.
 */

import { contentAssetIds, contentDocs } from './content'
import { fitContextFor, slideOverflow } from './commands/fitGuard'
import { FIT_TOLERANCE } from './constants'
import { collectLeaves, validateTree } from './layout'
import { geometryForTheme } from './metrics'
import { TITLE_NODE_ID, validateSlideGeometry } from './geometry'
import { collectCitationIds } from './richdoc'
import { presentationSchema } from './schema'
import type { StructuralOptions } from './commands/types'
import type { NodeId, Presentation, RichDoc, Slide, ZoneContent } from './types'

export type InvariantCode =
  /** The stored document does not match the schema at all. */
  | 'INVALID_DOCUMENT'
  /** The layout tree breaks one of the tree invariants. */
  | 'INVALID_STRUCTURE'
  /** A rect escapes its parent or the slide. */
  | 'INVALID_GEOMETRY'
  /** A zone is smaller than the domain's minimum. */
  | 'ZONE_TOO_SMALL'
  | 'CONTENT_DOES_NOT_FIT'
  | 'TITLE_DOES_NOT_FIT'
  | 'ASSET_NOT_FOUND'
  | 'REFERENCE_NOT_FOUND'

/**
 * One problem, addressed the way a caller would act on it.
 *
 * `nodeId` is the zone it is about; for something that belongs to the slide
 * itself rather than to a zone — a title that does not fit — it is the title
 * zone's own id, which is the same id the fit guard reports.
 */
export interface InvariantIssue {
  code: InvariantCode
  message: string
  slideId?: string
  nodeId?: NodeId
  details?: Record<string, unknown>
}

/** Everything drawn on a slide, with the zone it is drawn in. */
function slideDocuments(slide: Slide): { nodeId: NodeId; doc: RichDoc }[] {
  const docs: { nodeId: NodeId; doc: RichDoc }[] = slide.title
    ? [{ nodeId: TITLE_NODE_ID, doc: slide.title }]
    : []
  for (const leaf of collectLeaves(slide.root)) {
    if (!leaf.content) continue
    for (const doc of contentDocs(leaf.content)) docs.push({ nodeId: leaf.id, doc })
  }
  return docs
}

function missingAssetIssues(
  content: ZoneContent,
  known: ReadonlySet<string>,
  where: Pick<InvariantIssue, 'slideId' | 'nodeId' | 'details'>,
): InvariantIssue[] {
  const issues: InvariantIssue[] = []
  for (const assetId of new Set(contentAssetIds(content))) {
    if (known.has(assetId)) continue
    issues.push({
      code: 'ASSET_NOT_FOUND',
      message: 'Innholdet peker på en fil som ikke finnes i presentasjonen.',
      ...where,
      details: { ...where.details, assetId },
    })
  }
  return issues
}

function missingReferenceIssues(
  doc: RichDoc,
  known: ReadonlySet<string>,
  where: Pick<InvariantIssue, 'slideId' | 'nodeId' | 'details'>,
): InvariantIssue[] {
  const issues: InvariantIssue[] = []
  for (const referenceId of new Set(collectCitationIds(doc))) {
    if (known.has(referenceId)) continue
    issues.push({
      code: 'REFERENCE_NOT_FOUND',
      message: 'En citation peker på en referanse som ikke finnes i presentasjonen.',
      ...where,
      details: { ...where.details, referenceId },
    })
  }
  return issues
}

/**
 * Everything wrong with one slide, measured in the presentation it belongs to.
 *
 * The presentation is an argument and not a convenience: the theme decides the
 * gap and the type size the rects are computed with, and citation numbering
 * comes from first-occurrence order across the whole deck, so a slide cannot be
 * judged on its own.
 */
export function findSlideIssues(
  presentation: Presentation,
  slide: Slide,
  options: StructuralOptions = {},
): InvariantIssue[] {
  const issues: InvariantIssue[] = []
  const slideId = slide.id

  const structural = validateTree(slide.root)
  for (const violation of structural) {
    issues.push({
      code: 'INVALID_STRUCTURE',
      message: violation.message,
      slideId,
      nodeId: violation.nodeId,
    })
  }

  // Rects and fit are derived from the layout the tree describes, and a tree
  // that breaks its own invariants does not describe one: weights that are not
  // numbers have no rectangles, and asking anyway is how a read-only check ends
  // up throwing at the caller it exists to inform. The structural finding is
  // the answer; the rest becomes answerable once it is fixed. What follows —
  // the files and references the content points at — is a plain traversal and
  // holds either way.
  if (structural.length === 0) {
    const geometry = { ...geometryForTheme(presentation.theme), ...options.geometry }
    for (const violation of validateSlideGeometry(slide, geometry)) {
      issues.push({
        code: violation.kind === 'below-minimum' ? 'ZONE_TOO_SMALL' : 'INVALID_GEOMETRY',
        message:
          violation.kind === 'below-minimum'
            ? 'Sonen er mindre enn minstemålet.'
            : violation.detail,
        slideId,
        nodeId: violation.nodeId,
        details: { kind: violation.kind },
      })
    }

    // Only when a checker was supplied: the domain layer never measures text on
    // its own, and a validation run without one is a structural run.
    for (const [nodeId, overflow] of slideOverflow(slide, fitContextFor(presentation), options)) {
      if (overflow <= FIT_TOLERANCE) continue
      const isTitle = nodeId === TITLE_NODE_ID
      issues.push({
        code: isTitle ? 'TITLE_DOES_NOT_FIT' : 'CONTENT_DOES_NOT_FIT',
        message: isTitle
          ? 'Overskriften får ikke plass i tittelsonen.'
          : 'Innholdet får ikke plass i sonen.',
        slideId,
        nodeId,
        details: { overflow },
      })
    }
  }

  const knownAssets = new Set(presentation.assets.map((asset) => asset.id))
  for (const leaf of collectLeaves(slide.root)) {
    if (!leaf.content) continue
    issues.push(...missingAssetIssues(leaf.content, knownAssets, { slideId, nodeId: leaf.id }))
  }

  const knownReferences = new Set(presentation.references.map((reference) => reference.id))
  for (const { nodeId, doc } of slideDocuments(slide)) {
    issues.push(...missingReferenceIssues(doc, knownReferences, { slideId, nodeId }))
  }

  return issues
}

/** Ids that occur more than once in a list. */
function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id)
    seen.add(id)
  }
  return [...repeated]
}

/**
 * Everything wrong with a presentation: its stored shape, its slides, and the
 * items parked in the sandbox.
 *
 * The sandbox is included because it is part of the document and holds real
 * content: an item citing a reference that no longer exists is broken the day
 * it is placed back on a slide, and finding that out then is finding out too
 * late.
 */
export function findPresentationIssues(
  presentation: Presentation,
  options: StructuralOptions = {},
): InvariantIssue[] {
  const issues: InvariantIssue[] = []

  // Everything below reads the document as the schema describes it. When it is
  // not that shape, saying so is the whole finding: the checks that follow
  // would be answering questions about a document that does not exist.
  //
  // The shape only — the layout-tree invariants are checked per slide below, so
  // a broken tree is one finding with one code rather than two with two.
  const stored = presentationSchema.safeParse(presentation)
  if (!stored.success) {
    return stored.error.issues.map((issue) => ({
      code: 'INVALID_DOCUMENT' as const,
      message: issue.message,
      details: { path: issue.path.map((segment) => String(segment)).join('.') },
    }))
  }

  for (const [label, ids] of [
    ['slideId', presentation.slides.map((slide) => slide.id)],
    ['referenceId', presentation.references.map((reference) => reference.id)],
    ['assetId', presentation.assets.map((asset) => asset.id)],
  ] as const) {
    for (const id of duplicates(ids)) {
      issues.push({
        code: 'INVALID_STRUCTURE',
        message: `Den samme ${label}-en finnes flere ganger.`,
        details: { [label]: id },
      })
    }
  }

  for (const slide of presentation.slides) {
    issues.push(...findSlideIssues(presentation, slide, options))
  }

  const knownAssets = new Set(presentation.assets.map((asset) => asset.id))
  const knownReferences = new Set(presentation.references.map((reference) => reference.id))
  for (const item of presentation.sandbox) {
    const where = { details: { sandboxItemId: item.id } }
    issues.push(...missingAssetIssues(item.content, knownAssets, where))
    for (const doc of contentDocs(item.content)) {
      issues.push(...missingReferenceIssues(doc, knownReferences, where))
    }
  }

  return issues
}
