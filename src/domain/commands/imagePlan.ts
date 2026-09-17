/**
 * Writing the deck's picture plan, and keeping the placeholders in step with it.
 *
 * The plan itself is metadata — nothing on a slide depends on it — but one
 * thing on the slides does: the caption a waiting picture zone carries, which
 * says «Sett inn bilde 3 her» and has to mean the same 3 the brief does. That
 * is why writing the plan is a command rather than a field assignment. The
 * numbering is derived from deck order (`resolveImagePlan`), so the only way
 * the caption and the brief can agree is for the same call to produce both.
 *
 * Captions the author wrote are never touched. Only a caption Slaids itself
 * wrote — `isPlaceholderCaption` — is rewritten or taken away, which is the
 * same rule that lets a finished picture drop its placeholder when the file
 * lands in the zone (see `setImageAsset`).
 */

import { imagePanelOf } from '../content'
import { collectLeaves, findLeaf } from '../layout'
import {
  imageZoneKey,
  isPlaceholderCaption,
  placeholderCaption,
  plannedImagesRefusal,
  resolveImagePlan,
  type PlannedImage,
} from '../imagePlan'
import { findContentSlide, touch } from '../presentation'
import { openImageDeposit } from './imageDeposit'
import { pruneGeneratedImages } from './imageGeneration'
import { docToPlainText, titleDoc } from '../richdoc'
import { err, ok, type Result } from '../result'
import type { Presentation } from '../types'
import { setImageCaption } from './content'
import type { StructuralOptions } from './types'

/**
 * Replace the deck's picture plan.
 *
 * The whole plan at once rather than one entry at a time, deliberately: the
 * numbering is a property of the set, so an entry added in isolation would
 * renumber everything after it anyway. One call, one consistent state.
 *
 * Every entry has to name a zone that is a picture zone today. That is an
 * argument error rather than something `checkImagePlan` reports later, because
 * a plan entry for a text zone is not a deck with a problem in it — it is a
 * call that meant a different zone.
 */
export function setImagePlan(
  presentation: Presentation,
  entries: readonly PlannedImage[],
  options: StructuralOptions = {},
): Result<Presentation> {
  const refusal = plannedImagesRefusal(entries)
  if (refusal) return err('INVALID_ARGUMENT', refusal)

  for (const entry of entries) {
    const slide = findContentSlide(presentation, entry.slideId)
    if (!slide) {
      return err('SLIDE_NOT_FOUND', 'Bildeplanen peker på en slide som ikke har soner.', {
        slideId: entry.slideId,
      })
    }
    const leaf = findLeaf(slide.root, entry.nodeId)
    if (!leaf) {
      return err('NODE_NOT_FOUND', 'Bildeplanen peker på en sone som ikke finnes.', {
        slideId: entry.slideId,
        nodeId: entry.nodeId,
      })
    }
    if (!leaf.content || !imagePanelOf(leaf.content)) {
      return err(
        'INVALID_CONTENT',
        'En bildeoppføring må peke på en bildesone. Sett innholdstypen til `image` eller `titled-image-card` først.',
        { slideId: entry.slideId, nodeId: entry.nodeId },
      )
    }
  }

  const plan = entries.map(normalizeEntry)
  const same = JSON.stringify(presentation.imagePlan ?? []) === JSON.stringify(plan)
  const written: Presentation =
    plan.length === 0 ? stripPlan(presentation) : { ...presentation, imagePlan: plan }
  /* A new plan is a new set of orders, and an order's id covers all of it — so
     a binding written for the plan that was here may no longer point at
     anything. What is dropped is only what nothing can be said about any more:
     a binding whose zone is gone, or whose picture has been taken out. One
     whose picture is still sitting in the deck is kept even when the plan no
     longer orders it, because that record is the only thing that knows the
     picture was made for a different order — see `pruneGeneratedImages`. */
  const withPlan = pruneGeneratedImages(written)

  const stamped = syncImagePlaceholders(withPlan, options)
  if (!stamped.ok) return stamped
  // A call that changed nothing writes nothing — the same contract
  // `setImageContext` keeps, and what stops a re-read of the current plan from
  // moving `updatedAt` under an editor that is autosaving.
  if (same && withPlan === written && stamped.value === withPlan) return ok(presentation)
  return ok(stamped.value === withPlan ? touch(withPlan) : stamped.value)
}

