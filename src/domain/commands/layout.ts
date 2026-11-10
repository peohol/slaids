/**
 * Layout-tree domain commands.
 *
 * These are the operations the zone editor, the drag handles and (later) the
 * agent API all go through. Every one of them validates geometry before
 * committing, and none of them can leave the tree in a half-changed state.
 */

import { MAX_SPLIT_CHILDREN, MIN_SPLIT_CHILDREN } from '../constants'
import { areWeightsValid, previewSplit } from '../geometry'
import {
  cloneContentWithNewIds,
  cloneSubtreeWithNewIds,
  collectContent,
  createLeaf,
  findLeaf,
  findNode,
  findParent,
  findSplit,
  normalizeTree,
  removeNode,
  replaceNode,
} from '../layout'
import { touch, withSlide } from '../presentation'
import { quantizeRatios } from '../ratios'
import { err, ok, type Result } from '../result'
import { appendToSandbox } from './sandbox'
import { fitContextFor, guardAir, guardFit } from './fitGuard'
import { contentSlide, contentTooBigForZone, geometryFor, rectForNode } from './internal'
import { outcome, type ContentDisposition, type StructuralOptions, type StructuralOutcome } from './types'
import type { Axis, LayoutNode, LeafNode, NodeId, Presentation, ZoneContent } from '../types'

function validateChildCount(count: number): Result<number> {
  if (!Number.isInteger(count) || count < MIN_SPLIT_CHILDREN || count > MAX_SPLIT_CHILDREN) {
    return err('INVALID_CHILD_COUNT', `Antall subsoner må være mellom ${MIN_SPLIT_CHILDREN} og ${MAX_SPLIT_CHILDREN}.`)
  }
  return ok(count)
}

function disposeContents(
  presentation: Presentation,
  contents: readonly ZoneContent[],
  disposition: ContentDisposition,
  note: string,
): { presentation: Presentation; movedToSandbox: ZoneContent[]; discarded: ZoneContent[] } {
  if (contents.length === 0) {
    return { presentation, movedToSandbox: [], discarded: [] }
  }
  if (disposition === 'sandbox') {
    return {
      presentation: appendToSandbox(presentation, contents, note),
      movedToSandbox: [...contents],
      discarded: [],
    }
  }
  return { presentation, movedToSandbox: [], discarded: [...contents] }
}

/* ------------------------------------------------------------------ *
 * splitLeaf
 * ------------------------------------------------------------------ */

export interface SplitLeafInput extends StructuralOptions {
  slideId: string
  nodeId: NodeId
  axis: Axis
  weights: number[]
  /** Which new child receives the existing content, when there is any. */
  contentTargetIndex?: number
  /** Where the content goes when it cannot fit the chosen child. */
  contentFallback?: ContentDisposition
}

