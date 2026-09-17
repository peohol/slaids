/**
 * Keeping the deck's record of which file was generated for which planned
 * picture.
 *
 * `imageGeneration.ts` decides whether a set of bindings is the set of pictures
 * the deck planned. This stores the ones that were, and it is a command rather
 * than a field assignment for one reason: **an unverified set must not be
 * storable.** The document's copy is what `imageWorkflow.ts` reads to answer
 * «were the pictures made», so a record that did not check out would be a
 * finished-looking answer to the question the whole flow turns on.
 *
 * Nothing here expires the records on a timer or a flag. They expire because an
 * entry's `imagePlanItemId` covers its whole order, so a rewritten motif or
 * shared context leaves a stored record pointing at an entry the deck no longer
 * has — and the check says so on the next read. `setImagePlan` drops the ones
 * that have stopped resolving, so the document does not accumulate bindings to
 * pictures nobody ordered.
 */

import { checkGeneratedImages, type GeneratedImageRecord } from '../imageGeneration'
import { touch } from '../presentation'
import { err, ok, type Result } from '../result'
import type { Presentation } from '../types'

/**
 * Store the bindings for this deck's generated pictures.
 *
 * Refused unless every binding checks out against the plan the deck holds
 * *now*: the same question `verify_image_handoff` answers, asked again here so
 * the answer cannot be asserted by a caller that did not ask it.
 */
export function recordGeneratedImages(
  presentation: Presentation,
  records: readonly GeneratedImageRecord[],
): Result<Presentation> {
  if (records.length === 0) {
    return err('INVALID_ARGUMENT', 'En kobling må gjelde minst ett generert bilde.')
  }
  const issues = checkGeneratedImages(presentation, records)
  if (issues.length > 0) {
    return err('INVALID_ARGUMENT', issues[0].message, { issues })
  }

  const stored = records.map(normalizeRecord)
  // A call that changed nothing writes nothing — the same contract
  // `setImagePlan` keeps, so re-running the check on an unchanged delivery does
  // not move `updatedAt` under an editor that is autosaving.
  if (JSON.stringify(presentation.generatedImages ?? []) === JSON.stringify(stored)) {
    return ok(presentation)
  }
  return ok(touch({ ...presentation, generatedImages: stored }))
}

/**
 * The records that still point at a planned picture.
 *
 * Called when the plan is written. A record whose id no longer resolves is a
 * binding to an order the deck has given up — inert, because the check would
 * reject it anyway, but keeping it would leave the document carrying claims
 * about pictures nobody asked for. Ordered by the entry's own number rather
 * than by however the delivery arrived, for the same reason every other part of
 * this flow is: arrival order is not identity.
 */
export function pruneGeneratedImages(presentation: Presentation, plannedIds: ReadonlySet<string>): Presentation {
  const records = presentation.generatedImages ?? []
  if (records.length === 0) return presentation
  const kept = records
    .filter((record) => plannedIds.has(record.imagePlanItemId))
    .sort((left, right) => left.number - right.number)
  if (kept.length === records.length) return presentation
  if (kept.length === 0) {
    const { generatedImages: _dropped, ...rest } = presentation
    return rest as Presentation
  }
  return { ...presentation, generatedImages: kept }
}

function normalizeRecord(record: GeneratedImageRecord): GeneratedImageRecord {
  return {
    imagePlanItemId: record.imagePlanItemId,
    number: record.number,
    slideId: record.slideId,
    nodeId: record.nodeId,
    fileName: record.fileName,
    ...(record.contentHash ? { contentHash: record.contentHash } : {}),
  }
}
