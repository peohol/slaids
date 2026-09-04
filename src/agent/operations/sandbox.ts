/**
 * The sandbox: content a structural change displaced instead of destroying,
 * and everything an agent can do with it afterwards.
 *
 * Every layout and asset operation defaults its disposition to `'sandbox'`
 * (see `dispositionSchema` in `../operation.ts`), which used to be a dead
 * end for an agent: content went in and there was no way to see it, get it
 * back, copy it or throw it away. This file is the rest of that loop.
 *
 * `list_sandbox_items` reads every item in the same content vocabulary
 * `inspect_slide` uses for a zone (`inspectContent`, from `./deck` — one
 * function describing `ZoneContent`, read from either place). The three
 * mutations are thin wrappers over the domain commands of the same name —
 * `placeSandboxItem`, `duplicateSandboxItem`, `deleteSandboxItem` — so
 * fit-gating, citation-renumbering, the occupied-target refusal and
 * atomicity all come from there, unchanged: nothing sandbox-, fit- or
 * layout-shaped is decided in this file.
 */

import { z } from 'zod'
import { deleteSandboxItem, duplicateSandboxItem, placeSandboxItem } from '../../domain/commands'
import { presentationRevision } from '../../domain/revision'
import { err, ok } from '../../domain/result'
import type { SandboxItem } from '../../domain/types'
import {
  defineOperation,
  expectedRevisionSchema,
  nodeIdSchema,
  presentationIdSchema,
  slideIdSchema,
} from '../operation'
import { loadPresentation, mutatePresentation, sandboxIdsAdded, structuralOptions } from '../presentation'
import { agentOk, type AgentResult } from '../types'
import { inspectContent, type ContentInspection } from './deck'

const sandboxItemIdSchema = z
  .string()
  .min(1)
  .describe('Id-en til elementet i sandkassen, fra list_sandbox_items.')

/* ------------------------------------------------------------------ *
 * list_sandbox_items
 * ------------------------------------------------------------------ */

export interface SandboxItemView extends ContentInspection {
  itemId: string
  /** When the item was parked. */
  createdAt: string
  /** What displaced it, e.g. "Fjernet ved sletting av sone". */
  note: string
}

function sandboxItemView(item: SandboxItem): SandboxItemView {
  return {
    itemId: item.id,
    createdAt: item.createdAt,
    note: item.note,
    ...inspectContent(item.content),
  }
}

export const listSandboxItems = defineOperation({
  name: 'list_sandbox_items',
  summary:
    'Alt som midlertidig ligger i sandkassen, med stabile item-id-er og innholdet i samme format som inspect_slide.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({ presentationId: presentationIdSchema }),
  async run(
    context,
    input,
  ): Promise<AgentResult<{ presentationId: string; revision: string; items: SandboxItemView[] }>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded
    return agentOk({
      presentationId: loaded.value.id,
      revision: presentationRevision(loaded.value),
      items: loaded.value.sandbox.map(sandboxItemView),
    })
  },
})

/* ------------------------------------------------------------------ *
 * place_sandbox_item
 * ------------------------------------------------------------------ */

export interface SandboxPlacement {
  presentationId: string
  slideId: string
  nodeId: string
  itemId: string
  /** What the target zone held, now parked in the sandbox under this id. */
  displacedSandboxItemId: string | null
}

export const placeSandboxItemOperation = defineOperation({
  name: 'place_sandbox_item',
  summary:
    'Plasser et sandkasseelement i en bladsone. Sonen må være tom med mindre replace er satt, og plasseringen avvises hvis innholdet ikke får plass.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    itemId: sandboxItemIdSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    replace: z
      .boolean()
      .default(false)
      .describe(
        'Sett til true for å erstatte innhold som allerede ligger i sonen. Det fortrengte innholdet havner selv i sandkassen.',
      ),
  }),
  run(context, input): Promise<AgentResult<SandboxPlacement>> {
    return mutatePresentation(context, input, (presentation) => {
      const placed = placeSandboxItem(presentation, {
        itemId: input.itemId,
        slideId: input.slideId,
        nodeId: input.nodeId,
        replace: input.replace,
        ...structuralOptions(context),
      })
      if (!placed.ok) return placed

      // The one item this call could have parked: whatever the target zone
      // held before, if `replace` asked for it to be swapped out.
      const [displacedSandboxItemId = null] = sandboxIdsAdded(presentation, placed.value.presentation)
      return ok({
        presentation: placed.value.presentation,
        value: {
          presentationId: presentation.id,
          slideId: input.slideId,
          nodeId: input.nodeId,
          itemId: input.itemId,
          displacedSandboxItemId,
        },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * duplicate_sandbox_item
 * ------------------------------------------------------------------ */

export const duplicateSandboxItemOperation = defineOperation({
  name: 'duplicate_sandbox_item',
  summary: 'Lag en kopi av et sandkasseelement, med nye id-er på alt inni.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    itemId: sandboxItemIdSchema,
  }),
  run(
    context,
    input,
  ): Promise<AgentResult<{ presentationId: string; itemId: string; newItemId: string }>> {
    return mutatePresentation(context, input, (presentation) => {
      const duplicated = duplicateSandboxItem(presentation, input.itemId)
      if (!duplicated.ok) return duplicated

      const [newItemId] = sandboxIdsAdded(presentation, duplicated.value)
      if (!newItemId) return err('SANDBOX_ITEM_NOT_FOUND', 'Kopien kunne ikke identifiseres.')
      return ok({
        presentation: duplicated.value,
        value: { presentationId: presentation.id, itemId: input.itemId, newItemId },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * delete_sandbox_item
 * ------------------------------------------------------------------ */

export const deleteSandboxItemOperation = defineOperation({
  name: 'delete_sandbox_item',
  summary: 'Slett et sandkasseelement for godt. Kan ikke angres.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    itemId: sandboxItemIdSchema,
  }),
  run(
    context,
    input,
  ): Promise<AgentResult<{ presentationId: string; itemId: string; sandboxCount: number }>> {
    return mutatePresentation(context, input, (presentation) => {
      const deleted = deleteSandboxItem(presentation, input.itemId)
      if (!deleted.ok) return deleted
      return ok({
        presentation: deleted.value,
        value: {
          presentationId: presentation.id,
          itemId: input.itemId,
          sandboxCount: deleted.value.sandbox.length,
        },
      })
    })
  },
})

export const sandboxOperations = [
  listSandboxItems,
  placeSandboxItemOperation,
  duplicateSandboxItemOperation,
  deleteSandboxItemOperation,
]