export function splitLeaf(
  presentation: Presentation,
  input: SplitLeafInput,
): Result<StructuralOutcome> {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return found
  const slide = found.value
  const leaf = findLeaf(slide.root, input.nodeId)
  if (!leaf) {
    return findNode(slide.root, input.nodeId)
      ? err('NODE_NOT_LEAF', 'Sonen er allerede delt opp.')
      : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  }
  const countCheck = validateChildCount(input.weights.length)
  if (!countCheck.ok) return countCheck
  if (!areWeightsValid(input.weights)) {
    return err('INVALID_WEIGHTS', 'Alle forholdstall må være tall større enn 0.')
  }
  // The caller's numbers are a *wish*: any positive relative weights, decimals
  // and all. What gets measured, previewed and stored is the integer ratio
  // closest to that wish, so the geometry checked below is the geometry the
  // slide ends up with rather than one nobody can write down.
  const weights = quantizeRatios(input.weights)

  const geometry = geometryFor(presentation, input.geometry)
  const area = rectForNode(slide, input.nodeId, geometry)
  if (!area) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  // The children that are about to exist, not a generic pair: the one that
  // receives the existing content has that content's minimum, and the rest are
  // empty and therefore have none. A split into empty zones is legal at any
  // ratio the ladder can express — an empty zone draws nothing a small
  // rectangle could hide, and which kinds can be put in it afterwards is the
  // content picker's answer, not this command's.
  const targetIndex = leaf.content ? (input.contentTargetIndex ?? 0) : -1
  if (leaf.content && (targetIndex < 0 || targetIndex >= weights.length)) {
    return err('INVALID_ARGUMENT', 'Ugyldig målsone for eksisterende innhold.')
  }
  const prospective = weights.map((_, index) =>
    index === targetIndex && leaf.content ? createLeaf(leaf.content) : null,
  )

  const preview = previewSplit(area, input.axis, weights, geometry, prospective)
  if (!preview.valid) {
    return err('ZONE_TOO_SMALL', 'Én eller flere subsoner blir for små for innholdet sitt.', {
      slideId: input.slideId,
      nodeId: input.nodeId,
      tooSmall: preview.tooSmall,
    })
  }

  const children: LeafNode[] = weights.map(() => createLeaf())
  let movedToSandbox: ZoneContent[] = []
  let discarded: ZoneContent[] = []
  let next = presentation

  if (leaf.content) {
    const targetRect = preview.childRects[targetIndex]
    const fit = input.fits?.(leaf.content, targetRect, fitContextFor(presentation, input.citationStyle))
    if (!fit || fit.fits) {
      children[targetIndex] = { ...children[targetIndex], content: leaf.content }
    } else {
      const fallback = input.contentFallback ?? 'sandbox'
      if (fallback === 'delete') {
        // The rect is the child the content was measured against, not the zone
        // being split: `nodeId` still names the parent, because that is what
        // the caller addressed, and reporting the parent's larger rectangle
        // alongside the child's overflow would tell a caller trying to shorten
        // the content that it has room it does not have.
        return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass i den valgte subsonen.', {
          slideId: input.slideId,
          nodeId: input.nodeId,
          childIndex: targetIndex,
          rect: targetRect,
          overflow: fit.overflow,
        })
      }
      const disposed = disposeContents(next, [leaf.content], 'sandbox', 'Flyttet ved splitting')
      next = disposed.presentation
      movedToSandbox = disposed.movedToSandbox
      discarded = disposed.discarded
    }
  }

  const split: LayoutNode = {
    id: leaf.id,
    kind: 'split',
    axis: input.axis,
    weights,
    children,
  }
  const root = normalizeTree(replaceNode(slide.root, leaf.id, split))
  return ok(outcome(touch(withSlide(next, { ...slide, root })), movedToSandbox, discarded))
}

/* ------------------------------------------------------------------ *
 * updateSplit
 * ------------------------------------------------------------------ */

export interface UpdateSplitInput extends StructuralOptions {
  slideId: string
  nodeId: NodeId
  axis?: Axis
  weights?: number[]
  childCount?: number
  /** What happens to content in children removed by a lower child count. */
  removedDisposition?: ContentDisposition
}

