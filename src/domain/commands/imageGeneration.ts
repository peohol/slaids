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

  /*
   * The bindings this delivery supersedes are kept beside it, and that is the
   * difference between «these pictures were made» and «these pictures are in
   * the deck».
   *
   * The case is the repair path: a zone holds a picture made for an order that
   * was rewritten, the replacement is generated, and the check passes. Replacing
   * the records outright made the deck forget that the *old* picture is still
   * the one in the zone — and since every planned zone had a file, the status
   * reported the replacements as delivered. They have not been: Slaids cannot
   * see a file, so the only thing that knows is the binding it is about to
   * throw away. `setImageAsset` drops it when a new file actually lands there.
   */
  const written = records.map(normalizeRecord)
  const ids = new Set(written.map((record) => record.imagePlanItemId))
  const superseded = staleGeneratedImages(presentation).filter(
    (record) => !ids.has(record.imagePlanItemId),
  )
  const stored = [...byNumber(written), ...byNumber(superseded)]

  // A call that changed nothing writes nothing — the same contract
  // `setImagePlan` keeps, so re-running the check on an unchanged delivery does
  // not move `updatedAt` under an editor that is autosaving.
  if (JSON.stringify(presentation.generatedImages ?? []) === JSON.stringify(stored)) {
    return ok(presentation)
  }
  return ok(touch({ ...presentation, generatedImages: stored }))
}

/**
 * The binding a zone's *previous* picture was made from, dropped.
 *
 * Called when a file lands in a zone. Whatever a superseded binding said about
 * that zone stopped being true the moment its picture was replaced — and since
 * nothing on the panel records which order the file in it came from, this is
 * the one moment the deck can know. A binding the plan still orders is left
 * alone: that one is the delivery, not something it replaced.
 */
export function dropSupersededBinding(
  presentation: Presentation,
  slideId: string,
  nodeId: string,
): Presentation {
  const records = presentation.generatedImages ?? []
  if (records.length === 0) return presentation
  const planned = new Set(plannedGeneratedImages(presentation).map((record) => record.imagePlanItemId))
  const kept = records.filter(
    (record) =>
      planned.has(record.imagePlanItemId) ||
      record.slideId !== slideId ||
      record.nodeId !== nodeId,
  )
  if (kept.length === records.length) return presentation
  if (kept.length === 0) {
    const { generatedImages: _dropped, ...rest } = presentation
    return rest as Presentation
  }
  return { ...presentation, generatedImages: kept }
}

/** Arrival order is not identity, here either. */
function byNumber(records: readonly GeneratedImageRecord[]): GeneratedImageRecord[] {
  return [...records].sort((left, right) => left.number - right.number)
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
  const kept = byNumber(records.filter((record) => keep.has(record.imagePlanItemId)))
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
