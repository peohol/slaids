/** Shared inputs and outcome shapes for structural domain commands. */

import type { GeometryOptions } from '../geometry'
import type { ContentFitChecker, TitleFitChecker } from '../fit'
import type { CitationStyle } from '../references'
import type { Presentation, ZoneContent } from '../types'

/** What happens to content that a structural change would otherwise destroy. */
export type ContentDisposition = 'sandbox' | 'delete'

/**
 * Fit checkers are injected so the domain layer stays free of DOM measurement.
 *
 * Omitting them turns fit validation off for that call, which is deliberate:
 * loading, migrating and repairing a document must never be blocked by a rule
 * about how much text fits, and a person editing in the app is never refused
 * for lack of room either — what does not fit is drawn smaller
 * (`HUMAN_EDIT` in `manualLayout.ts`). An agent's calls always pass both
 * (`structuralOptions` in `agent/presentation.ts`), so an agent can never
 * validate zones but not slide titles, or skip the rule.
 */
export interface StructuralOptions {
  geometry?: GeometryOptions
  citationStyle?: CitationStyle
  fits?: ContentFitChecker
  fitsTitle?: TitleFitChecker
}

/**
 * Structural commands report what happened to displaced content so the UI can
 * tell the user, rather than silently losing it.
 */
export interface StructuralOutcome {
  presentation: Presentation
  movedToSandbox: ZoneContent[]
  discarded: ZoneContent[]
}

export function outcome(
  presentation: Presentation,
  movedToSandbox: ZoneContent[] = [],
  discarded: ZoneContent[] = [],
): StructuralOutcome {
  return { presentation, movedToSandbox, discarded }
}