export function updateSplit(
  presentation: Presentation,
  input: UpdateSplitInput,
): Result<StructuralOutcome> {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return found
  const slide = found.value
  const split = findSplit(slide.root, input.nodeId)
  if (!split) {
    return findNode(slide.root, input.nodeId)
      ? err('NODE_NOT_SPLIT', 'Sonen er ikke delt opp.')
      : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  }

  const targetCount = input.childCount ?? input.weights?.length ?? split.children.length
  const countCheck = validateChildCount(targetCount)
  if (!countCheck.ok) return countCheck

  const wanted: number[] = []
  for (let i = 0; i < targetCount; i += 1) {
    wanted.push(input.weights ? input.weights[i] : (split.weights[i] ?? 1))
  }
  if (input.weights && input.weights.length !== targetCount) {
    return err('INVALID_WEIGHTS', 'Antall forholdstall må matche antall subsoner.')
  }
  if (!areWeightsValid(wanted)) {
    return err('INVALID_WEIGHTS', 'Alle forholdstall må være tall større enn 0.')
  }
  // Quantised before anything is measured, for the same reason as in
  // `splitLeaf`, and also when the caller changed only the axis or the child
  // count: a split that has been carrying decimals since before the rule
  // existed is written down properly the next time it is touched.
  const weights = quantizeRatios(wanted)

  const axis = input.axis ?? split.axis
  const geometry = geometryFor(presentation, input.geometry)
  const area = rectForNode(slide, input.nodeId, geometry)
  if (!area) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const keptChildren = split.children.slice(0, targetCount)
  const addedCount = Math.max(0, targetCount - keptChildren.length)
  const children: LayoutNode[] = [
    ...keptChildren,
    ...Array.from({ length: addedCount }, () => createLeaf()),
  ]

  const preview = previewSplit(area, axis, weights, geometry, children)
  if (!preview.valid) {
    return err('ZONE_TOO_SMALL', 'Én eller flere subsoner blir for små for innholdet sitt.', {
      slideId: input.slideId,
      nodeId: input.nodeId,
      tooSmall: preview.tooSmall,
    })
  }

  const removedChildren = split.children.slice(targetCount)
  const removedContent = removedChildren.flatMap(collectContent)
  const disposed = disposeContents(
    presentation,
    removedContent,
    input.removedDisposition ?? 'sandbox',
    'Fjernet ved endring av splitting',
  )

  const nextSplit: LayoutNode = { ...split, axis, weights, children }
  const root = normalizeTree(replaceNode(slide.root, split.id, nextSplit))
  const next = touch(withSlide(disposed.presentation, { ...slide, root }))

  // Ratio, axis and child-count changes are content-fit consumers too: a zone
  // that shrinks must still show everything inside it. Measured against the
  // state before the change, so dragging a boundary in a direction that
  // *relieves* an existing overflow stays possible.
  const guarded = guardFit(
    presentation,
    next,
    input,
    'Innholdet får ikke plass med disse forholdstallene.',
  )
  if (!guarded.ok) return guarded

  return ok(outcome(guarded.value, disposed.movedToSandbox, disposed.discarded))
}

/** Convenience wrapper for direct ratio drag handles. */
export function setSplitWeights(
  presentation: Presentation,
  input: { slideId: string; nodeId: NodeId; weights: number[] } & StructuralOptions,
): Result<StructuralOutcome> {
  return updateSplit(presentation, { ...input, childCount: input.weights.length })
}

/* ------------------------------------------------------------------ *
 * delete / clear
 * ------------------------------------------------------------------ */

export interface DeleteNodeInput extends StructuralOptions {
  slideId: string
  nodeId: NodeId
  contentDisposition?: ContentDisposition
}

export function deleteLayoutNode(
  presentation: Presentation,
  input: DeleteNodeInput,
): Result<StructuralOutcome> {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return found
  const slide = found.value
  if (slide.root.id === input.nodeId) {
    return err('ROOT_CANNOT_BE_DELETED', 'Hovedsonen kan ikke slettes. Bruk «Tøm sone».')
  }
  const target = findNode(slide.root, input.nodeId)
  if (!target) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const removal = removeNode(slide.root, input.nodeId)
  if (!removal) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const disposed = disposeContents(
    presentation,
    collectContent(removal.removed),
    input.contentDisposition ?? 'sandbox',
    'Fjernet ved sletting av sone',
  )
  const guarded = guardAir(presentation, touch(withSlide(disposed.presentation, { ...slide, root: removal.root })))
  if (!guarded.ok) return guarded
  return ok(outcome(guarded.value, disposed.movedToSandbox, disposed.discarded))
}

/** Replace a node (and its whole subtree) with a single empty leaf. */
export function clearLayoutNode(
  presentation: Presentation,
  input: DeleteNodeInput,
): Result<StructuralOutcome> {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return found
  const slide = found.value
  const target = findNode(slide.root, input.nodeId)
  if (!target) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const contents = collectContent(target)
  if (contents.length === 0 && target.kind === 'leaf') {
    return ok(outcome(presentation))
  }
  const disposed = disposeContents(
    presentation,
    contents,
    input.contentDisposition ?? 'sandbox',
    'Fjernet ved tømming av sone',
  )
  const emptied: LayoutNode = { id: target.id, kind: 'leaf', content: null }
  const root = normalizeTree(replaceNode(slide.root, target.id, emptied))
  return ok(
    outcome(
      touch(withSlide(disposed.presentation, { ...slide, root })),
      disposed.movedToSandbox,
      disposed.discarded,
    ),
  )
}

