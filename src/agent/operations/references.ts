/**
 * References, and the citations that point at them.
 *
 * A reference is stored once and cited by id. The number a reader sees is
 * derived from first-occurrence order across the whole deck, so an agent never
 * writes a number — which is also why adding or editing a reference cannot
 * change any layout: nothing renumbers until something is *cited*.
 *
 * Deleting is the exception. It strips every citation that pointed at the
 * reference, so it is the one reference operation that changes documents, and
 * it says how many it removed rather than doing it quietly.
 */

import { z } from 'zod'
import { addReference, deleteReference, updateReference } from '../../domain/commands'
import { collectCitationIds } from '../../domain/richdoc'
import { contentDocs } from '../../domain/content'
import { allContent } from '../../domain/docs'
import { err, ok } from '../../domain/result'
import type { Presentation, Reference } from '../../domain/types'
import { defineOperation, expectedRevisionSchema, presentationIdSchema } from '../operation'
import { mutatePresentation } from '../presentation'
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
    ...presentation.slides.flatMap((slide) => (slide.title ? [slide.title] : [])),
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
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    referenceId: referenceIdSchema,
    ...referenceFields,
  }),
  run(context, input): Promise<AgentResult<{ reference: Reference }>> {
    return mutatePresentation(context, input, (presentation) => {
      // Every field is replaced, not merged: a partial update would make an
      // omitted field mean two different things depending on the caller.
      const updated = updateReference(presentation, input.referenceId, {
        title: input.title,
        authors: input.authors,
        url: input.url,
        year: input.year,
      })
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

export const referenceOperations = [
  addReferenceOperation,
  updateReferenceOperation,
  deleteReferenceOperation,
]
