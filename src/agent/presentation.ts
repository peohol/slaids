/**
 * Reading and writing a presentation on an agent's behalf.
 *
 * Every mutating operation has the same shape — load, check the caller's
 * expectations, run domain commands, save — and the interesting parts are what
 * happens when a step fails and what the caller is told about it, so it is
 * written once here rather than in each operation.
 *
 * Three guarantees live in this file, and each of them is a §44 requirement:
 *
 *  - **Atomicity.** Domain commands are pure: they take a presentation and
 *    return a new one. Several of them can therefore be chained in memory
 *    (`applySteps`) and the result saved once. A failure at any step returns
 *    before anything is written, so there is no such thing as a half-applied
 *    operation — not because it is rolled back, but because it was never stored.
 *  - **Concurrency.** A caller may state the revision it read; it is checked
 *    against the document just loaded, before any command runs, and a mismatch
 *    is a `CONFLICT` rather than an overwrite. The write itself is guarded
 *    separately and always, against the revision this operation loaded, so two
 *    concurrent operations cannot both pass their check and have the second one
 *    win. See `domain/revision.ts` for why those are two windows and not two
 *    versions of the same guard.
 *  - **Actionable failures.** A fit error is only useful if it says where and by
 *    how much, so a failure is enriched with the slide, the zone, that zone's
 *    rectangle and the measured overflow before it goes back out.
 */

import { estimateFitChecker, estimateTitleFitChecker } from '../domain/fit'
import { computeSlideGeometry, TITLE_NODE_ID } from '../domain/geometry'
import { geometryForTheme } from '../domain/metrics'
import { findSlide } from '../domain/presentation'
import { presentationRevision } from '../domain/revision'
import type { StructuralOptions } from '../domain/commands'
import type { DomainError, Result } from '../domain/result'
import type { Presentation, Rect } from '../domain/types'
import {
  RepositoryConflictError,
  RepositoryError,
  RepositoryNotFoundError,
} from '../persistence/repository'
import {
  agentErr,
  agentOk,
  type AgentContext,
  type AgentError,
  type AgentResult,
} from './types'

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

/**
 * Store a document, refusing to overwrite a copy that moved since it was read.
 *
 * `guardedBy` is the revision of the document this operation loaded, and it is
 * passed on every agent write — never only when the caller asked for it. The
 * caller's own `expectedRevision` covers the long window between *its* read and
 * its decision; this covers the short one between our load and our save, which
 * is a different race and the only one two concurrent agent calls can lose.
 *
 * Both repositories honour it, and both had to grow something to do so: Dexie
 * compares the stored document inside the transaction that writes, and Supabase
 * looks up the database version *this reading* came from rather than the row's
 * latest known one — a version that a concurrent save has already moved forward
 * is not a guard, it is a licence to overwrite whoever moved it.
 */
export async function savePresentation(
  context: AgentContext,
  presentation: Presentation,
  guardedBy?: string,
): Promise<AgentResult<Presentation>> {
  try {
    await context.repository.savePresentation(
      presentation,
      guardedBy ? { expectedRevision: guardedBy } : undefined,
    )
    return agentOk(presentation)
  } catch (error) {
    return storageFailure(error, 'Kunne ikke lagre presentasjonen.', {
      presentationId: presentation.id,
    })
  }
}

/* ------------------------------------------------------------------ *
 * Concurrency
 * ------------------------------------------------------------------ */

/**
 * Refuse to act on a reading the caller no longer has.
 *
 * The comparison is against the document that was *just* loaded, so what it
 * catches is a caller whose knowledge is stale — not a write losing a race,
 * which is the repository's job. Both come back as `CONFLICT`, because the
 * agent's next move is the same either way: read again.
 */
export function revisionConflict(
  presentation: Presentation,
  expected: string | undefined,
  /** The loaded document's revision, when the caller has already computed it. */
  revision = presentationRevision(presentation),
): AgentResult<never> | null {
  if (!expected || revision === expected) return null
  return agentErr(
    'CONFLICT',
    'Presentasjonen er endret siden du leste den. Les den på nytt før du skriver.',
    { presentationId: presentation.id, expectedRevision: expected, revision },
  )
}

/* ------------------------------------------------------------------ *
 * Mutation
 * ------------------------------------------------------------------ */

/** The document a command produced, and whatever the operation wants to report. */
export interface Mutation<T> {
  presentation: Presentation
  value: T
}

/**
 * What a mutating operation was aimed at.
 *
 * Every mutating operation's input already has these fields, so an operation
 * passes its own input straight in and the failure path gets the context for
 * free — which is what keeps "which zone did not fit?" from being answered
 * differently by each operation.
 */
export interface MutationRequest {
  presentationId: string
  expectedRevision?: string
  slideId?: string
  nodeId?: string
}

/** Every mutation answers with the revision its write produced. */
export type Mutated<T> = T & { revision: string }

/**
 * Run domain commands in order against one in-memory document.
 *
 * This is what makes a semantic operation that needs several domain steps
 * atomic without inventing a transaction: the intermediate documents never
 * leave this function, and the caller only ever saves the last one.
 */
export function applySteps(
  presentation: Presentation,
  steps: readonly ((current: Presentation) => Result<Presentation>)[],
): Result<Presentation> {
  let current = presentation
  for (const step of steps) {
    const applied = step(current)
    if (!applied.ok) return applied
    current = applied.value
  }
  return { ok: true, value: current }
}

