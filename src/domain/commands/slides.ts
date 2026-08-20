/**
 * Slide-level domain commands.
 */

import { computeMainRect } from '../geometry'
import { isDocEmpty } from '../richdoc'
import { normalizeHex } from '../color'
import { cloneSubtreeWithNewIds, createLeaf, findFitFailures, subtreeFitsHelper } from './internal'
import type { StructuralOptions } from './types'
import { createSlide, findSlide, slideIndexOf, touch, withSlide } from '../presentation'
import { titleDoc } from '../richdoc'
import { err, ok, type Result } from '../result'
import type { LayoutNode, Presentation, PresentationTheme, TitleDoc } from '../types'

export interface AddSlideInput {
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
  const slide = createSlide({
    hasTitle: input.hasTitle ?? true,
    root: input.root ? cloneSubtreeWithNewIds(input.root) : createLeaf(),
    title: input.title,
  })
  const slides = [...presentation.slides]
  slides.splice(index, 0, slide)
  return ok(touch({ ...presentation, slides }))
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

export function moveSlide(
  presentation: Presentation,
  slideId: string,
  toIndex: number,
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
  return ok(touch({ ...presentation, slides }))
}

export function setSlideTitle(
  presentation: Presentation,
  slideId: string,
  doc: TitleDoc,
): Result<Presentation> {
  const slide = findSlide(presentation, slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  if (slide.title === null) return err('TITLE_ABSENT', 'Sliden har ingen overskriftssone.')
  return ok(withSlide(presentation, { ...slide, title: doc }))
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
  const failures = findFitFailures(slide.root, mainRect, options.fits, options.geometry)
  if (failures.length > 0) {
    return err(
      'CONTENT_DOES_NOT_FIT',
      'Innholdet får ikke plass når overskriftssonen legges til.',
      { overflow: failures[0].overflow },
    )
  }
  return ok(withSlide(presentation, { ...slide, title: titleDoc('') }))
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
  return ok(touch({ ...presentation, theme: next }))
}

export function setFolder(
  presentation: Presentation,
  folderId: string | null,
): Result<Presentation> {
  return ok(touch({ ...presentation, folderId }))
}
