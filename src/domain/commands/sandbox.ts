/**
 * Sandbox commands.
 *
 * The sandbox is the safety net that means a structural change never has to
 * destroy content.
 */

import { newSandboxId } from '../ids'
import { cloneContentWithNewIds, findLeaf, replaceNode } from '../layout'
import { findSlide, touch, withSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import { fitContextFor, guardFit } from './fitGuard'
import { rectForNode } from './internal'
import { outcome, type StructuralOptions, type StructuralOutcome } from './types'
import type { Presentation, SandboxItem, ZoneContent } from '../types'

export function makeSandboxItem(content: ZoneContent, note = ''): SandboxItem {
  return { id: newSandboxId(), content, createdAt: new Date().toISOString(), note }
}

/** Pure helper used by every structural command that displaces content. */
export function appendToSandbox(
  presentation: Presentation,
  contents: readonly ZoneContent[],
  note = '',
): Presentation {
  if (contents.length === 0) return presentation
  return {
    ...presentation,
    sandbox: [...presentation.sandbox, ...contents.map((content) => makeSandboxItem(content, note))],
  }
}

export function moveZoneContentToSandbox(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; note?: string },
): Result<StructuralOutcome> {
  const slide = findSlide(presentation, input.slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const leaf = findLeaf(slide.root, input.nodeId)
  if (!leaf) return err('NODE_NOT_LEAF', 'Bare bladsoner kan ha innhold.')
  if (!leaf.content) return err('TARGET_EMPTY', 'Sonen har ikke innhold å flytte.')

  const content = leaf.content
  const root = replaceNode(slide.root, leaf.id, { ...leaf, content: null })
  const next = appendToSandbox(withSlide(presentation, { ...slide, root }), [content], input.note ?? '')
  return ok(outcome(touch(next), [content]))
}

export function placeSandboxItem(
  presentation: Presentation,
  input: { itemId: string; slideId: string; nodeId: string; replace?: boolean } & StructuralOptions,
): Result<StructuralOutcome> {
  const item = presentation.sandbox.find((entry) => entry.id === input.itemId)
  if (!item) return err('SANDBOX_ITEM_NOT_FOUND', 'Fant ikke elementet i sandkassen.')
  const slide = findSlide(presentation, input.slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const leaf = findLeaf(slide.root, input.nodeId)
  if (!leaf) return err('NODE_NOT_LEAF', 'Innhold kan bare ligge i en bladsone.')
  if (leaf.content && !input.replace) return err('TARGET_OCCUPIED', 'Sonen har allerede innhold.')

  const area = rectForNode(slide, input.nodeId, input.geometry)
  if (!area) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const displaced = leaf.content
  const root = replaceNode(slide.root, leaf.id, { ...leaf, content: item.content })
  let next: Presentation = {
    ...withSlide(presentation, { ...slide, root }),
    sandbox: presentation.sandbox.filter((entry) => entry.id !== input.itemId),
  }
  if (displaced) next = appendToSandbox(next, [displaced], 'Erstattet innhold')
  next = touch(next)

  // Sandbox content keeps its citations, so putting it back on a slide gives
  // those references a number again — measured against the document it lands in.
  const fit = input.fits?.(item.content, area, fitContextFor(next))
  if (fit && !fit.fits) {
    return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass i denne sonen.', {
      overflow: fit.overflow,
    })
  }
  const guarded = guardFit(
    presentation,
    next,
    input,
    'Innholdet endrer citation-nummereringen slik at innhold på en annen slide ikke lenger får plass.',
  )
  if (!guarded.ok) return guarded
  return ok(outcome(guarded.value, displaced ? [displaced] : []))
}

export function deleteSandboxItem(
  presentation: Presentation,
  itemId: string,
): Result<Presentation> {
  if (!presentation.sandbox.some((entry) => entry.id === itemId)) {
    return err('SANDBOX_ITEM_NOT_FOUND', 'Fant ikke elementet i sandkassen.')
  }
  return ok(
    touch({ ...presentation, sandbox: presentation.sandbox.filter((entry) => entry.id !== itemId) }),
  )
}

export function updateSandboxItemContent(
  presentation: Presentation,
  itemId: string,
  content: ZoneContent,
): Result<Presentation> {
  const index = presentation.sandbox.findIndex((entry) => entry.id === itemId)
  if (index < 0) return err('SANDBOX_ITEM_NOT_FOUND', 'Fant ikke elementet i sandkassen.')
  const sandbox = [...presentation.sandbox]
  sandbox[index] = { ...sandbox[index], content }
  return ok(touch({ ...presentation, sandbox }))
}

export function duplicateSandboxItem(
  presentation: Presentation,
  itemId: string,
): Result<Presentation> {
  const item = presentation.sandbox.find((entry) => entry.id === itemId)
  if (!item) return err('SANDBOX_ITEM_NOT_FOUND', 'Fant ikke elementet i sandkassen.')
  return ok(
    touch(appendToSandbox(presentation, [cloneContentWithNewIds(item.content)], item.note)),
  )
}

export function addContentToSandbox(
  presentation: Presentation,
  content: ZoneContent,
  note = '',
): Result<Presentation> {
  return ok(touch(appendToSandbox(presentation, [content], note)))
}
