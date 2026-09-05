/**
 * Section commands.
 *
 * A section is a slide, so adding, deleting, moving and duplicating one are
 * `slides.ts`'s job and are not repeated here. What is left is the four things
 * only a section has: its two lines and its two colours.
 *
 * The two text commands funnel through `guardFit`, which measures the section
 * itself: both lines are single lines of heading type, so text that would be
 * clipped is refused rather than hidden. See `fitGuard.ts`. The two colour
 * commands do not, for the reason a colour never needs one — it is not a size.
 *
 * Colours are validated here rather than only in the schema, for the same
 * reason a theme colour is: an invalid value would be autosaved and then
 * refused on load, leaving the presentation permanently unopenable.
 */

import { normalizeHex } from '../color'
import { findSectionSlide, withSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import type { Presentation, SectionSlide, TitleDoc } from '../types'
import { guardFit } from './fitGuard'
import type { StructuralOptions } from './types'

function section(presentation: Presentation, slideId: string): Result<SectionSlide> {
  const found = findSectionSlide(presentation, slideId)
  if (found) return ok(found)
  return presentation.slides.some((slide) => slide.id === slideId)
    ? err('NOT_A_SECTION_SLIDE', 'Sliden er ikke en seksjon.')
    : err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
}

export function setSectionTitle(
  presentation: Presentation,
  slideId: string,
  doc: TitleDoc,
  options: StructuralOptions = {},
): Result<Presentation> {
  const found = section(presentation, slideId)
  if (!found.ok) return found
  const next = withSlide(presentation, { ...found.value, title: doc })
  return guardFit(presentation, next, options, 'Overskriften får ikke plass på seksjonssliden.')
}

export function setSectionSubtitle(
  presentation: Presentation,
  slideId: string,
  doc: TitleDoc,
  options: StructuralOptions = {},
): Result<Presentation> {
  const found = section(presentation, slideId)
  if (!found.ok) return found
  const next = withSlide(presentation, { ...found.value, subtitle: doc })
  return guardFit(presentation, next, options, 'Underoverskriften får ikke plass på seksjonssliden.')
}

/**
 * The colour of a section's pills — and, by the same act, the default heading
 * colour for the section it opens.
 *
 * That is not a side effect to be split into a second command: there is one
 * value, stored once, and every heading from here to the next section that
 * never had a colour picked for it reads it. Changing it is how an author
 * restyles a part of the deck, and a heading that *was* given a colour keeps
 * the one it was given.
 */
export function setSectionAccentColor(
  presentation: Presentation,
  slideId: string,
  color: string,
): Result<Presentation> {
  const found = section(presentation, slideId)
  if (!found.ok) return found
  const normalized = normalizeHex(color)
  if (!normalized) return err('INVALID_ARGUMENT', 'Ugyldig farge.')
  if (normalized === found.value.accentColor) return ok(presentation)
  return ok(withSlide(presentation, { ...found.value, accentColor: normalized }))
}

/**
 * The page colour for this section and every slide up to the next one.
 *
 * It used to be one value for the whole deck, in the theme. It is a section's
 * now for the same reason the accent colour is: a deck reads as a run of parts,
 * and a part is what an author recolours.
 */
export function setSectionBackgroundColor(
  presentation: Presentation,
  slideId: string,
  color: string,
): Result<Presentation> {
  const found = section(presentation, slideId)
  if (!found.ok) return found
  const normalized = normalizeHex(color)
  if (!normalized) return err('INVALID_ARGUMENT', 'Ugyldig bakgrunnsfarge.')
  if (normalized === found.value.backgroundColor) return ok(presentation)
  return ok(withSlide(presentation, { ...found.value, backgroundColor: normalized }))
}
