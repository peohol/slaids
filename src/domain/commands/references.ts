/**
 * Reference commands. Deleting a live reference removes every citation that
 * points at it, which is why it goes through a confirmed destructive flow.
 */

import { mapPresentationDocs } from '../docs'
import { newReferenceId } from '../ids'
import { touch } from '../presentation'
import { citedReferenceIds, isReferenceValid } from '../references'
import { removeCitations, replaceCitationId } from '../richdoc'
import { err, ok, type Result } from '../result'
import type { Presentation, Reference } from '../types'

export type ReferenceInput = Omit<Reference, 'id'>

function normalize(input: ReferenceInput): ReferenceInput {
  return {
    title: input.title.trim(),
    authors: input.authors.trim(),
    url: input.url.trim(),
    year: input.year.trim(),
  }
}

export function setIncludeReferencesInProgress(
  presentation: Presentation,
  includeReferencesInProgress: boolean,
): Result<Presentation> {
  return ok(touch({ ...presentation, includeReferencesInProgress }))
}

export function addReference(
  presentation: Presentation,
  input: ReferenceInput,
): Result<{ presentation: Presentation; reference: Reference }> {
  const normalized = normalize(input)
  if (!isReferenceValid(normalized)) {
    return err('REFERENCE_INVALID', 'Referansen må ha minst tittel, forfatter eller lenke.')
  }
  const reference: Reference = { id: newReferenceId(), ...normalized }
  return ok({
    presentation: touch({ ...presentation, references: [...presentation.references, reference] }),
    reference,
  })
}

export function updateReference(
  presentation: Presentation,
  id: string,
  input: ReferenceInput,
): Result<Presentation> {
  const index = presentation.references.findIndex((reference) => reference.id === id)
  if (index < 0) return err('REFERENCE_NOT_FOUND', 'Fant ikke referansen.')
  const normalized = normalize(input)
  if (!isReferenceValid(normalized)) {
    return err('REFERENCE_INVALID', 'Referansen må ha minst tittel, forfatter eller lenke.')
  }
  const references = [...presentation.references]
  references[index] = { id, ...normalized }
  return ok(touch({ ...presentation, references }))
}

/** Removes the reference and every citation pointing at it. */
export function deleteReference(presentation: Presentation, id: string): Result<Presentation> {
  if (!presentation.references.some((reference) => reference.id === id)) {
    return err('REFERENCE_NOT_FOUND', 'Fant ikke referansen.')
  }
  const removed = new Set([id])
  const cleaned = mapPresentationDocs(presentation, (doc) => removeCitations(doc, removed))
  return ok(
    touch({
      ...cleaned,
      references: cleaned.references.filter((reference) => reference.id !== id),
    }),
  )
}

/**
 * Slå sammen to referanser til samme verk: hver citation av `fromId` viser
 * til `intoId`, og `fromId` fjernes. Nummereringen følger av seg selv.
 */
export function mergeReferenceInto(
  presentation: Presentation,
  fromId: string,
  intoId: string,
): Result<Presentation> {
  const ids = new Set(presentation.references.map((reference) => reference.id))
  if (!ids.has(fromId) || !ids.has(intoId)) return err('REFERENCE_NOT_FOUND', 'Fant ikke referansen.')
  if (fromId === intoId) return ok(presentation)
  const remapped = mapPresentationDocs(presentation, (doc) => replaceCitationId(doc, fromId, intoId))
  return ok(
    touch({
      ...remapped,
      references: remapped.references.filter((reference) => reference.id !== fromId),
    }),
  )
}

/**
 * Drop references nothing cites. Content in the sandbox counts as citing, so
 * pruning can never corrupt an item waiting to be placed back on a slide.
 */
export function deleteUnusedReferences(presentation: Presentation): Result<Presentation> {
  const cited = citedReferenceIds(presentation)
  const references = presentation.references.filter((reference) => cited.has(reference.id))
  if (references.length === presentation.references.length) return ok(presentation)
  return ok(touch({ ...presentation, references }))
}
