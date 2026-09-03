/**
 * The cover.
 *
 * Every deck has exactly one and no deck can lose it, so there is nothing here
 * to create or delete — only what the one cover says. Two operations rather
 * than three: the text is one thing an agent sets in one step, and the colour is
 * a separate decision with a consequence beyond the cover.
 *
 * The lines are plain strings, not spans: the cover cannot cite. A citation's
 * number comes from where it first occurs among the *slides*, so one on the
 * cover would render an empty pill — the schema leaves it out rather than the
 * toolbar hiding it, and this input says the same thing.
 */

import { z } from 'zod'
import { setCoverPillColor, setCoverSubtitle, setCoverTitle } from '../../domain/commands'
import { docToPlainText, titleDoc } from '../../domain/richdoc'
import { ok, type Result } from '../../domain/result'
import type { Presentation } from '../../domain/types'
import { defineOperation, expectedRevisionSchema, presentationIdSchema } from '../operation'
import { applySteps, mutatePresentation, structuralOptions } from '../presentation'
import type { AgentResult } from '../types'

const coverLineSchema = z.string().max(400)

export interface CoverView {
  presentationId: string
  title: string
  subtitle: string
  /** Also the deck's default heading colour. */
  pillColor: string
}

export function coverView(presentation: Presentation): CoverView {
  return {
    presentationId: presentation.id,
    title: docToPlainText(presentation.cover.title).trim(),
    subtitle: docToPlainText(presentation.cover.subtitle).trim(),
    pillColor: presentation.cover.pillColor,
  }
}

/* ------------------------------------------------------------------ *
 * set_cover
 * ------------------------------------------------------------------ */

export const setCoverOperation = defineOperation({
  name: 'set_cover',
  summary:
    'Sett tittel og/eller undertittel på forsiden. Begge er alltid midtstilt, og avvises hvis de ikke får plass på én linje.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    title: coverLineSchema.optional().describe('Utelatt beholder tittelen som står der.'),
    subtitle: coverLineSchema.optional().describe('Utelatt beholder undertittelen.'),
  }),
  run(context, input): Promise<AgentResult<CoverView>> {
    return mutatePresentation(context, input, (presentation) => {
      const options = structuralOptions(context)
      // Both lines in one document: set separately, a subtitle that does not fit
      // would be refused only after the title had already been stored.
      const applied = applySteps(presentation, [
        (current) =>
          input.title === undefined
            ? ok(current)
            : setCoverTitle(current, titleDoc(input.title), options),
        (current) =>
          input.subtitle === undefined
            ? ok(current)
            : setCoverSubtitle(current, titleDoc(input.subtitle), options),
      ])
      if (!applied.ok) return applied
      return ok({ presentation: applied.value, value: coverView(applied.value) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_cover_color
 * ------------------------------------------------------------------ */

export const setCoverColorOperation = defineOperation({
  name: 'set_cover_color',
  summary:
    'Sett bakgrunnsfargen på forsidens piller. Den er samtidig standardfargen for overskrifter i innholdet: overskrifter uten egen farge følger den.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    color: z
      .string()
      .describe('Hex-farge, for eksempel «#33475b». Tekstfargen utledes av kontrast.'),
  }),
  run(context, input): Promise<AgentResult<CoverView>> {
    return mutatePresentation(context, input, (presentation): Result<{
      presentation: Presentation
      value: CoverView
    }> => {
      const recoloured = setCoverPillColor(presentation, input.color)
      if (!recoloured.ok) return recoloured
      return ok({ presentation: recoloured.value, value: coverView(recoloured.value) })
    })
  },
})

export const coverOperations = [setCoverOperation, setCoverColorOperation]
