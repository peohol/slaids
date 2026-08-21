/**
 * Layout-tree domain commands.
 *
 * These are the operations the zone editor, the drag handles and (later) the
 * agent API all go through. Every one of them validates geometry before
 * committing, and none of them can leave the tree in a half-changed state.
 */

import { MAX_SPLIT_CHILDREN, MIN_SPLIT_CHILDREN } from '../constants'
import { areWeightsValid, previewSplit, subtreeFitsInRect } from '../geometry'
import {
  cloneContentWithNewIds,
  collectContent,
  createLeaf,
  findLeaf,
  findNode,
  findSplit,
  normalizeTree,
  removeNode,
  replaceNode,
} from '../layout'
import { findSlide, touch, withSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import { appendToSandbox } from './sandbox'
import { guardFit } from './fitGuard'
import { rectForNode } from './internal'
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
  const slide = findSlide(presentation, input.slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
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

  const area = rectForNode(slide, input.nodeId, input.geometry)
  if (!area) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const preview = previewSplit(area, input.axis, input.weights, input.geometry)
  if (!preview.valid) {
    return err('ZONE_TOO_SMALL', 'Én eller flere subsoner blir for små.', {
      tooSmall: preview.tooSmall,
    })
  }

  const children: LeafNode[] = input.weights.map(() => createLeaf())
  let movedToSandbox: ZoneContent[] = []
  let discarded: ZoneContent[] = []
  let next = presentation

  if (leaf.content) {
    const targetIndex = input.contentTargetIndex ?? 0
    if (targetIndex < 0 || targetIndex >= children.length) {
      return err('INVALID_ARGUMENT', 'Ugyldig målsone for eksisterende innhold.')
    }
    const targetRect = preview.childRects[targetIndex]
    const fit = input.fits?.(leaf.content, targetRect, presentation.theme)
    if (!fit || fit.fits) {
      children[targetIndex] = { ...children[targetIndex], content: leaf.content }
    } else {
      const fallback = input.contentFallback ?? 'sandbox'
      if (fallback === 'delete') {
        return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass i den valgte subsonen.', {
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
    weights: [...input.weights],
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
  const slide = findSlide(presentation, input.slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const split = findSplit(slide.root, input.nodeId)
  if (!split) {
    return findNode(slide.root, input.nodeId)
      ? err('NODE_NOT_SPLIT', 'Sonen er ikke delt opp.')
      : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  }

  const targetCount = input.childCount ?? input.weights?.length ?? split.children.length
  const countCheck = validateChildCount(targetCount)
  if (!countCheck.ok) return countCheck

  const weights: number[] = []
  for (let i = 0; i < targetCount; i += 1) {
    weights.push(input.weights ? input.weights[i] : (split.weights[i] ?? 1))
  }
  if (input.weights && input.weights.length !== targetCount) {
    return err('INVALID_WEIGHTS', 'Antall forholdstall må matche antall subsoner.')
  }
  if (!areWeightsValid(weights)) {
    return err('INVALID_WEIGHTS', 'Alle forholdstall må være tall større enn 0.')
  }

  const axis = input.axis ?? split.axis
  const area = rectForNode(slide, input.nodeId, input.geometry)
  if (!area) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const keptChildren = split.children.slice(0, targetCount)
  const addedCount = Math.max(0, targetCount - keptChildren.length)
  const children: LayoutNode[] = [
    ...keptChildren,
    ...Array.from({ length: addedCount }, () => createLeaf()),
  ]

  const preview = previewSplit(area, axis, weights, input.geometry, children)
  if (!preview.valid) {
    return err('ZONE_TOO_SMALL', 'Én eller flere subsoner blir for små for innholdet sitt.', {
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
  const slide = findSlide(presentation, input.slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
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
  return ok(
    outcome(
      touch(withSlide(disposed.presentation, { ...slide, root: removal.root })),
      disposed.movedToSandbox,
      disposed.discarded,
    ),
  )
}

/** Replace a node (and its whole subtree) with a single empty leaf. */
export function clearLayoutNode(
  presentation: Presentation,
  input: DeleteNodeInput,
): Result<StructuralOutcome> {
  const slide = findSlide(presentation, input.slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
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
  const slide = findSlide(presentation, input.slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const leaf = findLeaf(slide.root, input.nodeId)
  if (!leaf) {
    return findNode(slide.root, input.nodeId)
      ? err('NODE_NOT_LEAF', 'Delte soner kan ikke ha innhold direkte.')
      : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  }
  if (leaf.content && input.content && !input.replace) {
    return err('TARGET_OCCUPIED', 'Sonen har allerede innhold.')
  }

  if (input.content) {
    const area = rectForNode(slide, input.nodeId, input.geometry)
    if (!area) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')
    const fit = input.fits?.(input.content, area, presentation.theme)
    if (fit && !fit.fits) {
      return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass i sonen.', {
        overflow: fit.overflow,
      })
    }
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
  return ok(
    outcome(
      touch(withSlide(disposed.presentation, { ...slide, root })),
      disposed.movedToSandbox,
      disposed.discarded,
    ),
  )
}

export interface MoveContentInput extends StructuralOptions {
  slideId: string
  fromNodeId: NodeId
  toNodeId: NodeId
  /** Optional destination slide; defaults to the source slide. */
  toSlideId?: string
  copy?: boolean
}

export function moveZoneContent(
  presentation: Presentation,
  input: MoveContentInput,
): Result<StructuralOutcome> {
  const sourceSlide = findSlide(presentation, input.slideId)
  if (!sourceSlide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const targetSlideId = input.toSlideId ?? input.slideId
  const targetSlide = findSlide(presentation, targetSlideId)
  if (!targetSlide) return err('SLIDE_NOT_FOUND', 'Fant ikke målsliden.')

  const from = findLeaf(sourceSlide.root, input.fromNodeId)
  if (!from) return err('NODE_NOT_LEAF', 'Kilden må være en bladsone.')
  if (!from.content) return err('TARGET_EMPTY', 'Kildesonen har ikke innhold.')
  const to = findLeaf(targetSlide.root, input.toNodeId)
  if (!to) return err('NODE_NOT_LEAF', 'Målet må være en bladsone.')
  if (to.id === from.id && targetSlideId === input.slideId) return ok(outcome(presentation))
  if (to.content) return err('TARGET_OCCUPIED', 'Målsonen har allerede innhold.')

  const area = rectForNode(targetSlide, input.toNodeId, input.geometry)
  if (!area) return err('NODE_NOT_FOUND', 'Fant ikke målsonen.')
  const fit = input.fits?.(from.content, area, presentation.theme)
  if (fit && !fit.fits) {
    return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass i målsonen.', {
      overflow: fit.overflow,
    })
  }

  let next = presentation
  // A copy gets fresh ids; sharing them would put the same content id on two
  // leaves and corrupt the document.
  const placed = input.copy ? cloneContentWithNewIds(from.content) : from.content
  if (!input.copy) {
    const clearedRoot = replaceNode(sourceSlide.root, from.id, { ...from, content: null })
    next = withSlide(next, { ...sourceSlide, root: clearedRoot })
  }
  const refreshedTarget = findSlide(next, targetSlideId)
  if (!refreshedTarget) return err('SLIDE_NOT_FOUND', 'Fant ikke målsliden.')
  const targetRoot = replaceNode(refreshedTarget.root, to.id, { ...to, content: placed })
  next = withSlide(next, { ...refreshedTarget, root: targetRoot })
  return ok(outcome(touch(next)))
}

/** Whether a zone can currently accept content of a given size. Used by DnD. */
export function canAcceptContent(
  presentation: Presentation,
  input: { slideId: string; nodeId: NodeId; content: ZoneContent } & StructuralOptions,
): boolean {
  const slide = findSlide(presentation, input.slideId)
  if (!slide) return false
  const leaf = findLeaf(slide.root, input.nodeId)
  if (!leaf || leaf.content) return false
  const area = rectForNode(slide, input.nodeId, input.geometry)
  if (!area) return false
  if (!subtreeFitsInRect(leaf, area, input.geometry)) return false
  const fit = input.fits?.(input.content, area, presentation.theme)
  return !fit || fit.fits
}
