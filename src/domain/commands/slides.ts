/**
 * Slide-level domain commands.
 */

import { computeMainRect, computeTitleRect } from '../geometry'
import { isDocEmpty } from '../richdoc'
import { normalizeHex } from '../color'
import { cloneSubtreeWithNewIds, createLeaf, subtreeFitsHelper } from './internal'
import { fitContextFor, guardFit, subtreeOverflow } from './fitGuard'
import { FIT_TOLERANCE } from '../constants'
import type { StructuralOptions } from './types'
import { createSlide, findSlide, slideIndexOf, touch, withSlide } from '../presentation'
import { titleDoc } from '../richdoc'
import { err, ok, type Result } from '../result'
import type { LayoutNode, Presentation, PresentationTheme, TitleDoc } from '../types'

export interface AddSlideInput extends StructuralOptions {
  /** Insert position; defaults to the end of the deck. */
  index?: number
  hasTitle?: boolean
  /** Layout to start from, e.g. from a template. Ids are regenerated. */
  root?: LayoutNode
  title?: string
}

export function addSlide(
  presentation: Presentation,
  input: AddSlideInput = {},
): Result<Presentation> {
  const index = input.index ?? presentation.slides.length
  if (index < 0 || index > presentation.slides.length) {
    return err('SLIDE_INDEX_OUT_OF_RANGE', 'Ugyldig posisjon for ny slide.')
  }
  const hasTitle = input.hasTitle ?? true
  const slide = createSlide({
    hasTitle,
    root: input.root ? cloneSubtreeWithNewIds(input.root) : createLeaf(),
    title: input.title,
  })

  const slides = [...presentation.slides]
  slides.splice(index, 0, slide)
  const next = touch({ ...presentation, slides })
  const context = fitContextFor(next)

  // Editor templates are layout-only, but the command is also the API surface:
  // a caller that supplies a root with content in it gets the same placement
  // check as any other way of putting content on a slide. There is no baseline
  // to regress from on a brand new slide, so this one is absolute.
  const mainRect = computeMainRect(hasTitle, input.geometry)
  for (const overflow of subtreeOverflow(slide.root, mainRect, context, input).values()) {
    if (overflow > FIT_TOLERANCE) {
      return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass på den nye sliden.', { overflow })
    }
  }

  // The UI only ever creates slides with an empty title, which is exactly why
  // this is checked here: a headless caller that supplies one must not get a
  // weaker rule than a caller that types the same text afterwards.
  const titleRect = slide.title ? computeTitleRect(true, input.geometry) : null
  if (slide.title && titleRect && input.fitsTitle) {
    const fit = input.fitsTitle(slide.title, titleRect, context)
    if (!fit.fits) {
      return err('CONTENT_DOES_NOT_FIT', 'Overskriften får ikke plass i tittelsonen.', {
        overflow: fit.overflow,
      })
    }
  }

  // A new slide inserted before existing citations shifts their numbers up, so
  // `[9]` can become `[10]` on a slide the caller never mentioned.
  return guardFit(
    presentation,
    next,
    input,
    'Den nye sliden endrer citation-nummereringen slik at innhold på en annen slide ikke lenger får plass.',
  )
}

export function deleteSlide(presentation: Presentation, slideId: string): Result<Presentation> {
  const index = slideIndexOf(presentation, slideId)
  if (index < 0) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  if (presentation.slides.length <= 1) {
    return err('CANNOT_DELETE_LAST_SLIDE', 'Presentasjonen må ha minst én slide.')
  }
  const slides = presentation.slides.filter((slide) => slide.id !== slideId)
  return ok(touch({ ...presentation, slides }))
}

export function duplicateSlide(presentation: Presentation, slideId: string): Result<Presentation> {
  const index = slideIndexOf(presentation, slideId)
  if (index < 0) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const source = presentation.slides[index]
  const copy = createSlide({
    hasTitle: source.title !== null,
    root: cloneSubtreeWithNewIds(source.root),
  })
  const duplicated = source.title
    ? { ...copy, title: structuredClone(source.title) as TitleDoc }
    : copy
  const slides = [...presentation.slides]
  slides.splice(index + 1, 0, duplicated)
  return ok(touch({ ...presentation, slides }))
}

/**
 * Reordering slides is not a neutral operation: citation numbers come from
 * first-occurrence order across the deck, so moving a slide can widen a label
 * (`9` → `10`, or `1–3` → `1, 2`) on slides that were not touched at all.
 */
export function moveSlide(
  presentation: Presentation,
  slideId: string,
  toIndex: number,
  options: StructuralOptions = {},
): Result<Presentation> {
  const from = slideIndexOf(presentation, slideId)
  if (from < 0) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  if (toIndex < 0 || toIndex >= presentation.slides.length) {
    return err('SLIDE_INDEX_OUT_OF_RANGE', 'Ugyldig målposisjon.')
  }
  if (from === toIndex) return ok(presentation)
  const slides = [...presentation.slides]
  const [moved] = slides.splice(from, 1)
  slides.splice(toIndex, 0, moved)
  return guardFit(
    presentation,
    touch({ ...presentation, slides }),
    options,
    'Rekkefølgen endrer citation-nummereringen slik at innhold ikke lenger får plass.',
  )
}

/**
 * The title zone is one line at a fixed height, so a title that is too long is
 * rejected rather than clipped. As with the body text, the editor omits the
 * checkers and rolls back against the live DOM instead (IME safety); a headless
 * caller passes them and is validated here.
 */
