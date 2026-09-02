/**
 * Slide-level operations.
 *
 * Each of these is one domain command with a name an agent would use. Nothing
 * is decided here that the command does not already decide: `add_slide` cannot
 * insert past the end, `delete_slide` cannot empty a deck, `move_slide` and
 * `add_slide` are both refused when the reordering renumbers a citation on some
 * other slide badly enough to hide text there. That last one is why these are
 * thin wrappers rather than list manipulation — the rule lives under them.
 *
 * `set_slide_title` takes spans rather than a string because a title may cite a
 * reference, and a citation is an id, not a number. See `../text.ts`.
 */

import { z } from 'zod'
import { addSlide, deleteSlide, duplicateSlide, moveSlide, setSlideTitle } from '../../domain/commands'
import { findSlide } from '../../domain/presentation'
import { err, ok } from '../../domain/result'
import type { Presentation } from '../../domain/types'
import {
  defineOperation,
  expectedRevisionSchema,
  presentationIdSchema,
  slideIdSchema,
} from '../operation'
import { mutatePresentation, structuralOptions } from '../presentation'
import { alignSchema, citedIdsInSpans, docToTitleAlign, titleSpansSchema, titleSpansToDoc } from '../text'
import type { AgentResult } from '../types'
import { unknownReferenceIds } from './references'

/** Where a slide ended up, which is what an agent needs for its next call. */
export interface SlidePlacement {
  presentationId: string
  slideId: string
  index: number
  slideCount: number
}

function placement(presentation: Presentation, slideId: string): SlidePlacement {
  return {
    presentationId: presentation.id,
    slideId,
    index: presentation.slides.findIndex((slide) => slide.id === slideId),
    slideCount: presentation.slides.length,
  }
}

/**
 * The slide that is in `after` and was not in `before`.
 *
 * Read from the result rather than computed from the requested index: the
 * command owns where a slide lands, and a wrapper that re-derives it would be a
 * second, silently drifting copy of that rule.
 */
function addedSlideId(before: Presentation, after: Presentation): string | null {
  const known = new Set(before.slides.map((slide) => slide.id))
  return after.slides.find((slide) => !known.has(slide.id))?.id ?? null
}

/* ------------------------------------------------------------------ *
 * add_slide
 * ------------------------------------------------------------------ */

export const addSlideOperation = defineOperation({
  name: 'add_slide',
  summary: 'Legg til en ny, tom slide.',
  mutates: true,
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Posisjonen den skal settes inn på. Utelatt legger den sist.'),
    hasTitle: z.boolean().default(true).describe('Om sliden får en overskriftssone.'),
    title: z.string().max(400).optional().describe('Ren tekst i overskriften. Bruk set_slide_title for citations.'),
  }),
  run(context, input): Promise<AgentResult<SlidePlacement>> {
    return mutatePresentation(context, input, (presentation) => {
      const added = addSlide(presentation, {
        ...(input.index === undefined ? {} : { index: input.index }),
        hasTitle: input.hasTitle,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...structuralOptions(context),
      })
      if (!added.ok) return added

      const slideId = addedSlideId(presentation, added.value)
      if (!slideId) return err('SLIDE_NOT_FOUND', 'Den nye sliden kunne ikke identifiseres.')
      return ok({ presentation: added.value, value: placement(added.value, slideId) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * duplicate_slide
 * ------------------------------------------------------------------ */

export const duplicateSlideOperation = defineOperation({
  name: 'duplicate_slide',
  summary: 'Lag en kopi av en slide rett etter originalen.',
  mutates: true,
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
  }),
  run(context, input): Promise<AgentResult<SlidePlacement>> {
    return mutatePresentation(context, input, (presentation) => {
      const duplicated = duplicateSlide(presentation, input.slideId)
      if (!duplicated.ok) return duplicated

      const slideId = addedSlideId(presentation, duplicated.value)
      if (!slideId) return err('SLIDE_NOT_FOUND', 'Kopien kunne ikke identifiseres.')
      return ok({ presentation: duplicated.value, value: placement(duplicated.value, slideId) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * move_slide
 * ------------------------------------------------------------------ */

export const moveSlideOperation = defineOperation({
  name: 'move_slide',
  summary: 'Flytt en slide til en annen posisjon i dekket.',
  mutates: true,
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    toIndex: z.number().int().min(0).describe('Posisjonen den skal flyttes til, fra 0.'),
  }),
  run(context, input): Promise<AgentResult<SlidePlacement>> {
    return mutatePresentation(context, input, (presentation) => {
      // Reordering changes first-occurrence order, so the command may refuse
      // this because a citation on an untouched slide would grow wider.
      const moved = moveSlide(presentation, input.slideId, input.toIndex, structuralOptions(context))
      if (!moved.ok) return moved
      return ok({ presentation: moved.value, value: placement(moved.value, input.slideId) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * delete_slide
 * ------------------------------------------------------------------ */

export const deleteSlideOperation = defineOperation({
  name: 'delete_slide',
  summary: 'Slett en slide. Den siste sliden i en presentasjon kan ikke slettes.',
  mutates: true,
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; slideCount: number }>> {
    return mutatePresentation(context, input, (presentation) => {
      const deleted = deleteSlide(presentation, input.slideId)
      if (!deleted.ok) return deleted
      return ok({
        presentation: deleted.value,
        value: { presentationId: presentation.id, slideCount: deleted.value.slides.length },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_slide_title
 * ------------------------------------------------------------------ */

export const setSlideTitleOperation = defineOperation({
  name: 'set_slide_title',
  summary: 'Sett overskriften på en slide. Avvises hvis den ikke får plass på én linje.',
  mutates: true,
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    spans: titleSpansSchema,
    align: alignSchema
      .optional()
      .describe('Utelatt beholder justeringen overskriften allerede har.'),
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; slideId: string }>> {
    return mutatePresentation(context, input, (presentation) => {
      const unknown = unknownReferenceIds(presentation, citedIdsInSpans(input.spans))
      if (unknown.length > 0) {
        return err('REFERENCE_NOT_FOUND', 'Overskriften siterer referanser som ikke finnes.', {
          referenceIds: unknown,
        })
      }

      // Alignment is carried over unless the caller says otherwise: an agent
      // asked to change the words has not asked to un-centre the line.
      const slide = findSlide(presentation, input.slideId)
      const align = input.align ?? docToTitleAlign(slide?.title)

      // The title zone is one line at a fixed height: too long is refused, never
      // clipped, and the command measures it against the prospective numbering.
      const titled = setSlideTitle(
        presentation,
        input.slideId,
        titleSpansToDoc(input.spans, align),
        structuralOptions(context),
      )
      if (!titled.ok) return titled
      return ok({
        presentation: titled.value,
        value: { presentationId: presentation.id, slideId: input.slideId },
      })
    })
  },
})

export const slideOperations = [
  addSlideOperation,
  duplicateSlideOperation,
  moveSlideOperation,
  deleteSlideOperation,
  setSlideTitleOperation,
]
