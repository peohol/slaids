/**
 * Read-only validation.
 *
 * `IMPLEMENTATION_PLAN.md` §44 is explicit that these never repair anything.
 * That is not caution, it is the whole point: an agent that asks "is this
 * right?" and gets back "it is now" has learned nothing about what it built,
 * and a validator that quietly edits is a mutation with a misleading name.
 *
 * A successful mutation is also not a substitute for asking. Every command
 * checks what *it* changes; nothing checks the deck as a whole, and some
 * problems only exist between operations — a file deleted after a zone was
 * pointed at it, a reference removed while a slide still cited it, an imported
 * document that arrived overflowing. That is what these two answer.
 *
 * The checks themselves live in `domain/validation.ts`, so the editor can ask
 * the same questions and get the same answers.
 */

import { z } from 'zod'
import { findPresentationIssues, findSlideIssues, type InvariantIssue } from '../../domain/validation'
import { findSlide } from '../../domain/presentation'
import { presentationRevision } from '../../domain/revision'
import { defineOperation, presentationIdSchema, slideIdSchema } from '../operation'
import { loadPresentation, structuralOptions } from '../presentation'
import { agentErr, agentOk, type AgentResult } from '../types'

export interface ValidationReport {
  presentationId: string
  /** The reading this report describes, usable as `expectedRevision`. */
  revision: string
  slideId?: string
  valid: boolean
  issues: InvariantIssue[]
}

export const validateSlideOperation = defineOperation({
  name: 'validate_slide',
  summary:
    'Sjekk én slide mot domenets regler: struktur, geometri, innhold som ikke får plass, manglende filer og ugyldige referanser. Endrer ingenting.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({ presentationId: presentationIdSchema, slideId: slideIdSchema }),
  async run(context, input): Promise<AgentResult<ValidationReport>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    const presentation = loaded.value
    const slide = findSlide(presentation, input.slideId)
    if (!slide) {
      return agentErr('SLIDE_NOT_FOUND', 'Fant ikke sliden.', {
        presentationId: presentation.id,
        slideId: input.slideId,
      })
    }

    // The same fit checkers the commands run under, so "does it fit" does not
    // get one answer when writing and another when checking.
    const issues = findSlideIssues(presentation, slide, structuralOptions(context))
    return agentOk({
      presentationId: presentation.id,
      revision: presentationRevision(presentation),
      slideId: slide.id,
      valid: issues.length === 0,
      issues,
    })
  },
})

export const validatePresentationOperation = defineOperation({
  name: 'validate_presentation',
  summary:
    'Sjekk hele presentasjonen: lagret form, alle slides og innholdet som ligger i sandkassen. Endrer ingenting.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({ presentationId: presentationIdSchema }),
  async run(context, input): Promise<AgentResult<ValidationReport>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    const issues = findPresentationIssues(loaded.value, structuralOptions(context))
    return agentOk({
      presentationId: loaded.value.id,
      revision: presentationRevision(loaded.value),
      valid: issues.length === 0,
      issues,
    })
  },
})

export const validationOperations = [validateSlideOperation, validatePresentationOperation]
