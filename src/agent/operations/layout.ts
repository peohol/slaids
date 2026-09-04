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
 *
 * `move_zone_content` is the one operation here that does not change the tree at
 * all: it moves an existing content object from one leaf to another, which is
 * how an agent rearranges a slide without losing the ids it is holding.
 */

import { z } from 'zod'
import {
  clearLayoutNode,
  deleteLayoutNode,
  moveZoneContent,
  splitLeaf,
  updateSplit,
} from '../../domain/commands'
import { bodyOf } from '../../domain/content'
import { findLeaf, findSplit } from '../../domain/layout'
import { findSlide } from '../../domain/presentation'
import { err, ok } from '../../domain/result'
import type { StructuralOutcome } from '../../domain/commands'
import type { Presentation, ZoneContent } from '../../domain/types'
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

/* ------------------------------------------------------------------ *
 * move_zone_content
 * ------------------------------------------------------------------ */

/**
 * Where the content came from, where it went, and the ids that survived.
 *
 * Ids and nothing else, which is the same shape every other mutation answers in
 * (`set_zone_card` and `adjust_subfields` report `subfieldIds` too) and is a
 * scope boundary as much as a convention: `presentations:read` and
 * `presentations:write` are independent on a token, so a write-only caller must
 * not be handed content it cannot read. It would be — `moveZoneContent` treats a
 * move onto the zone the content already sits in as a no-op, so an answer that
 * described the content would make this operation an `inspect_slide` without the
 * read scope. Describing what a zone *holds* belongs to the reads.
 */
export interface ZoneContentMove {
  presentationId: string
  fromSlideId: string
  fromNodeId: string
  /** Always resolved, even when the call left it out to mean "the same slide". */
  toSlideId: string
  toNodeId: string
  /**
   * The text fields inside the content that moved, in layout order.
   *
   * The point of the whole operation is that these are the *same* ids as before
   * the move: a subfield an agent wrote into beforehand is the subfield it
   * writes into afterwards, at the new address and without a re-read. Empty for
   * a zone showing a file, which has no fields.
   */
  subfieldIds: string[]
}

/** The content a leaf holds, in the document a command produced. */
function contentAt(
  presentation: Presentation,
  slideId: string,
  nodeId: string,
): ZoneContent | null {
  const slide = findSlide(presentation, slideId)
  const leaf = slide ? findLeaf(slide.root, nodeId) : null
  return leaf?.content ?? null
}

export const moveZoneContentOperation = defineOperation({
  name: 'move_zone_content',
  summary:
    'Flytt hele innholdet i én bladsone til en annen, tom bladsone – på samme slide eller på en annen. Innholdet beholder id-ene sine.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    // Four separate names rather than `slideId`/`nodeId` plus two: both sides
    // need ids here, and a bare `slideId` next to a `toSlideId` would leave the
    // caller to guess which end the unprefixed one belongs to.
    fromSlideId: slideIdSchema.describe('Sliden innholdet ligger på nå.'),
    fromNodeId: nodeIdSchema.describe('Sonen innholdet ligger i nå. Må ha innhold.'),
    toSlideId: slideIdSchema
      .optional()
      .describe('Sliden innholdet skal til. Utelatt betyr den samme sliden som kilden.'),
    toNodeId: nodeIdSchema.describe('Sonen innholdet skal til. Må være en tom bladsone.'),
  }),
  run(context, input): Promise<AgentResult<ZoneContentMove>> {
    // No `disposition` here, and there is nothing missing: the target has to be
    // empty, so a move never displaces anything and has nothing to park.
    return mutatePresentation(
      context,
      // Deliberately without `slideId`/`nodeId`: those are `mutatePresentation`'s
      // fallback for a command that did not say which zone it refused, and with
      // two zones in play a fallback would label a source-side refusal with the
      // target. `moveZoneContent` names the side itself, on every failure.
      { presentationId: input.presentationId, expectedRevision: input.expectedRevision },
      (presentation) => {
        const toSlideId = input.toSlideId ?? input.fromSlideId
        const moved = moveZoneContent(presentation, {
          slideId: input.fromSlideId,
          fromNodeId: input.fromNodeId,
          toSlideId,
          toNodeId: input.toNodeId,
          ...structuralOptions(context),
        })
        if (!moved.ok) return moved

        const content = contentAt(moved.value.presentation, toSlideId, input.toNodeId)
        if (!content) {
          return err('NODE_NOT_FOUND', 'Fant ikke innholdet i målsonen etter flyttingen.', {
            slideId: toSlideId,
            nodeId: input.toNodeId,
          })
        }
        return ok({
          presentation: moved.value.presentation,
          value: {
            presentationId: presentation.id,
            fromSlideId: input.fromSlideId,
            fromNodeId: input.fromNodeId,
            toSlideId,
            toNodeId: input.toNodeId,
            subfieldIds: bodyOf(content)?.subfields.map((field) => field.id) ?? [],
          },
        })
      },
    )
  },
})

export const layoutOperations = [
  splitZone,
  adjustSplit,
  deleteZone,
  clearZone,
  moveZoneContentOperation,
]