/* ------------------------------------------------------------------ *
 * duplicate
 * ------------------------------------------------------------------ */

export interface DuplicateNodeInput extends StructuralOptions {
  slideId: string
  nodeId: NodeId
}

/**
 * Put a copy of a zone right after it, in the split it belongs to.
 *
 * The copy is the whole subtree — its splits, its ratios and its content — with
 * every id renewed by `cloneSubtreeWithNewIds`, the same deep copy a template
 * slide is made from. Sharing a node, content or subfield id between the two
 * would be a corrupt document, not a convenience. The copy takes the original's
 * own ratio, so the two are the same size and the siblings give up the room.
 *
 * Measured like every other change that takes room from content: the new
 * sibling must be large enough for what it holds (`previewSplit`), and the
 * siblings that shrink — and the copy itself, which has no earlier state to be
 * compared with — may not end up hiding anything (`guardFit`). Copied citations
 * add occurrences, so the guard runs across the deck, not just this slide.
 *
 * The root has no split to sit in, so it has nothing to be duplicated beside:
 * splitting it is the way to get two of it.
 */
export function duplicateLayoutNode(
  presentation: Presentation,
  input: DuplicateNodeInput,
): Result<StructuralOutcome> {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return found
  const slide = found.value
  const node = findNode(slide.root, input.nodeId)
  if (!node) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  const parent = findParent(slide.root, input.nodeId)
  if (!parent) {
    return err('INVALID_ARGUMENT', 'Hovedsonen kan ikke dupliseres. Del den i stedet.', {
      slideId: input.slideId,
      nodeId: input.nodeId,
    })
  }
  const countCheck = validateChildCount(parent.children.length + 1)
  if (!countCheck.ok) return countCheck

  const index = parent.children.findIndex((child) => child.id === node.id)
  const children = [...parent.children]
  children.splice(index + 1, 0, cloneSubtreeWithNewIds(node))
  const weights = [...parent.weights]
  weights.splice(index + 1, 0, parent.weights[index])

  const geometry = geometryFor(presentation, input.geometry)
  const area = rectForNode(slide, parent.id, geometry)
  if (!area) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  const preview = previewSplit(area, parent.axis, weights, geometry, children)
  if (!preview.valid) {
    return err('ZONE_TOO_SMALL', 'Det er ikke plass til en kopi av sonen her.', {
      slideId: input.slideId,
      nodeId: input.nodeId,
      tooSmall: preview.tooSmall,
    })
  }

  const root = replaceNode(slide.root, parent.id, { ...parent, weights, children })
  const next = touch(withSlide(presentation, { ...slide, root }))
  const guarded = guardFit(
    presentation,
    next,
    input,
    'Det er ikke plass til en kopi av sonen uten at innhold skjules.',
  )
  if (!guarded.ok) return guarded
  return ok(outcome(guarded.value))
}

/* ------------------------------------------------------------------ *
 * reorder
 * ------------------------------------------------------------------ */

export interface ReorderNodeInput extends StructuralOptions {
  slideId: string
  nodeId: NodeId
  /** The position the zone should have among its siblings afterwards. */
  toIndex: number
}

/**
 * Move a zone to another place among its siblings, taking its ratio with it.
 *
 * `A : B : C` at `1 : 2 : 1` with B moved first becomes `B : A : C` at
 * `2 : 1 : 1`: every zone keeps its own share of the split, so every zone keeps
 * its size, and a split zone's subtree comes along whole — its own ratios
 * untouched. Nothing is copied or rebuilt, so every id survives and whoever is
 * holding one (the selection, an agent mid-edit) can go on using it.
 *
 * Because no zone changes size, a reorder can never make a zone too small for
 * what it holds. It is still measured: zones are read in tree order, so moving
 * one changes which citation occurs first, and renumbering can push text out
 * of view elsewhere in the deck — the same reason `moveSlide` is guarded.
 *
 * The root has no siblings, so there is nothing to reorder it among.
 */
