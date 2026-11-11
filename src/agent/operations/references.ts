/**
 * References, and the citations that point at them.
 *
 * Referansen lagres én gang og siteres med ID. Nummeret følger den første
 * forekomsten i dekket. Med forfatter og år kan en rettelse gjøre henvisningene
 * lengre, så agentens rettelser måles mot brukerens valgte henvisningsformat.
 *
 * Deleting is the exception. It strips every citation that pointed at the
 * reference, so it is the one reference operation that changes documents, and
 * it says how many it removed rather than doing it quietly.
 *
 * `delete_unused_references` is the opposite end of that: it removes only what
 * nothing cites, so it changes no text at all. What counts as "cited" is the
 * deck's own answer — slide titles, every zone, and the sandbox — and the
 * sandbox is the part that makes it safe rather than merely tidy.
 */

import { z } from 'zod'
import {
  addReference,
  deleteReference,
  deleteUnusedReferences,
  updateReference,
} from '../../domain/commands'
import { collectCitationIds } from '../../domain/richdoc'
import { contentDocs } from '../../domain/content'
import { allContent } from '../../domain/docs'
import { err, ok } from '../../domain/result'
import type { Presentation, Reference } from '../../domain/types'
import type { CitationStyle } from '../../domain/references'
import { defineOperation, expectedRevisionSchema, presentationIdSchema } from '../operation'
import { mutatePresentation, storageFailure, structuralOptions } from '../presentation'
import type { AgentResult } from '../types'

/**
 * Which of these ids the presentation does not know.
 *
 * Used by every write that can introduce a citation: a citation pointing at
 * nothing renders as `?` and is a broken slide, so it is refused at the door
 * rather than found later by `validate_presentation`.
 */
export function unknownReferenceIds(
  presentation: Presentation,
  ids: readonly string[],
): string[] {
  const known = new Set(presentation.references.map((reference) => reference.id))
  return [...new Set(ids)].filter((id) => !known.has(id))
}

const referenceFields = {
  title: z.string().trim().max(500).default(''),
  authors: z.string().trim().max(500).default(''),
  url: z.string().trim().max(1000).default(''),
  year: z.string().trim().max(20).default(''),
}

const referenceIdSchema = z.string().min(1).describe('Id-en til referansen.')

/** How many citations across the deck point at this reference. */
function citationCount(presentation: Presentation, referenceId: string): number {
  const docs = [
    // Only a content slide's title zone can cite: a section's heading cannot
    // by schema, and an interactive slide has no document of its own at all.
    ...presentation.slides.flatMap((slide) =>
      slide.kind === 'content' && slide.title ? [slide.title] : [],
    ),
    ...allContent(presentation).flatMap(contentDocs),
  ]
  return docs.reduce(
    (total, doc) => total + collectCitationIds(doc).filter((id) => id === referenceId).length,
    0,
  )
}

/* ------------------------------------------------------------------ *
 * add_reference
 * ------------------------------------------------------------------ */

export const addReferenceOperation = defineOperation({
  name: 'add_reference',
  summary: 'Legg til en referanse og få tilbake id-en citations skal peke på.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    ...referenceFields,
  }),
  run(context, input): Promise<AgentResult<{ reference: Reference }>> {
    return mutatePresentation(context, input, (presentation) => {
      const added = addReference(presentation, {
        title: input.title,
        authors: input.authors,
        url: input.url,
        year: input.year,
      })
      if (!added.ok) return added
      return ok({ presentation: added.value.presentation, value: { reference: added.value.reference } })
    })
  },
})

/* ------------------------------------------------------------------ *
 * update_reference
 * ------------------------------------------------------------------ */