function normalizeEntry(entry: PlannedImage): PlannedImage {
  return {
    slideId: entry.slideId,
    nodeId: entry.nodeId,
    subject: entry.subject,
    composition: entry.composition,
    requirements: entry.requirements,
    avoid: entry.avoid,
  }
}

function stripPlan(presentation: Presentation): Presentation {
  if (!('imagePlan' in presentation)) return presentation
  const { imagePlan: _removed, ...rest } = presentation
  return rest as Presentation
}

/**
 * Bring every picture zone's placeholder caption in line with the plan.
 *
 * Three cases, and the third is the one that makes the other two safe:
 *
 *  - a planned zone with no file gets `Sett inn bilde N her`;
 *  - a zone that is no longer planned, or has its file, loses a placeholder;
 *  - a caption the author wrote is left exactly as it is, in both directions.
 *
 * `setImageAsset` applies the same reasoning to one zone when a file lands in
 * it, through the same `isPlaceholderCaption` test — so there is one definition
 * of «a caption Slaids may take back», and two places that honour it.
 *
 * Exported as the repair for `PLACEHOLDER_STALE`. The numbering is deck order,
 * and the deck keeps moving after a plan is written — a slide dragged in the
 * filmstrip renumbers the brief while the captions keep saying what they said.
 * Re-stamping inside every command that can move a slide or a zone would be a
 * rule a dozen call sites have to remember; this is one idempotent call that
 * brings any deck back into line, and `checkImagePlan` is what notices it is
 * needed.
 */
export function syncImagePlaceholders(
  presentation: Presentation,
  options: StructuralOptions = {},
): Result<Presentation> {
  const wanted = new Map<string, string>()
  for (const image of resolveImagePlan(presentation)) {
    if (image.filled) continue
    wanted.set(imageZoneKey(image.plan.slideId, image.plan.nodeId), placeholderCaption(image.number))
  }

  let current = presentation
  let changed = false
  for (const slide of presentation.slides) {
    if (slide.kind !== 'content') continue
    for (const leaf of collectLeaves(slide.root)) {
      const panel = leaf.content ? imagePanelOf(leaf.content) : null
      if (!panel) continue
      const caption = panel.caption
      const existing = caption ? docToPlainText(caption.doc).trim() : ''
      const target = wanted.get(imageZoneKey(slide.id, leaf.id))
      const ours = caption !== null && isPlaceholderCaption(existing)

      if (target !== undefined) {
        // A caption somebody wrote wins: they said something about this picture
        // that a placeholder would throw away.
        if (caption && !ours) continue
        if (ours && existing === target) continue
        const written = setImageCaption(current, {
          slideId: slide.id,
          nodeId: leaf.id,
          doc: titleDoc(target),
          ...options,
        })
        if (!written.ok) return written
        current = written.value
        changed = true
      } else if (ours) {
        const written = setImageCaption(current, {
          slideId: slide.id,
          nodeId: leaf.id,
          remove: true,
          ...options,
        })
        if (!written.ok) return written
        current = written.value
        changed = true
      }
    }
  }

  /*
   * The deposit numbers are stamped from the same pass, and that is the whole
   * reason they can be trusted: «Sett inn bilde 3 her», «BILDE 3 AV 7» in the
   * brief and the file called `3.png` are one numbering, written once. A deck
   * whose deposit is already completed or abandoned is left alone — see
   * `openImageDeposit`.
   */
  const stamped = openImageDeposit(current)

  // `setImageCaption` touches the document on every write it makes, so a
  // changed deck is already saved. An unchanged one comes back identical, and
  // the caller decides whether anything else it did is worth a save.
  if (stamped !== current) return ok(changed ? stamped : touch(stamped))
  return ok(changed ? current : presentation)
}