export function reorderLayoutNode(
  presentation: Presentation,
  input: ReorderNodeInput,
): Result<StructuralOutcome> {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return found
  const slide = found.value
  if (!findNode(slide.root, input.nodeId)) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  const parent = findParent(slide.root, input.nodeId)
  const where = { slideId: input.slideId, nodeId: input.nodeId }
  if (!parent) {
    return err('INVALID_ARGUMENT', 'Hovedsonen har ingen søsken å bytte plass med.', where)
  }
  const count = parent.children.length
  if (!Number.isInteger(input.toIndex) || input.toIndex < 0 || input.toIndex >= count) {
    return err('INVALID_ARGUMENT', `Plasseringen må være mellom 0 og ${count - 1}.`, {
      ...where,
      toIndex: input.toIndex,
    })
  }
  const from = parent.children.findIndex((child) => child.id === input.nodeId)
  if (from === input.toIndex) return ok(outcome(presentation))

  const children = [...parent.children]
  const weights = [...parent.weights]
  const [child] = children.splice(from, 1)
  const [weight] = weights.splice(from, 1)
  children.splice(input.toIndex, 0, child)
  weights.splice(input.toIndex, 0, weight)

  const root = replaceNode(slide.root, parent.id, { ...parent, weights, children })
  const next = touch(withSlide(presentation, { ...slide, root }))
  const guarded = guardFit(
    presentation,
    next,
    input,
    'Flyttingen endrer citation-nummereringen slik at innhold ikke lenger får plass.',
  )
  if (!guarded.ok) return guarded
  return ok(outcome(guarded.value))
}

/* ------------------------------------------------------------------ *
 * content placement
 * ------------------------------------------------------------------ */

export interface SetZoneContentInput extends StructuralOptions {
  slideId: string
  nodeId: NodeId
  content: ZoneContent | null
  replace?: boolean
  replacedDisposition?: ContentDisposition
}

export function setZoneContent(
  presentation: Presentation,
  input: SetZoneContentInput,
): Result<StructuralOutcome> {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return found
  const slide = found.value
  const leaf = findLeaf(slide.root, input.nodeId)
  if (!leaf) {
    return findNode(slide.root, input.nodeId)
      ? err('NODE_NOT_LEAF', 'Delte soner kan ikke ha innhold direkte.')
      : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  }
  if (leaf.content && input.content && !input.replace) {
    return err('TARGET_OCCUPIED', 'Sonen har allerede innhold.')
  }

  const displaced = leaf.content && input.content !== leaf.content ? leaf.content : null
  const disposed = displaced
    ? disposeContents(
        presentation,
        [displaced],
        input.replacedDisposition ?? 'sandbox',
        'Erstattet innhold',
      )
    : { presentation, movedToSandbox: [], discarded: [] }

  const root = replaceNode(slide.root, leaf.id, { ...leaf, content: input.content })
  const next = touch(withSlide(disposed.presentation, { ...slide, root }))

  if (input.content) {
    const geometry = geometryFor(presentation, input.geometry)
    const area = rectForNode(slide, input.nodeId, geometry)
    if (!area) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')
    const tooSmall = contentTooBigForZone(input.content.kind, area, geometry, {
      slideId: input.slideId,
      nodeId: input.nodeId,
    })
    if (tooSmall) return tooSmall
    // Measured against the document as it will be *after* the placement:
    // content arriving with citations in it can renumber itself.
    const fit = input.fits?.(input.content, area, fitContextFor(next, input.citationStyle))
    if (fit && !fit.fits) {
      return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass i sonen.', {
        slideId: input.slideId,
        nodeId: input.nodeId,
        overflow: fit.overflow,
      })
    }
  }

  // Placing or removing citations renumbers every citation after it, so zones
  // on other slides can lose room without being touched.
  const guarded = guardFit(
    presentation,
    next,
    input,
    'Innholdet endrer citation-nummereringen slik at innhold på en annen slide ikke lenger får plass.',
  )
  if (!guarded.ok) return guarded
  return ok(outcome(guarded.value, disposed.movedToSandbox, disposed.discarded))
}

