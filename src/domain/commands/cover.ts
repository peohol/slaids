/**
 * Cover commands.
 *
 * The cover is the one page every deck has and no deck can lose, so there is no
 * command to add one, delete one or make a second — only three that change what
 * the one cover says. It has no zone tree either, which is why none of these
 * takes a node id.
 *
 * All three funnel through `guardFit`, which measures the cover itself: both
 * lines are single lines of heading type, so text that would be clipped is
 * refused rather than hidden. See `fitGuard.ts`.
 */

import { normalizeHex } from '../color'
import { withCover } from '../presentation'
import { err, ok, type Result } from '../result'
import type { Presentation, TitleDoc } from '../types'
import { guardFit } from './fitGuard'
import type { StructuralOptions } from './types'

export function setCoverTitle(
  presentation: Presentation,
  doc: TitleDoc,
  options: StructuralOptions = {},
): Result<Presentation> {
  const next = withCover(presentation, { ...presentation.cover, title: doc })
  return guardFit(presentation, next, options, 'Tittelen får ikke plass på forsiden.')
}

export function setCoverSubtitle(
  presentation: Presentation,
  doc: TitleDoc,
  options: StructuralOptions = {},
): Result<Presentation> {
  const next = withCover(presentation, { ...presentation.cover, subtitle: doc })
  return guardFit(presentation, next, options, 'Undertittelen får ikke plass på forsiden.')
}

/**
 * The colour of the cover's pills — and, by the same act, the deck's default
 * heading colour.
 *
 * That is not a side effect to be split into a second command: there is one
 * value, stored once, and every heading that never had a colour picked for it
 * reads it. Changing it here is how an author restyles the deck's headings, and
 * a heading that *was* given a colour keeps the one it was given.
 *
 * Validated here rather than only in the schema, for the same reason a theme
 * colour is: an invalid value would be autosaved and then refused on load,
 * leaving the presentation permanently unopenable.
 */
export function setCoverPillColor(
  presentation: Presentation,
  color: string,
): Result<Presentation> {
  const normalized = normalizeHex(color)
  if (!normalized) return err('INVALID_ARGUMENT', 'Ugyldig farge.')
  if (normalized === presentation.cover.pillColor) return ok(presentation)
  return ok(withCover(presentation, { ...presentation.cover, pillColor: normalized }))
}
