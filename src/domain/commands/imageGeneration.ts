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

import {
  checkGeneratedImages,
  plannedGeneratedImages,
  staleGeneratedImages,
  type GeneratedImageRecord,
} from '../imageGeneration'
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
 * The records worth keeping after the plan has been rewritten.
 *
 * Two kinds survive, and the second is the point. A record whose entry is still
 * planned answers for a picture on order. A record whose entry is gone but
 * whose *zone still holds the file it was bound to* answers for a picture
 * sitting in the deck — and if its order was rewritten, that record is the only
 * thing that knows the picture no longer matches.
 *
 * Dropping that second kind is what made the repair a laundering path: the
 * status told an agent to rewrite the plan with only the zones that still
 * waited, a fully deposited deck has none, and the empty plan then deleted the
 * evidence and reported the deck finished with the old pictures in place. So
 * the prune only throws away records nothing can be said about any more — the
 * zone is gone, or its picture has been taken out.
 *
 * Ordered by the entry's own number rather than by however the delivery
 * arrived, for the same reason every other part of this flow is: arrival order
 * is not identity.
 */
export function pruneGeneratedImages(presentation: Presentation): Presentation {
  const records = presentation.generatedImages ?? []
  if (records.length === 0) return presentation
  const keep = new Set(
    [...plannedGeneratedImages(presentation), ...staleGeneratedImages(presentation)].map(
      (record) => record.imagePlanItemId,
    ),
  )
  const kept = records
    .filter((record) => keep.has(record.imagePlanItemId))
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