/**
 * Load, apply, save.
 *
 * The command's own typed error is passed through with its vocabulary intact —
 * an agent sees the same `CONTENT_DOES_NOT_FIT` the editor does — and gains the
 * context only the caller knew. What the operation answers with is separate
 * from what gets saved, because a structural command reports more than the new
 * document: displaced content, for one.
 */
export async function mutatePresentation<T extends object>(
  context: AgentContext,
  request: MutationRequest,
  apply: (presentation: Presentation) => Result<Mutation<T>>,
): Promise<AgentResult<Mutated<T>>> {
  const loaded = await loadPresentation(context, request.presentationId)
  if (!loaded.ok) return loaded
  const loadedRevision = presentationRevision(loaded.value)

  const conflict = revisionConflict(loaded.value, request.expectedRevision, loadedRevision)
  if (conflict) return conflict

  const applied = apply(loaded.value)
  if (!applied.ok) return { ok: false, error: describeFailure(loaded.value, applied.error, request, context) }

  const saved = await savePresentation(context, applied.value.presentation, loadedRevision)
  if (!saved.ok) return saved
  return agentOk({ ...applied.value.value, revision: presentationRevision(saved.value) })
}

/* ------------------------------------------------------------------ *
 * Failures an agent can act on
 * ------------------------------------------------------------------ */

/** Codes that are about one zone, and therefore worth locating. */
const ZONE_CODES = new Set([
  'CONTENT_DOES_NOT_FIT',
  'ZONE_TOO_SMALL',
  'NODE_NOT_FOUND',
  'NODE_NOT_LEAF',
  'NODE_NOT_SPLIT',
  'TARGET_OCCUPIED',
  'TARGET_EMPTY',
  'SUBFIELD_NOT_FOUND',
  'INVALID_CONTENT',
])

/**
 * The rect a zone occupies in the document as it stands.
 *
 * Reported alongside an overflow so the loop §44 describes —
 * `set_zone_text` → `CONTENT_DOES_NOT_FIT` → shorter text → `set_zone_text` —
 * can be walked without guessing: the overflow says how much did not fit, and
 * the rect says how much room there was to begin with.
 */
function zoneRect(
  presentation: Presentation,
  context: AgentContext,
  slideId: string | undefined,
  nodeId: string | undefined,
): Rect | null {
  if (!slideId || !nodeId) return null
  const slide = findSlide(presentation, slideId)
  if (!slide) return null
  const geometry = computeSlideGeometry(slide, {
    ...geometryForTheme(presentation.theme),
    ...context.geometry,
  })
  return geometry.rects.get(nodeId) ?? null
}

/**
 * A domain error with the context the operation had and the command did not.
 *
 * A command that refuses a placement knows the overflow; it does not always
 * know which slide the agent thinks it is working on, and it never knows the
 * agent's own idea of the target. Filled in here, never overwritten: a detail
 * the command reported is the more precise one — the fit guard can refuse a
 * command because of a zone on a slide nobody mentioned.
 */
function describeFailure(
  presentation: Presentation,
  error: DomainError,
  request: MutationRequest,
  context: AgentContext,
): AgentError {
  const details: Record<string, unknown> = {
    presentationId: request.presentationId,
    ...(request.slideId ? { slideId: request.slideId } : {}),
    ...(request.nodeId && ZONE_CODES.has(error.code) ? { nodeId: request.nodeId } : {}),
    ...error.details,
  }

  if (error.code === 'CONTENT_DOES_NOT_FIT' || error.code === 'ZONE_TOO_SMALL') {
    const slideId = typeof details.slideId === 'string' ? details.slideId : undefined
    const nodeId = typeof details.nodeId === 'string' ? details.nodeId : undefined
    details.subject = nodeId === TITLE_NODE_ID ? 'slide-title' : 'zone-content'
    // Only when the command did not report one. A command that measured against
    // a rectangle the document does not have yet — the prospective child of a
    // split — knows the right one, and looking `nodeId` up here would answer
    // with the zone as it stands instead.
    if (details.rect === undefined) {
      const rect = zoneRect(presentation, context, slideId, nodeId)
      if (rect) details.rect = rect
    }
  }

  return { code: error.code, message: error.message, details }
}

/**
 * A failed repository call, told apart.
 *
 * Three answers, because they call for three different next moves:
 *
 *  - **an absent row** is `PRESENTATION_NOT_FOUND`. The same rule as
 *    `loadPresentation`: an agent should read a missing presentation as gone and
 *    stop, and collapsing it into a store failure would have it retry forever
 *    against something that will never be there.
 *  - **a conflict** is not a broken store either: somebody else saved first, and
 *    the caller can read again and retry.
 *  - **anything else** is the store itself failing, and in Supabase mode that is
 *    never answered with a quiet local write — see the storage-mode invariant in
 *    `CLAUDE.md`.
 */
export function storageFailure<T = never>(
  error: unknown,
  message: string,
  details: Record<string, unknown>,
): AgentResult<T> {
  // Before the `RepositoryError` branch: it is a subclass, and the general case
  // would otherwise swallow the specific one.
  if (error instanceof RepositoryNotFoundError) {
    return agentErr('PRESENTATION_NOT_FOUND', error.message, details)
  }
  if (error instanceof RepositoryConflictError) {
    return agentErr('CONFLICT', error.message, details)
  }
  if (error instanceof RepositoryError) {
    return agentErr('STORAGE_FAILED', error.message, details)
  }
  return agentErr('STORAGE_FAILED', message, details)
}
