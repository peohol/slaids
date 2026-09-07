/**
 * Interactive slides.
 *
 * An interactive slide is a slide, so it is moved, duplicated and deleted by
 * the operations that do that to any other slide, and it is listed and
 * inspected by `get_presentation` and `inspect_slide` like the rest. What is
 * here is the two things only this kind has to say: the file it is made from,
 * and the name its cover shows.
 *
 * Both are thin wrappers over the identically named domain commands, so an
 * agent's file meets exactly the rules a person's does — one `.html` name,
 * text with at least one element in it, within the per-slide limit measured
 * in bytes of UTF-8, and within the deck-wide budget — and a refusal writes
 * nothing. `expectedRevision` comes from the same `mutatePresentation` every
 * other write goes through.
 *
 * The source goes *in* here and never comes back out: a listing says the
 * file's name and size, and nothing else. Slaids never runs the file on an
 * agent's behalf either — `render_slide_preview` draws the cover, which is
 * what everything static draws — so an agent that stored an app has stored
 * data, exactly as a person who uploaded one has.
 *
 * The transport's own schema repeats the byte limit, so an oversized body is
 * refused before it is read into a document at all; the command then measures
 * the same limit again on what would be stored, which is the number that
 * counts.
 */

import { z } from 'zod'
import { addInteractiveSlide, setInteractiveSlideHtml, setInteractiveSlideName } from '../../domain/commands'
import { MAX_INTERACTIVE_HTML_BYTES } from '../../domain/constants'
import {
  INTERACTIVE_FILE_EXTENSION,
  INTERACTIVE_NAME_MAX_LENGTH,
  utf8ByteLength,
} from '../../domain/interactive'
import { findInteractiveSlide } from '../../domain/presentation'
import { err, ok } from '../../domain/result'
import { defineOperation, expectedRevisionSchema, presentationIdSchema, slideIdSchema } from '../operation'
import { applySteps, mutatePresentation } from '../presentation'
import type { AgentResult } from '../types'
import { type InteractiveSlideSummary } from './deck'
import { addedSlideId, placement, type SlidePlacement } from './slides'

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(INTERACTIVE_NAME_MAX_LENGTH)
  .describe('Navnet forsiden viser.')

const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(INTERACTIVE_NAME_MAX_LENGTH)
  .describe(`Filnavnet, som må slutte på ${INTERACTIVE_FILE_EXTENSION}. Vises som tekst.`)

const htmlSchema = z
  .string()
  .min(1)
  .refine((html) => utf8ByteLength(html) <= MAX_INTERACTIVE_HTML_BYTES, {
    message: `HTML-kilden er større enn grensen på ${MAX_INTERACTIVE_HTML_BYTES} byte`,
  })
  .describe(
    `Hele HTML-filen som tekst, med all CSS og JavaScript innebygget. Maks ${MAX_INTERACTIVE_HTML_BYTES} byte UTF-8. Eksterne skript, stilark, fonter, bilder og nettverkskall er ikke tilgjengelige for appen.`,
  )

/** What an agent gets back after writing a slide: where it is, and what it holds. */
export interface InteractiveSlideView extends SlidePlacement, Omit<InteractiveSlideSummary, 'index'> {}

/* ------------------------------------------------------------------ *
 * add_interactive_slide
 * ------------------------------------------------------------------ */

export const addInteractiveSlideOperation = defineOperation({
  name: 'add_interactive_slide',
  summary:
    'Legg til en interaktiv slide: én selvstendig miniapp i én HTML-fil. Publikum ser en forside med navnet og starter appen selv, isolert fra Slaids, uten nettverk. Kilden lagres som data og kjøres aldri av Slaids.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Posisjonen den skal settes inn på. Utelatt legger den sist.'),
    name: nameSchema.optional().describe('Navnet forsiden viser. Utelatt bruker filnavnet uten filendelsen.'),
    fileName: fileNameSchema,
    html: htmlSchema,
  }),
  run(context, input): Promise<AgentResult<InteractiveSlideView>> {
    return mutatePresentation(context, input, (presentation) => {
      const added = addInteractiveSlide(presentation, {
        ...(input.index === undefined ? {} : { index: input.index }),
        ...(input.name === undefined ? {} : { name: input.name }),
        fileName: input.fileName,
        html: input.html,
      })
      if (!added.ok) return added
      const slideId = addedSlideId(presentation, added.value)
      const slide = slideId ? findInteractiveSlide(added.value, slideId) : null
      if (!slideId || !slide) {
        return err('SLIDE_NOT_FOUND', 'Den nye sliden kunne ikke identifiseres.')
      }
      return ok({ presentation: added.value, value: view(added.value, slide, slideId) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_interactive_slide
 * ------------------------------------------------------------------ */

export const setInteractiveSlideOperation = defineOperation({
  name: 'set_interactive_slide',
  summary:
    'Endre navnet på en interaktiv slide og/eller bytt ut HTML-filen bak den. En fil som ikke kan brukes, avvises, og appen som ligger der beholdes uendret.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z
    .strictObject({
      presentationId: presentationIdSchema,
      expectedRevision: expectedRevisionSchema,
      slideId: slideIdSchema,
      name: nameSchema.optional().describe('Utelatt beholder navnet som står der.'),
      fileName: fileNameSchema.optional().describe('Sendes sammen med html når filen byttes.'),
      html: htmlSchema.optional().describe('Sendes sammen med fileName når filen byttes.'),
    })
    .refine((input) => (input.fileName === undefined) === (input.html === undefined), {
      message: 'fileName og html hører sammen: send begge for å bytte fil, eller ingen av dem.',
    })
    .refine((input) => input.name !== undefined || input.html !== undefined, {
      message: 'Oppgi et nytt navn, en ny fil, eller begge.',
    }),
  run(context, input): Promise<AgentResult<InteractiveSlideView>> {
    return mutatePresentation(context, input, (presentation) => {
      // Name and file in one document: a file refused after a rename had
      // been stored would be half a change.
      const applied = applySteps(presentation, [
        (current) =>
          input.name === undefined
            ? ok(current)
            : setInteractiveSlideName(current, input.slideId, input.name),
        (current) =>
          input.html === undefined || input.fileName === undefined
            ? ok(current)
            : setInteractiveSlideHtml(current, input.slideId, {
                fileName: input.fileName,
                html: input.html,
              }),
      ])
      if (!applied.ok) return applied
      const slide = findInteractiveSlide(applied.value, input.slideId)
      if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
      return ok({ presentation: applied.value, value: view(applied.value, slide, input.slideId) })
    })
  },
})

function view(
  presentation: Parameters<typeof placement>[0],
  slide: NonNullable<ReturnType<typeof findInteractiveSlide>>,
  slideId: string,
): InteractiveSlideView {
  return {
    ...placement(presentation, slideId),
    kind: 'interactive',
    name: slide.name,
    fileName: slide.fileName,
    htmlByteSize: utf8ByteLength(slide.html),
  }
}

export const interactiveOperations = [addInteractiveSlideOperation, setInteractiveSlideOperation]
