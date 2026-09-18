/**
 * The shape of one binding between a planned picture and the file made for it.
 *
 * Its own module for one reason, and it is a structural one: this shape is
 * asked at *two* boundaries that cannot see each other. A manifest arriving
 * beside a folder of files is validated by `imageGeneration.ts`, and the copy
 * stored on the document is validated by `schema.ts` — and `schema.ts` sits
 * below `imagePlan.ts` in the import graph, so neither of them can reach a
 * schema defined in the other's neighbourhood without a cycle.
 *
 * A second definition would have been the easy way out and the wrong one: a
 * binding that is legal in a manifest and illegal on the document, or the
 * reverse, is a delivery that validates on the way in and fails on the way back
 * out. So the shape is defined once, here, where both can import it.
 *
 * What lives here is only what both boundaries need: the identity of a plan
 * entry, and the record's own fields. What a binding *means* — whether it
 * points at a picture this deck still plans — is `checkGeneratedImages`, and
 * that question needs the deck.
 */

import { z } from 'zod'
import { MAX_PLANNED_IMAGES } from './constants'

/**
 * What a plan entry's id looks like, so a value can be recognised as one.
 *
 * Prefixed rather than a bare digest because these ids travel through chat
 * windows, file names and manifests written by hand, and «imgplan_» is what
 * makes one recognisable as an id at all rather than as a hash of something
 * else. `imagePlan.ts` derives the digest half; this is the part a boundary
 * checks.
 */
export const IMAGE_PLAN_ITEM_ID_PREFIX = 'imgplan_'

const IMAGE_PLAN_ITEM_ID_PATTERN = new RegExp(`^${IMAGE_PLAN_ITEM_ID_PREFIX}[0-9a-f]{16}$`)

/** Whether a string is shaped like a plan-entry id at all. Checked at boundaries. */
export function isImagePlanItemId(value: string): boolean {
  return IMAGE_PLAN_ITEM_ID_PATTERN.test(value)
}

/** SHA-256 as lowercase hex: the only form a digest may arrive in. */
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/

/**
 * One finished picture file, as the agent that made it recorded the binding.
 *
 * Every field is redundant with `imagePlanItemId` — the id is derived from the
 * deck, the zone, the number and the motif, so in a correct record the other
 * fields can be looked up rather than stated. They are stated anyway, and that
 * is the point: a record is a claim about *five* things, so a mis-binding has
 * five chances to contradict itself instead of one. It also turns an id that no
 * longer resolves into something diagnosable — a moved slide and a rewritten
 * motif produce the same «unknown id» otherwise, and they need different
 * answers.
 */
export interface GeneratedImageRecord {
  /** The plan entry this file was generated from. The file's real identity. */
  imagePlanItemId: string
  /** The entry's own number, which is also what the file is called. */
  number: number
  slideId: string
  nodeId: string
  /** The finished file's name, `<number>.<filendelse>`. */
  fileName: string
  /**
   * SHA-256 of the bytes the generation response returned, as lowercase hex.
   *
   * The one field that reaches past the metadata: without it the record is a
   * claim about a file *name*, and a name survives having its contents
   * swapped. Taken from the response for this one entry, at the moment it
   * arrives — a digest computed afterwards from a folder of files certifies
   * whatever mix-up already happened.
   *
   * Optional because not every host can reach those bytes. Absent, the
   * delivery is `'unchecked'` rather than refused, and never reported as
   * verified.
   */
  contentHash?: string
  /**
   * The host said it cannot reach the bytes of what its image tool produced.
   *
   * A declaration rather than evidence, and it exists because the alternative
   * was a dead end. A binding with no digest is not something Slaids can treat
   * as a generated picture — every other field in it was in the plan first — so
   * such a binding does not take its entry out of the generation queue. That is
   * right for a caller that skipped the generator and wrong for one that used
   * it and simply cannot hash what came back: the honest host would be offered
   * the same job forever.
   *
   * So it can say so, once, per picture. The entry then stops being offered and
   * the delivery is marked for what it is: `'unchecked'`, never verified, and
   * handed to the user's deposit to confirm by eye. Nothing here is a claim
   * Slaids believes — it is a claim it *records*, so the deck can say «this was
   * never checkable» instead of «this is done».
   */
  bytesUnavailable?: true
}

/**
 * The record as it arrives, wherever it arrives from.
 *
 * Both callers hand this data across a boundary the process does not control —
 * a manifest has been through a chat window and a download folder, and a
 * `.slaids` archive is a file a person can edit — so the shape is asked rather
 * than assumed. The bounds are the plan's own: no delivery can describe more
 * pictures than a deck may plan.
 */
export const generatedImageRecordSchema = z.object({
  imagePlanItemId: z.string().refine((value) => isImagePlanItemId(value), {
    message: 'Ikke en gyldig bildeplan-id',
  }),
  number: z.number().int().min(1).max(MAX_PLANNED_IMAGES),
  slideId: z.string().min(1),
  nodeId: z.string().min(1),
  fileName: z.string().min(1),
  /* Optional, and shape-checked when present: a digest that is not a SHA-256
     is refused here rather than reported as a mismatch later, because «this
     field is not a digest» and «these are the wrong bytes» call for different
     answers from whoever has to fix it. */
  contentHash: z.string().regex(CONTENT_HASH_PATTERN).optional(),
  /* `true` or absent, never `false`: the field says «this could not be
     checked», and a record that carries it with a digest would be saying both
     things at once. The boundary that writes one refuses that combination. */
  bytesUnavailable: z.literal(true).optional(),
})