/**
 * Which of the two transfers a caller asked for.
 *
 * Never a flag on one command: a "move" that sometimes mints new ids instead
 * of carrying them across is two operations behind one name, and the ids are
 * precisely what a caller mid-edit is holding. `moveZoneContent` and
 * `copyZoneContent` are two exported names over one implementation, the way
 * `moveSlide` and `duplicateSlide` are two commands and not one with a flag.
 */
type TransferMode = 'move' | 'copy'

export interface ZoneContentTransferInput extends StructuralOptions {
  /** The slide the content sits on now. */
  slideId: string
  fromNodeId: NodeId
  toNodeId: NodeId
  /** Optional destination slide; defaults to the source slide. */
  toSlideId?: string
}

/**
 * Move a whole zone's content to another empty leaf.
 *
 * A move keeps the very same `ZoneContent` object, which is the point: the
 * content id, the subfield ids, the citations and the asset references travel
 * with it, so whoever is holding those ids — an inspector panel, an agent
 * mid-edit — can keep using them afterwards. Clearing the source and building
 * the content again somewhere else would produce something that looks the same
 * and is addressable by nothing the caller already knows.
 */
export function moveZoneContent(
  presentation: Presentation,
  input: ZoneContentTransferInput,
): Result<StructuralOutcome> {
  return transferZoneContent(presentation, input, 'move')
}

/**
 * Copy a whole zone's content into another empty leaf, leaving the source be.
 *
 * A real, independent copy: `cloneContentWithNewIds` mints a fresh content id
 * and fresh subfield ids, and it has to — two leaves carrying one content id is
 * a corrupt document, and a caller writing into "the" subfield would be writing
 * into both zones at once. Asset references are deliberately *not* renewed: a
 * file is not duplicated by being shown in two places.
 *
 * The source is left exactly as it was, which is the other half of the promise
 * and the reason a copy cannot be a move with a flag: the two differ in what
 * survives, not in how hard they work.
 */
export function copyZoneContent(
  presentation: Presentation,
  input: ZoneContentTransferInput,
): Result<StructuralOutcome> {
  return transferZoneContent(presentation, input, 'copy')
}

/**
 * The single implementation behind both names.
 *
 * Every refusal names the side it is about — `slideId` and `nodeId` in the
 * details — because "the source" and "the target" are two zones here and a
 * code alone cannot say which one failed. That is also why the two ways a node
 * can be unusable are told apart: a node that is not in the tree is
 * `NODE_NOT_FOUND`, a node that is there but split is `NODE_NOT_LEAF`, and a
 * caller acting on the first as if it were the second would go looking for a
 * split that does not exist.
 */
