/**
 * Sections.
 *
 * A section is a slide, so it is added by `add_section`, addressed by its
 * `slideId`, and moved, duplicated and deleted by the very operations that do
 * that to any other slide. What is here is the three things only a section has
 * to say: its heading, its subheading, and the two colours it hands to every
 * page from itself to the next section.
 *
 * The lines are plain strings, not spans: a section cannot cite. A citation's
 * number comes from where it first occurs among the *content* slides, so one
 * here would render an empty pill — the schema leaves the node out rather than
 * the toolbar hiding it, and this input says the same thing.
 *
 * Every one of these is a thin wrapper over the identically named domain
 * command: the fit gate, the colour validation and `expectedRevision` come from
 * there, unchanged.
 */

import { z } from 'zod'
import {
  addSection,
  setSectionAccentColor,
  setSectionBackgroundColor,
  setSectionSubtitle,
  setSectionTitle,
} from '../../domain/commands'
import { findSectionSlide } from '../../domain/presentation'
import { docToPlainText, titleDoc } from '../../domain/richdoc'
import { err, ok, type Result } from '../../domain/result'
import type { Presentation, SectionSlide } from '../../domain/types'
import { defineOperation, expectedRevisionSchema, presentationIdSchema, slideIdSchema } from '../operation'
import { applySteps, mutatePresentation, structuralOptions } from '../presentation'
import type { AgentResult } from '../types'

const sectionLineSchema = z.string().max(400)

export interface SectionView {
  presentationId: string
  slideId: string
  index: number
  title: string
  subtitle: string
  /** Pills, card headers and headings with no colour of their own, up to the next section. */
  accentColor: string
  /** The page colour for this slide and every one after it, up to the next section. */
  backgroundColor: string
}

export function sectionView(presentation: Presentation, section: SectionSlide): SectionView {
  return {
    presentationId: presentation.id,
    slideId: section.id,
    index: presentation.slides.findIndex((slide) => slide.id === section.id),
    title: docToPlainText(section.title).trim(),
    subtitle: docToPlainText(section.subtitle).trim(),
    accentColor: section.accentColor,
    backgroundColor: section.backgroundColor,
  }
}

/** The section a call names, or the refusal that says why it is not one. */
function section(presentation: Presentation, slideId: string): Result<SectionSlide> {
  const found = findSectionSlide(presentation, slideId)
  if (found) return ok(found)
  return presentation.slides.some((slide) => slide.id === slideId)
    ? err('NOT_A_SECTION_SLIDE', 'Sliden er ikke en seksjon.')
    : err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
}

/* ------------------------------------------------------------------ *
 * add_section
 * ------------------------------------------------------------------ */

