/**
 * Reading and writing a presentation on an agent's behalf.
 *
 * Every mutating operation has the same shape — load, run one domain command,
 * save — and the interesting part is what happens when a step fails, so it is
 * written once here rather than in each operation.
 */

import { estimateFitChecker, estimateTitleFitChecker } from '../domain/fit'
import type { StructuralOptions } from '../domain/commands'
import type { Result } from '../domain/result'
import type { Presentation } from '../domain/types'
import {
  RepositoryConflictError,
  RepositoryError,
  RepositoryNotFoundError,
} from '../persistence/repository'
import { agentErr, agentOk, fromDomainError, type AgentContext, type AgentResult } from './types'

/**
 * The fit rules an operation runs under.
 *
 * A headless caller gets the pure estimator, which is the same one the domain
 * uses outside the browser; a caller that has a DOM can hand in the real
 * measurer through the context. Never omitted: the whole point of building the
 * agent API on the commands is that an agent cannot place content the editor
 * would have refused.
 */
export function structuralOptions(context: AgentContext): StructuralOptions {
  return {
    fits: context.fits ?? estimateFitChecker,
    fitsTitle: context.fitsTitle ?? estimateTitleFitChecker,
    ...(context.geometry ? { geometry: context.geometry } : {}),
  }
}

/**
 * Only an absent row is `PRESENTATION_NOT_FOUND`.
 *
 * A store that is down, a query that was refused and a stored document that no
 * longer validates are all `STORAGE_FAILED`: an agent should read a missing
 * presentation as gone and everything else as "try again or tell someone", and
 * collapsing the two would turn an outage into an apparent deletion.
 */
export async function loadPresentation(
  context: AgentContext,
  presentationId: string,
): Promise<AgentResult<Presentation>> {
  try {
    return agentOk(await context.repository.loadPresentation(presentationId))
  } catch (error) {
    if (error instanceof RepositoryNotFoundError) {
      return agentErr('PRESENTATION_NOT_FOUND', error.message, { presentationId })
    }
    return storageFailure(error, 'Kunne ikke hente presentasjonen.', { presentationId })
  }
}

export async function savePresentation(
  context: AgentContext,
  presentation: Presentation,
): Promise<AgentResult<Presentation>> {
  try {
    await context.repository.savePresentation(presentation)
    return agentOk(presentation)
  } catch (error) {
    return storageFailure(error, 'Kunne ikke lagre presentasjonen.', {
      presentationId: presentation.id,
    })
  }
}

/** The document a command produced, and whatever the operation wants to report. */
export interface Mutation<T> {
  presentation: Presentation
  value: T
}

/**
 * Load, apply one command, save.
 *
 * The command's own typed error is passed through untouched, so an agent sees
 * the same vocabulary the editor does. What the operation answers with is
 * separate from what gets saved, because a structural command reports more than
 * the new document — displaced content, for one.
 */
export async function mutatePresentation<T>(
  context: AgentContext,
  presentationId: string,
  apply: (presentation: Presentation) => Result<Mutation<T>>,
): Promise<AgentResult<T>> {
  const loaded = await loadPresentation(context, presentationId)
  if (!loaded.ok) return loaded

  const applied = apply(loaded.value)
  if (!applied.ok) return fromDomainError(applied.error)

  const saved = await savePresentation(context, applied.value.presentation)
  if (!saved.ok) return saved
  return agentOk(applied.value.value)
}

/**
 * A failed write, told apart.
 *
 * A conflict is not a broken store: somebody else saved first, and the caller
 * can read again and retry. Anything else is the store itself failing, and in
 * Supabase mode that is never answered with a quiet local write — see the
 * storage-mode invariant in `CLAUDE.md`.
 */
export function storageFailure<T = never>(
  error: unknown,
  message: string,
  details: Record<string, unknown>,
): AgentResult<T> {
  if (error instanceof RepositoryConflictError) {
    return agentErr('CONFLICT', error.message, details)
  }
  if (error instanceof RepositoryError) {
    return agentErr('STORAGE_FAILED', error.message, details)
  }
  return agentErr('STORAGE_FAILED', message, details)
}