function transferZoneContent(
  presentation: Presentation,
  input: ZoneContentTransferInput,
  mode: TransferMode,
): Result<StructuralOutcome> {
  const copying = mode === 'copy'
  const foundSource = contentSlide(presentation, input.slideId)
  if (!foundSource.ok) return foundSource
  const sourceSlide = foundSource.value
  const targetSlideId = input.toSlideId ?? input.slideId
  const foundTarget = contentSlide(presentation, targetSlideId)
  if (!foundTarget.ok) return foundTarget
  const targetSlide = foundTarget.value

  const source = { slideId: input.slideId, nodeId: input.fromNodeId }
  const target = { slideId: targetSlideId, nodeId: input.toNodeId }

  const from = findLeaf(sourceSlide.root, input.fromNodeId)
  if (!from) {
    return findNode(sourceSlide.root, input.fromNodeId)
      ? err('NODE_NOT_LEAF', 'Kilden må være en bladsone.', source)
      : err('NODE_NOT_FOUND', 'Fant ikke kildesonen.', source)
  }
  if (!from.content) return err('TARGET_EMPTY', 'Kildesonen har ikke innhold.', source)
  const to = findLeaf(targetSlide.root, input.toNodeId)
  if (!to) {
    return findNode(targetSlide.root, input.toNodeId)
      ? err('NODE_NOT_LEAF', 'Målet må være en bladsone.', target)
      : err('NODE_NOT_FOUND', 'Fant ikke målsonen.', target)
  }
  const ontoItself = to.id === from.id && targetSlideId === input.slideId
  // Moving content onto the zone it already sits in asks for a state the
  // document is already in, so there is nothing to do and nothing to refuse.
  // A *copy* onto it is a different question with a different answer: the zone
  // is occupied — by the very content being copied — and answering "done" to a
  // copy that copied nothing would leave the caller looking for a second
  // content object that was never made.
  if (ontoItself && !copying) return ok(outcome(presentation))
  if (to.content) return err('TARGET_OCCUPIED', 'Målsonen har allerede innhold.', target)

  const targetGeometry = geometryFor(presentation, input.geometry)
  const area = rectForNode(targetSlide, input.toNodeId, targetGeometry)
  if (!area) return err('NODE_NOT_FOUND', 'Fant ikke målsonen.', target)
  const tooSmall = contentTooBigForZone(from.content.kind, area, targetGeometry, target)
  if (tooSmall) return tooSmall

  let next = presentation
  // A copy gets fresh ids; sharing them would put the same content id on two
  // leaves and corrupt the document.
  const placed = copying ? cloneContentWithNewIds(from.content) : from.content
  if (!copying) {
    const clearedRoot = replaceNode(sourceSlide.root, from.id, { ...from, content: null })
    next = withSlide(next, { ...sourceSlide, root: clearedRoot })
  }
  const refreshedTarget = contentSlide(next, targetSlideId)
  if (!refreshedTarget.ok) return refreshedTarget
  const targetRoot = replaceNode(refreshedTarget.value.root, to.id, { ...to, content: placed })
  next = touch(withSlide(next, { ...refreshedTarget.value, root: targetRoot }))

  // Moving citation-bearing content between slides changes first-occurrence
  // order, and copying it adds an occurrence, so the label this very content
  // renders can differ before and after.
  const fit = input.fits?.(placed, area, fitContextFor(next, input.citationStyle))
  if (fit && !fit.fits) {
    return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass i målsonen.', {
      slideId: targetSlideId,
      nodeId: input.toNodeId,
      overflow: fit.overflow,
    })
  }

  const guarded = guardFit(
    presentation,
    next,
    input,
    `${copying ? 'Kopieringen' : 'Flyttingen'} endrer citation-nummereringen slik at innhold på en annen slide ikke lenger får plass.`,
  )
  if (!guarded.ok) return guarded
  return ok(outcome(guarded.value))
}

/**
 * Whether a zone can currently accept content of a given size. Used by DnD.
 *
 * Measured against the document as it would be *with* the content in place, so
 * a drop target agrees with the command that runs when the pointer is released
 * — content carrying citations can renumber itself on arrival, and a target
 * that lights up green only to be refused a moment later is worse than one that
 * never lit up.
 */
export function canAcceptContent(
  presentation: Presentation,
  input: { slideId: string; nodeId: NodeId; content: ZoneContent } & StructuralOptions,
): boolean {
  const found = contentSlide(presentation, input.slideId)
  if (!found.ok) return false
  const slide = found.value
  const leaf = findLeaf(slide.root, input.nodeId)
  if (!leaf || leaf.content) return false
  const geometry = geometryFor(presentation, input.geometry)
  const area = rectForNode(slide, input.nodeId, geometry)
  if (!area) return false
  // The same two gates the command runs, in the same order: a zone that cannot
  // hold this kind of thing at all never lights up, and neither does one whose
  // text would not fit. A target that lights up green and then refuses the drop
  // is worse than one that never lit up.
  if (contentTooBigForZone(input.content.kind, area, geometry, { slideId: input.slideId, nodeId: input.nodeId })) {
    return false
  }
  if (!input.fits) return true
  const root = replaceNode(slide.root, leaf.id, { ...leaf, content: input.content })
  const prospective = withSlide(presentation, { ...slide, root })
  return input.fits(input.content, area, fitContextFor(prospective, input.citationStyle)).fits
}