export const addSectionOperation = defineOperation({
  name: 'add_section',
  summary:
    'Legg til en seksjonsslide: en side med en stor overskrift og en valgfri underoverskrift i fargede piller. En seksjon åpner en del av dekket, og gir slidene etter seg – fram til neste seksjon – sin aksentfarge og sin bakgrunnsfarge. Fargene arves fra forrige seksjon når de ikke oppgis.',
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
      .describe('Posisjon i dekket. Utelatt legger seksjonen sist.'),
    title: sectionLineSchema.describe('Hovedoverskriften. Én linje, alltid midtstilt.'),
    subtitle: sectionLineSchema
      .optional()
      .describe('Underoverskriften. Utelatt gir en seksjon med bare hovedoverskrift.'),
    accentColor: z
      .string()
      .optional()
      .describe('Hex-farge. Utelatt arver forrige seksjons aksentfarge.'),
    backgroundColor: z
      .string()
      .optional()
      .describe('Hex-farge. Utelatt arver forrige seksjons bakgrunnsfarge.'),
  }),
  run(context, input): Promise<AgentResult<SectionView>> {
    return mutatePresentation(context, input, (presentation) => {
      const added = addSection(presentation, {
        index: input.index,
        title: input.title,
        subtitle: input.subtitle,
        accentColor: input.accentColor,
        backgroundColor: input.backgroundColor,
        ...structuralOptions(context),
      })
      if (!added.ok) return added
      // The command decides where it landed, so the id comes from comparing the
      // two documents rather than from an index the caller may not have given.
      const before = new Set(presentation.slides.map((slide) => slide.id))
      const created = added.value.slides.find((slide) => !before.has(slide.id))
      if (!created || created.kind !== 'section') {
        return err('INVALID_CONTENT', 'Seksjonen ble ikke lagt til.')
      }
      return ok({ presentation: added.value, value: sectionView(added.value, created) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_section
 * ------------------------------------------------------------------ */

export const setSectionOperation = defineOperation({
  name: 'set_section',
  summary:
    'Sett overskrift og/eller underoverskrift på en seksjonsslide. Begge er alltid midtstilt, og avvises hvis de ikke får plass på én linje. En tom underoverskrift fjerner pillen, og overskriften står da midtstilt alene.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    title: sectionLineSchema.optional().describe('Utelatt beholder overskriften som står der.'),
    subtitle: sectionLineSchema.optional().describe('Utelatt beholder underoverskriften.'),
  }),
  run(context, input): Promise<AgentResult<SectionView>> {
    return mutatePresentation(context, input, (presentation) => {
      const found = section(presentation, input.slideId)
      if (!found.ok) return found
      const options = structuralOptions(context)
      // Both lines in one document: set separately, a subheading that does not
      // fit would be refused only after the heading had already been stored.
      const applied = applySteps(presentation, [
        (current) =>
          input.title === undefined
            ? ok(current)
            : setSectionTitle(current, input.slideId, titleDoc(input.title), options),
        (current) =>
          input.subtitle === undefined
            ? ok(current)
            : setSectionSubtitle(current, input.slideId, titleDoc(input.subtitle), options),
      ])
      if (!applied.ok) return applied
      const updated = findSectionSlide(applied.value, input.slideId)
      if (!updated) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
      return ok({ presentation: applied.value, value: sectionView(applied.value, updated) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_section_colors
 * ------------------------------------------------------------------ */

export const setSectionColorsOperation = defineOperation({
  name: 'set_section_colors',
  summary:
    'Sett aksentfargen og/eller bakgrunnsfargen på en seksjonsslide. Begge gjelder seksjonen og slidene etter den, fram til neste seksjon: aksentfargen maler pillene her og alle overskrifter, kortheadere og bildetekster uten egen farge; bakgrunnsfargen er sidefargen. Overskrifter som har fått en egen farge, beholder den.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    accentColor: z
      .string()
      .optional()
      .describe('Hex-farge, for eksempel «#33475b». Tekstfargen utledes av kontrast.'),
    backgroundColor: z
      .string()
      .optional()
      .describe('Hex-farge, for eksempel «#101828». Tekstfargen utledes av kontrast.'),
  }),
  run(context, input): Promise<AgentResult<SectionView>> {
    return mutatePresentation(context, input, (presentation) => {
      const found = section(presentation, input.slideId)
      if (!found.ok) return found
      // Both colours in one step, for the same reason the two lines are: a
      // background that is refused must not leave an accent behind it.
      const applied = applySteps(presentation, [
        (current) =>
          input.accentColor === undefined
            ? ok(current)
            : setSectionAccentColor(current, input.slideId, input.accentColor),
        (current) =>
          input.backgroundColor === undefined
            ? ok(current)
            : setSectionBackgroundColor(current, input.slideId, input.backgroundColor),
      ])
      if (!applied.ok) return applied
      const updated = findSectionSlide(applied.value, input.slideId)
      if (!updated) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
      return ok({ presentation: applied.value, value: sectionView(applied.value, updated) })
    })
  },
})

export const sectionOperations = [
  addSectionOperation,
  setSectionOperation,
  setSectionColorsOperation,
]
