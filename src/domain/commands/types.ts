/** Shared inputs and outcome shapes for structural domain commands. */

import type { GeometryOptions } from '../geometry'
import type { ContentFitChecker, TitleFitChecker } from '../fit'
import type { Presentation, ZoneContent } from '../types'

/** What happens to content that a structural change would otherwise destroy. */
export type ContentDisposition = 'sandbox' | 'delete'

/**
 * Fit checkers are injected so the domain layer stays free of DOM measurement.
 *
 * Omitting them turns fit validation off for that call, which is deliberate:
 * loading, migrating and repairing a document must never be blocked by a rule
 * about how much text fits. Callers that *edit* a presentation pass both — the
 * UI and any future REST/MCP caller through one shared bundle, so neither can
 * accidentally validate zones but not slide titles.
 */
export interface StructuralOptions {
  geometry?: GeometryOptions
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
