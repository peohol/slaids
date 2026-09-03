/**
 * Slide-level domain commands.
 */

import {
  COVER_SUBTITLE_NODE_ID,
  computeMainRect,
  computeTitleRect,
  TITLE_NODE_ID,
} from '../geometry'
import { isDocEmpty } from '../richdoc'
import { normalizeHex } from '../color'
import { cloneSubtreeWithNewIds, createLeaf, geometryFor, subtreeFitsHelper } from './internal'
import {
  coverOverflow,
  findGeometryRegression,
  fitContextFor,
  guardFit,
  subtreeOverflow,
} from './fitGuard'
import { FIT_TOLERANCE } from '../constants'
import { FONT_SCALE_RANGE, SPACING_RANGE } from '../metrics'
import type { StructuralOptions } from './types'
import { COVER_PAGE_ID } from '../pages'
import {
  createPresentation,
  createSlide,
  findSlide,
  slideIndexOf,
  touch,
  withSlide,
} from '../presentation'
import type { CreatePresentationInput } from '../presentation'
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
  const mainRect = computeMainRect(hasTitle, geometryFor(presentation, input.geometry))
  for (const [nodeId, overflow] of subtreeOverflow(slide.root, mainRect, context, input)) {
    if (overflow > FIT_TOLERANCE) {
      return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass på den nye sliden.', {
        slideId: slide.id,
        nodeId,
        overflow,
      })
    }
  }

  // The UI only ever creates slides with an empty title, which is exactly why
  // this is checked here: a headless caller that supplies one must not get a
  // weaker rule than a caller that types the same text afterwards.
  const titleRect = slide.title ? computeTitleRect(true, geometryFor(presentation, input.geometry)) : null
  if (slide.title && titleRect && input.fitsTitle) {
    const fit = input.fitsTitle(slide.title, titleRect, context)
    if (!fit.fits) {
      return err('CONTENT_DOES_NOT_FIT', 'Overskriften får ikke plass i tittelsonen.', {
        slideId: slide.id,
        nodeId: TITLE_NODE_ID,
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

    // Guarded, even though this slide can only gain room by it. A title may
    // cite, and a citation that disappears takes its reference's first
    // occurrence with it: every reference numbered after it moves up, and a
    // label that was `1–2` can come back as `1, 3` — wider, on a slide nobody
    // touched. That is the same rule `setSlideTitle` follows when the *text* of
    // a title drops a citation, and dropping the whole zone must not be the way
    // around it. See the command list in `fitGuard.ts`.
    const without = withSlide(presentation, { ...slide, title: null })
    return guardFit(
      presentation,
      without,
      options,
      'Å fjerne overskriften renummererer citations, og da får innhold på en annen slide ikke lenger plass. Kort ned der først.',
    )
  }

  // Adding a title shrinks the main area by TITLE_ZONE_HEIGHT + G, so both the
  // structural minimum and the content itself must still fit.
  const mainRect = computeMainRect(true, geometryFor(presentation, options.geometry))
  if (!subtreeFitsHelper(slide.root, mainRect, geometryFor(presentation, options.geometry))) {
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

/**
 * A brand new presentation, refused when its cover cannot be read.
 *
 * `createPresentation` is a pure factory and stays one — loading, migrating and
 * importing all go through it and must never be blocked by a rule about how
 * much text fits. This is the *command* form, for the two places a person or an
 * agent creates a deck from text they just typed, and the check is the reason
 * it exists: the cover's title is seeded from the deck's name, so a name too
 * long for one line would otherwise be stored as a clipped cover — a state the
 * very next edit to that line would refuse. Creation gets the same answer as
 * editing, which is the whole content-fit rule.
 *
 * Absolute rather than a regression, like every other placement: there is no
 * previous state for a document that did not exist a moment ago.
 */
export function createDeck(
  input: CreatePresentationInput,
  options: StructuralOptions = {},
): Result<Presentation> {
  const presentation = createPresentation(input)
  for (const [nodeId, overflow] of coverOverflow(
    presentation.cover,
    fitContextFor(presentation),
    options,
  )) {
    if (overflow <= FIT_TOLERANCE) continue
    return err(
      'CONTENT_DOES_NOT_FIT',
      nodeId === COVER_SUBTITLE_NODE_ID
        ? 'Undertittelen får ikke plass på forsiden. Velg en kortere.'
        : 'Tittelen får ikke plass på forsiden på én linje. Velg en kortere.',
      { slideId: COVER_PAGE_ID, nodeId, overflow },
    )
  }
  return ok(presentation)
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
  if (theme.spacing !== undefined) {
    if (!inRange(theme.spacing, SPACING_RANGE)) {
      return err('INVALID_ARGUMENT', 'Ugyldig luftverdi.')
    }
    next.spacing = theme.spacing
  }
  if (theme.fontScale !== undefined) {
    if (!inRange(theme.fontScale, FONT_SCALE_RANGE)) {
      return err('INVALID_ARGUMENT', 'Ugyldig skriftstørrelse.')
    }
    next.fontScale = theme.fontScale
  }

  const updated = touch({ ...presentation, theme: next })

  // Two questions, and the fit one cannot answer the first. Luft and
  // skriftstørrelse move the geometry itself — the gap between zones and the
  // height of the title zone — so a change can leave a zone smaller than the
  // minimum without hiding a single character, and an empty zone would sail
  // through a check that measures content. Asked first, because a zone that is
  // too small to exist is not something shorter text would fix.
  const tooSmall = findGeometryRegression(presentation, updated, options)
  if (tooSmall) {
    return err('ZONE_TOO_SMALL', minimumRefusalMessage(theme), {
      slideId: tooSmall.slideId,
      nodeId: tooSmall.nodeId,
    })
  }

  // Every part of a theme is global: a wider font, more air or larger type can
  // push text out of every zone in the deck at once. The guard measures only
  // the slides the change can affect and only reports zones that got worse, so
  // a change that *reduces* overflow stays available as a repair.
  return guardFit(presentation, updated, options, refusalMessage(theme))
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max
}

/**
 * Name the dial that made a zone too small.
 *
 * Only the two scales can: a font changes how wide a glyph is, never where a
 * zone's edges are.
 */
function minimumRefusalMessage(patch: Partial<PresentationTheme>): string {
  const spacing = patch.spacing !== undefined
  const size = patch.fontScale !== undefined
  if (spacing && !size) {
    return 'Så mye luft gjør at soner blir mindre enn minstemålet. Velg mindre luft, eller del sliden i færre soner først.'
  }
  if (size && !spacing) {
    return 'Denne skriftstørrelsen gjør tittelsonen så høy at soner blir mindre enn minstemålet. Velg en mindre størrelse, eller del sliden i færre soner først.'
  }
  return 'Denne endringen gjør at soner blir mindre enn minstemålet. Del sliden i færre soner først.'
}

/** Name the setting that would hide something, and how to get around it. */
function refusalMessage(patch: Partial<PresentationTheme>): string {
  const fonts = patch.headingFontFamily !== undefined || patch.bodyFontFamily !== undefined
  const spacing = patch.spacing !== undefined
  const size = patch.fontScale !== undefined
  if (fonts && !spacing && !size) {
    return 'Denne fonten gjør at innhold ikke lenger får plass. Kort ned innholdet først, eller velg en smalere font.'
  }
  if (spacing && !fonts && !size) {
    return 'Så mye luft gjør at innhold ikke lenger får plass. Kort ned innholdet først, eller velg mindre luft.'
  }
  if (size && !fonts && !spacing) {
    return 'Denne skriftstørrelsen gjør at innhold ikke lenger får plass. Kort ned innholdet først, eller velg en mindre størrelse.'
  }
  return 'Denne endringen gjør at innhold ikke lenger får plass. Kort ned innholdet først.'
}

export function setFolder(
  presentation: Presentation,
  folderId: string | null,
): Result<Presentation> {
  return ok(touch({ ...presentation, folderId }))
}
