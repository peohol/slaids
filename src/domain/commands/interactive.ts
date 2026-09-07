/**
 * Interactive slide commands.
 *
 * An interactive slide is a slide, so adding, deleting, moving and duplicating
 * one are `slides.ts`'s job and are not repeated here. What is left is the
 * three things only this kind has: its creation from a file, its name, and the
 * file itself.
 *
 * None of them is fit-gated, and the omission is deliberate rather than
 * forgotten — see the command list in `fitGuard.ts`. A miniapp's internal
 * layout is the miniapp's own business and is never measured as a zone tree;
 * the cover the deck draws for it has no text a font could push out of a box;
 * and the slide cannot cite, so inserting or moving one cannot renumber a
 * citation anywhere else. There is nothing for a guard to measure.
 *
 * What *is* checked, on every write, is the file: `domain/interactive.ts`
 * decides whether the source may be stored, and the deck-wide budget is asked
 * before anything is committed. A refusal leaves the presentation exactly as
 * it was — the same object, not an equal one — so a replacement that fails
 * keeps the app that was there.
 */

import {
  acceptInteractiveHtml,
  interactiveBudgetRefusal,
  normalizeInteractiveName,
  suggestedInteractiveName,
} from '../interactive'
import { createInteractiveSlide, findInteractiveSlide, withSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import type { InteractiveSlide, Presentation } from '../types'
import { insertionIndex, withSlides } from './internal'

/** The slide a call names, or the refusal that says why it is not one. */
export function interactiveSlide(
  presentation: Presentation,
  slideId: string,
): Result<InteractiveSlide> {
  const found = findInteractiveSlide(presentation, slideId)
  if (found) return ok(found)
  return presentation.slides.some((slide) => slide.id === slideId)
    ? err('NOT_AN_INTERACTIVE_SLIDE', 'Sliden er ikke en interaktiv slide.', { slideId })
    : err('SLIDE_NOT_FOUND', 'Fant ikke sliden.', { slideId })
}

export interface AddInteractiveSlideInput {
  /** Insert position; defaults to the end of the deck. */
  index?: number
  /** What the cover shows. Defaults to the file name without its extension. */
  name?: string
  fileName: string
  /** The complete file, already decoded as UTF-8 text. */
  html: string
}

/**
 * A new interactive slide from a file.
 *
 * The file is validated first and the budget asked second, before a slide
 * exists at all: a refusal creates nothing, and a slide that exists is one
 * whose file passed. The name falls back to the file's own, without its
 * extension, which is what the dialog suggests too.
 */
export function addInteractiveSlide(
  presentation: Presentation,
  input: AddInteractiveSlideInput,
): Result<Presentation> {
  const at = insertionIndex(presentation, input.index, 'Ugyldig posisjon for ny interaktiv slide.')
  if (!at.ok) return at

  const source = acceptInteractiveHtml({ fileName: input.fileName, html: input.html })
  if (!source.ok) return source
  const name = normalizeInteractiveName(
    input.name ?? suggestedInteractiveName(source.value.fileName),
  )
  if (!name.ok) return name
  const budget = interactiveBudgetRefusal(presentation, source.value.byteSize)
  if (budget) return budget

  const slide = createInteractiveSlide({
    name: name.value,
    fileName: source.value.fileName,
    html: source.value.html,
  })
  const slides = [...presentation.slides]
  slides.splice(at.value, 0, slide)
  return withSlides(presentation, slides)
}

export function setInteractiveSlideName(
  presentation: Presentation,
  slideId: string,
  name: string,
): Result<Presentation> {
  const found = interactiveSlide(presentation, slideId)
  if (!found.ok) return found
  const normalized = normalizeInteractiveName(name)
  if (!normalized.ok) return normalized
  if (normalized.value === found.value.name) return ok(presentation)
  return ok(withSlide(presentation, { ...found.value, name: normalized.value }))
}

/**
 * Replace the file behind a slide.
 *
 * Both fields go together — a file is its name and its bytes — and the slide
 * keeps its identity, its position and its cover name, so nothing that
 * addresses it has to change. The budget is measured with this slide's own
 * source left out: it is the one being replaced, not added to.
 */
export function setInteractiveSlideHtml(
  presentation: Presentation,
  slideId: string,
  input: { fileName: string; html: string },
): Result<Presentation> {
  const found = interactiveSlide(presentation, slideId)
  if (!found.ok) return found
  const source = acceptInteractiveHtml(input)
  if (!source.ok) return source
  const budget = interactiveBudgetRefusal(presentation, source.value.byteSize, {
    excludingSlideId: slideId,
  })
  if (budget) return budget
  if (source.value.html === found.value.html && source.value.fileName === found.value.fileName) {
    return ok(presentation)
  }
  return ok(
    withSlide(presentation, {
      ...found.value,
      fileName: source.value.fileName,
      html: source.value.html,
    }),
  )
}