export const updateReferenceOperation = defineOperation({
  name: 'update_reference',
  summary: 'Erstatt feltene på en referanse. Citationene som peker på den er uendret.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    referenceId: referenceIdSchema,
    ...referenceFields,
  }),
  async run(context, input): Promise<AgentResult<{ reference: Reference }>> {
    let citationStyle: CitationStyle
    try {
      citationStyle = (await context.repository.getUserSettings(null)).citationStyle
    } catch (error) {
      return storageFailure(error, 'Kunne ikke hente henvisningsformatet.', {
        presentationId: input.presentationId,
      })
    }
    return mutatePresentation(context, input, (presentation) => {
      // Every field is replaced, not merged: a partial update would make an
      // omitted field mean two different things depending on the caller.
      const updated = updateReference(presentation, input.referenceId, {
        title: input.title,
        authors: input.authors,
        url: input.url,
        year: input.year,
      }, { ...structuralOptions(context), citationStyle })
      if (!updated.ok) return updated
      const reference = updated.value.references.find((entry) => entry.id === input.referenceId)
      if (!reference) return err('REFERENCE_NOT_FOUND', 'Fant ikke referansen.')
      return ok({ presentation: updated.value, value: { reference } })
    })
  },
})

/* ------------------------------------------------------------------ *
 * delete_reference
 * ------------------------------------------------------------------ */

export const deleteReferenceOperation = defineOperation({
  name: 'delete_reference',
  summary:
    'Slett en referanse. Alle citations som peker på den fjernes fra teksten i samme operasjon.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    referenceId: referenceIdSchema,
  }),
  run(
    context,
    input,
  ): Promise<AgentResult<{ presentationId: string; removedCitations: number }>> {
    return mutatePresentation(context, input, (presentation) => {
      // Counted before the deletion, because afterwards there is nothing left to
      // count — and a caller that removed text without being told is a caller
      // that will not notice.
      const removedCitations = citationCount(presentation, input.referenceId)
      const deleted = deleteReference(presentation, input.referenceId)
      if (!deleted.ok) return deleted
      return ok({
        presentation: deleted.value,
        value: { presentationId: presentation.id, removedCitations },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * delete_unused_references
 * ------------------------------------------------------------------ */

export interface PrunedReferences {
  presentationId: string
  /**
   * The references this call actually removed.
   *
   * Ids and nothing else, for the same reason `move_zone_content` answers with
   * ids: `presentations:write` and `presentations:read` are independent ticks on
   * a token, and a receipt that listed titles and authors would be a reading of
   * the deck performed by a write. An empty list is the ordinary answer for a
   * deck that has nothing to clean, not a failure.
   */
  removedReferenceIds: string[]
}

export const deleteUnusedReferencesOperation = defineOperation({
  name: 'delete_unused_references',
  summary:
    'Fjern referanser ingenting siterer. Innhold i sandkassen teller som bruk, og et dekk uten noe å rydde svarer med en tom liste.',
  mutates: true,
  // The same authority as `delete_reference`, because it is the same act on a
  // set the deck itself picks out. It is not `assets:write`-shaped: a reference
  // lives in the document, not in the file store.
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
  }),
  run(context, input): Promise<AgentResult<PrunedReferences>> {
    return mutatePresentation(context, input, (presentation) => {
      // What counts as "unused" is `citedReferenceIds`' answer and nothing else:
      // slide titles, every zone's documents *and* content parked in the
      // sandbox. That last one is why this cannot be re-derived here — a
      // citation waiting in the sandbox is a real citation, and pruning past it
      // would break the item the moment it is placed back on a slide.
      const before = new Set(presentation.references.map((reference) => reference.id))
      const pruned = deleteUnusedReferences(presentation)
      if (!pruned.ok) return pruned

      for (const reference of pruned.value.references) before.delete(reference.id)
      return ok({
        presentation: pruned.value,
        value: { presentationId: presentation.id, removedReferenceIds: [...before] },
      })
    })
  },
})

export const referenceOperations = [
  addReferenceOperation,
  updateReferenceOperation,
  deleteReferenceOperation,
  deleteUnusedReferencesOperation,
]
