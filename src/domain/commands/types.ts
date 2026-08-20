/** Shared inputs and outcome shapes for structural domain commands. */

import type { GeometryOptions } from '../geometry'
import type { ContentFitChecker } from '../fit'
import type { Presentation, ZoneContent } from '../types'

/** What happens to content that a structural change would otherwise destroy. */
export type ContentDisposition = 'sandbox' | 'delete'

export interface StructuralOptions {
  geometry?: GeometryOptions
  /** Injected so the domain layer stays free of DOM measurement. */
  fits?: ContentFitChecker
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
