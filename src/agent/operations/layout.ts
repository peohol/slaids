/**
 * Layout operations: dividing a slide, re-proportioning it, and taking parts
 * of it away.
 *
 * Every rule these have to obey already lives in the domain commands — minimum
 * zone sizes, 2–10 children, weights that are finite and positive, the single
 * global gap, and content that must not end up hidden. An agent meets exactly
 * those rules, with the same typed codes: `ZONE_TOO_SMALL` when a subzone would
 * fall below the minimum, `CONTENT_DOES_NOT_FIT` when a change would push text
 * out of sight.
 *
 * `split_zone` answers with the ids of the zones it created, so the common
 * sequence (split, then fill) does not need a second `inspect_slide` in between.
 */

import { z } from 'zod'
import {
  clearLayoutNode,
  deleteLayoutNode,
  splitLeaf,
  updateSplit,
} from '../../domain/commands'
import { findSplit } from '../../domain/layout'
import { findSlide } from '../../domain/presentation'
import { ok } from '../../domain/result'
import type { StructuralOutcome } from '../../domain/commands'
import type { Presentation } from '../../domain/types'
import {
  defineOperation,
  dispositionSchema,
  expectedRevisionSchema,
  nodeIdSchema,
  presentationIdSchema,
  slideIdSchema,
} from '../operation'
import { mutatePresentation, sandboxIdsAdded, structuralOptions } from '../presentation'
import type { AgentResult } from '../types'

const axisSchema = z
  .enum(['x', 'y'])
  .describe('`x` deler sonen i kolonner side om side, `y` i rader over hverandre.')

const weightsSchema = z
  .array(z.number().positive().finite())
  .min(2)
  .max(10)
  .describe(
    'Ett forholdstall per subsone, 2–10 av dem. [1, 1] gir like store deler, [2, 1] gir en dobbelt så stor som den andre.',
  )

/** What a structural change displaced, counted rather than silently dropped. */
export interface ZoneChange {
  presentationId: string
  slideId: string
  nodeId: string
  movedToSandbox: number
  discarded: number
  /** The sandbox items this call actually created, so a later read is not required to keep going. */
  sandboxItemIds: string[]
}

function zoneChange(
  before: Presentation,
  input: { presentationId: string; slideId: string; nodeId: string },
  outcome: StructuralOutcome,
): ZoneChange {
  return {
    presentationId: input.presentationId,
    slideId: input.slideId,
    nodeId: input.nodeId,
    movedToSandbox: outcome.movedToSandbox.length,
    discarded: outcome.discarded.length,
    sandboxItemIds: sandboxIdsAdded(before, outcome.presentation),
  }
}

/** The children a split has, read out of the document the command produced. */
function childNodeIds(presentation: Presentation, slideId: string, nodeId: string): string[] {
  const slide = findSlide(presentation, slideId)
  const split = slide ? findSplit(slide.root, nodeId) : null
  return split?.children.map((child) => child.id) ?? []
}

/* ------------------------------------------------------------------ *
 * split_zone
 * ------------------------------------------------------------------ */

export const splitZone = defineOperation({
  name: 'split_zone',
  summary: 'Del en sone i 2–10 subsoner og få tilbake id-ene til de nye sonene.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    axis: axisSchema,
    weights: weightsSchema,
    contentTargetIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Hvilken ny subsone innhold som allerede ligger i sonen skal havne i. Standard er den første.'),
    contentFallback: dispositionSchema.describe(
      'Hva som skjer med innholdet hvis det ikke får plass i den valgte subsonen. `delete` gir CONTENT_DOES_NOT_FIT i stedet for å forkaste noe.',
    ),
  }),
  run(context, input): Promise<AgentResult<ZoneChange & { childNodeIds: string[] }>> {
    return mutatePresentation(context, input, (presentation) => {
      const split = splitLeaf(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        axis: input.axis,
        weights: input.weights,
        ...(input.contentTargetIndex === undefined
          ? {}
          : { contentTargetIndex: input.contentTargetIndex }),
        contentFallback: input.contentFallback,
        ...structuralOptions(context),
      })
      if (!split.ok) return split

      const children = childNodeIds(split.value.presentation, input.slideId, input.nodeId)
      return ok({
        presentation: split.value.presentation,
        value: { ...zoneChange(presentation, input, split.value), childNodeIds: children },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * adjust_split
 * ------------------------------------------------------------------ */

export const adjustSplit = defineOperation({
  name: 'adjust_split',
  summary: 'Endre retning, forholdstall eller antall subsoner i en sone som allerede er delt.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    axis: axisSchema.optional().describe('Utelatt beholder retningen sonen har.'),
    weights: weightsSchema.optional().describe('Utelatt beholder forholdstallene sonen har.'),
    childCount: z
      .number()
      .int()
      .min(2)
      .max(10)
      .optional()
      .describe('Nytt antall subsoner. Færre enn i dag fjerner de siste.'),
    removedDisposition: dispositionSchema.describe(
      'Hva som skjer med innholdet i subsoner som forsvinner når antallet reduseres.',
    ),
  }),
  run(context, input): Promise<AgentResult<ZoneChange & { childNodeIds: string[] }>> {
    return mutatePresentation(context, input, (presentation) => {
      const updated = updateSplit(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        ...(input.axis === undefined ? {} : { axis: input.axis }),
        ...(input.weights === undefined ? {} : { weights: input.weights }),
        ...(input.childCount === undefined ? {} : { childCount: input.childCount }),
        removedDisposition: input.removedDisposition,
        ...structuralOptions(context),
      })
      if (!updated.ok) return updated

      return ok({
        presentation: updated.value.presentation,
        value: {
          ...zoneChange(presentation, input, updated.value),
          childNodeIds: childNodeIds(updated.value.presentation, input.slideId, input.nodeId),
        },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * delete_zone
 * ------------------------------------------------------------------ */

export const deleteZone = defineOperation({
  name: 'delete_zone',
  summary:
    'Fjern en subsone. Søsknene fyller plassen. Hovedsonen kan ikke fjernes – bruk clear_zone.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    contentDisposition: dispositionSchema,
  }),
  run(context, input): Promise<AgentResult<ZoneChange>> {
    return mutatePresentation(context, input, (presentation) => {
      const deleted = deleteLayoutNode(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        contentDisposition: input.contentDisposition,
        ...structuralOptions(context),
      })
      if (!deleted.ok) return deleted
      return ok({
        presentation: deleted.value.presentation,
        value: zoneChange(presentation, input, deleted.value),
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * clear_zone
 * ------------------------------------------------------------------ */

export const clearZone = defineOperation({
  name: 'clear_zone',
  summary: 'Tøm en sone: innholdet og eventuell oppdeling under den erstattes av én tom sone.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    contentDisposition: dispositionSchema,
  }),
  run(context, input): Promise<AgentResult<ZoneChange>> {
    return mutatePresentation(context, input, (presentation) => {
      const cleared = clearLayoutNode(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        contentDisposition: input.contentDisposition,
        ...structuralOptions(context),
      })
      if (!cleared.ok) return cleared
      return ok({
        presentation: cleared.value.presentation,
        value: zoneChange(presentation, input, cleared.value),
      })
    })
  },
})

export const layoutOperations = [splitZone, adjustSplit, deleteZone, clearZone]
