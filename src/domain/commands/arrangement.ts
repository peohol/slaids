/**
 * Rearranging zones: one subtree replaced by another that holds exactly the
 * same zones, in the same order, with different proportions and different air.
 *
 * This is the commit a zone drag needs once it does more than move a boundary.
 * Compressing a group can add negative space beside it, or wrap a zone in a new
 * split so the air can sit across the parent's own direction; expanding into
 * air can use it up until it is gone. None of that adds, removes or reorders
 * anything the author put on the slide, and the command refuses any layout that
 * would — so it can never be the way content is lost or shuffled:
 *
 *  - every leaf that is *not* negative space keeps its node id and its content,
 *    in reading order;
 *  - negative-space leaves may come and go, and so may splits;
 *  - a new node may not take an id the slide already uses elsewhere.
 *
 * The replacement is otherwise an ordinary committed layout: whole ratios,
 * two to ten children per split, every zone large enough for what it holds, and
 * no content that showed before hidden after (`guardFit`). Adjacent air in it is
 * merged by `withSlide`, like everywhere else.
 */

import { validateSlideGeometry } from '../geometry'
import { collectNodes, collectLeaves, findNode, replaceNode, validateTree } from '../layout'
import { isNegativeSpace } from '../negativeSpace'
import { touch, withSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import { guardFit } from './fitGuard'
import { contentSlide, geometryFor } from './internal'
import { outcome, type StructuralOptions, type StructuralOutcome } from './types'
import type { LayoutNode, NodeId, Presentation } from '../types'

export interface RearrangeZonesInput extends StructuralOptions {
  slideId: string
  /** The node whose subtree is replaced; the replacement may have another id. */
  nodeId: NodeId
  layout: LayoutNode
}

export function rearrangeZones(
  presentation: Presentation,
  input: RearrangeZonesInput,
): Result<StructuralOutcome> {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return found
  const slide = found.value
  const where = { slideId: input.slideId, nodeId: input.nodeId }
  const original = findNode(slide.root, input.nodeId)
  if (!original) return err('NODE_NOT_FOUND', 'Fant ikke sonen.', where)

  const violations = validateTree(input.layout)
  if (violations.length > 0) {
    return err('INVALID_ARGUMENT', 'Den nye inndelingen er ikke en gyldig sonestruktur.', {
      ...where,
      violations,
    })
  }

  const kept = (node: LayoutNode) => collectLeaves(node).filter((leaf) => !isNegativeSpace(leaf))
  const before = kept(original)
  const after = kept(input.layout)
  const sameZones =
    before.length === after.length &&
    before.every(
      (leaf, index) =>
        leaf.id === after[index].id &&
        JSON.stringify(leaf.content) === JSON.stringify(after[index].content),
    )
  if (!sameZones) {
    return err(
      'INVALID_ARGUMENT',
      'En omfordeling kan bare endre størrelser og negativt rom, ikke flytte, legge til eller fjerne innhold.',
      where,
    )
  }

  const inside = new Set(collectNodes(original).map((node) => node.id))
  const elsewhere = collectNodes(slide.root).filter((node) => !inside.has(node.id))
  const taken = new Set(elsewhere.map((node) => node.id))
  if (collectNodes(input.layout).some((node) => taken.has(node.id))) {
    return err('INVALID_ARGUMENT', 'Den nye inndelingen bruker en sone-id som allerede finnes.', where)
  }

  const root = replaceNode(slide.root, input.nodeId, input.layout)
  const prospective = { ...slide, root }
  const placed = new Set(collectNodes(input.layout).map((node) => node.id))
  const geometry = geometryFor(presentation, input.geometry)
  const tooSmall = validateSlideGeometry(prospective, geometry).filter((violation) =>
    placed.has(violation.nodeId),
  )
  if (tooSmall.length > 0) {
    return err('ZONE_TOO_SMALL', 'Én eller flere soner blir for små for innholdet sitt.', {
      ...where,
      tooSmall: tooSmall.map((violation) => violation.nodeId),
    })
  }

  const next = touch(withSlide(presentation, prospective))
  const guarded = guardFit(
    presentation,
    next,
    input,
    'Innholdet får ikke plass med denne inndelingen.',
  )
  if (!guarded.ok) return guarded
  return ok(outcome(guarded.value))
}