export function setSlideTitle(
  presentation: Presentation,
  slideId: string,
  doc: TitleDoc,
  options: StructuralOptions = {},
): Result<Presentation> {
  const slide = findSlide(presentation, slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  if (slide.title === null) return err('TITLE_ABSENT', 'Sliden har ingen overskriftssone.')
  const next = withSlide(presentation, { ...slide, title: doc })
  return guardFit(presentation, next, options, 'Overskriften får ikke plass i tittelsonen.')
}

/**
 * Toggle the title zone.
 *
 * Adding a title shrinks the main area, so the existing layout subtree must
 * still satisfy the minimum zone sizes; removing a title only grows it.
 */
export interface SetSlideHasTitleOptions extends StructuralOptions {
  /**
   * Required to remove a title zone whose text is not empty. Without it the
   * command refuses, so no caller — UI or agent — can destroy a title by
   * accident.
   */
  force?: boolean
  /**
   * Text to put back into the zone in the same step, when adding one.
   *
   * Restoring a removed title is one operation, not two. Split into "add the
   * zone" followed by "set the text", the text is validated against a document
   * that already has the zone — and if that second step fails there is a bare
   * title zone left behind and a remembered title with nowhere to go. Passed
   * here, the whole thing either commits or leaves the presentation untouched.
   */
  title?: TitleDoc
}

export function setSlideHasTitle(
  presentation: Presentation,
  slideId: string,
  hasTitle: boolean,
  options: SetSlideHasTitleOptions = {},
): Result<Presentation> {
  const slide = findSlide(presentation, slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const currentlyHasTitle = slide.title !== null
  if (currentlyHasTitle === hasTitle) {
    return err(
      hasTitle ? 'TITLE_ALREADY_PRESENT' : 'TITLE_ABSENT',
      hasTitle ? 'Sliden har allerede en overskrift.' : 'Sliden har ingen overskrift.',
    )
  }

  if (!hasTitle) {
    if (options.title) {
      return err('INVALID_ARGUMENT', 'Kan ikke sette tekst på en overskrift som fjernes.')
    }
    if (slide.title && !isDocEmpty(slide.title) && !options.force) {
      return err(
        'INVALID_ARGUMENT',
        'Overskriften har tekst. Bekreft at den skal fjernes (force).',
      )
    }
    return ok(withSlide(presentation, { ...slide, title: null }))
  }

  // Adding a title shrinks the main area by TITLE_ZONE_HEIGHT + G, so both the
  // structural minimum and the content itself must still fit.
  const mainRect = computeMainRect(true, options.geometry)
  if (!subtreeFitsHelper(slide.root, mainRect, options.geometry)) {
    return err(
      'ZONE_TOO_SMALL',
      'Layoutet får ikke plass når overskriftssonen legges til. Forenkle soneinndelingen først.',
    )
  }
  const next = withSlide(presentation, { ...slide, title: options.title ?? titleDoc('') })
  // One guard for both halves: the main area has to keep fitting its content,
  // and a restored title has to fit the zone it is going back into — under the
  // typography in force *now*, which may not be the typography it was written
  // under.
  return guardFit(
    presentation,
    next,
    options,
    options.title
      ? 'Overskriften får ikke plass i tittelsonen med gjeldende font.'
      : 'Innholdet får ikke plass når overskriftssonen legges til.',
  )
}

export function setPresentationTitle(
  presentation: Presentation,
  title: string,
): Result<Presentation> {
  const trimmed = title.trim()
  if (!trimmed) return err('INVALID_ARGUMENT', 'Tittelen kan ikke være tom.')
  return ok(touch({ ...presentation, title: trimmed }))
}

/**
 * Theme values are validated here, not only in the schema: an invalid colour
 * would be autosaved and then rejected on load, leaving the presentation
 * permanently unopenable.
 */
export function setTheme(
  presentation: Presentation,
  theme: Partial<PresentationTheme>,
  options: StructuralOptions = {},
): Result<Presentation> {
  const next: PresentationTheme = { ...presentation.theme }

  if (theme.backgroundColor !== undefined) {
    const color = normalizeHex(theme.backgroundColor)
    if (!color) return err('INVALID_ARGUMENT', 'Ugyldig bakgrunnsfarge.')
    next.backgroundColor = color
  }
  if (theme.headingFontFamily !== undefined) {
    if (!theme.headingFontFamily.trim()) return err('INVALID_ARGUMENT', 'Fonten kan ikke være tom.')
    next.headingFontFamily = theme.headingFontFamily
  }
  if (theme.bodyFontFamily !== undefined) {
    if (!theme.bodyFontFamily.trim()) return err('INVALID_ARGUMENT', 'Fonten kan ikke være tom.')
    next.bodyFontFamily = theme.bodyFontFamily
  }

  // Fonts are global, so a wider font can push text out of every zone in the
  // deck at once. The guard measures only the slides a font change can affect
  // and only reports zones that got worse, so a font that *reduces* overflow
  // stays available as a repair.
  const updated = touch({ ...presentation, theme: next })
  return guardFit(
    presentation,
    updated,
    options,
    'Denne fonten gjør at innhold ikke lenger får plass. Kort ned innholdet først, eller velg en smalere font.',
  )
}

export function setFolder(
  presentation: Presentation,
  folderId: string | null,
): Result<Presentation> {
  return ok(touch({ ...presentation, folderId }))
}
