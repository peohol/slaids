/**
 * Slide-level domain commands.
 */

import {
  SECTION_SUBTITLE_NODE_ID,
  computeMainRect,
  computeTitleRect,
  TITLE_NODE_ID,
} from '../geometry'
import { isDocEmpty } from '../richdoc'
import {
  cloneSubtreeWithNewIds,
  contentSlide,
  createLeaf,
  geometryFor,
  insertionIndex,
  subtreeFitsHelper,
  withSlides,
} from './internal'
import { withQuantizedRatios } from '../layout'
import {
  nodeIdOfKey,
  partOfKey,
  sectionOverflow,
  findGeometryRegression,
  fitContextFor,
  guardFit,
  subtreeOverflow,
} from './fitGuard'
import { FIT_TOLERANCE, MAX_IMAGE_CONTEXT_CHARS, TITLED_CARD_STYLES } from '../constants'
import { FONT_SCALE_RANGE, SPACING_RANGE } from '../metrics'
import { syncImagePlaceholders } from './imagePlan'
import type { StructuralOptions } from './types'
import {
  createInteractiveSlide,
  createPresentation,
  createSection,
  createSlide,
  sectionGoverning,
  slideIndexOf,
  touch,
  withSlide,
} from '../presentation'
import type { CreatePresentationInput } from '../presentation'
import { titleDoc } from '../richdoc'
import { err, ok, type Result } from '../result'
import type { LayoutNode, Presentation, PresentationTheme, Slide, TitleDoc } from '../types'

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
  const at = insertionIndex(presentation, input.index, 'Ugyldig posisjon for ny slide.')
  if (!at.ok) return at
  const index = at.value
  const hasTitle = input.hasTitle ?? true
  const slide = createSlide({
    hasTitle,
    // A supplied layout is quantised on the way in for the same reason the
    // content in it is fit-checked: this is an API surface, and a root that
    // came from somewhere other than a command must meet the same rules as one
    // that did.
    root: input.root ? cloneSubtreeWithNewIds(withQuantizedRatios(input.root)) : createLeaf(),
    title: input.title,
  })

  const slides = [...presentation.slides]
  slides.splice(index, 0, slide)
  const inserted = withSlides(presentation, slides)
  if (!inserted.ok) return inserted
  const next = inserted.value
  const context = fitContextFor(next, input.citationStyle)

  // Editor templates are layout-only, but the command is also the API surface:
  // a caller that supplies a root with content in it gets the same placement
  // check as any other way of putting content on a slide. There is no baseline
  // to regress from on a brand new slide, so this one is absolute.
  const mainRect = computeMainRect(hasTitle, geometryFor(presentation, input.geometry))
  for (const [key, overflow] of subtreeOverflow(slide.root, mainRect, context, input)) {
    if (overflow > FIT_TOLERANCE) {
      const part = partOfKey(key)
      return err('CONTENT_DOES_NOT_FIT', 'Innholdet får ikke plass på den nye sliden.', {
        slideId: slide.id,
        nodeId: nodeIdOfKey(key),
        ...(part ? { part } : {}),
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

/**
 * Delete a slide, whichever kind it is.
 *
 * The deck's first slide is not special-cased away from deletion. What is
 * refused is a deck that would stop opening with a section — so the front page
 * *can* be deleted when the section after it takes over as the front page,
 * which is exactly what an author means by "drop the first part". The rule is
 * stated once, about the result, rather than as a list of positions.
 */
export function deleteSlide(presentation: Presentation, slideId: string): Result<Presentation> {
  const index = slideIndexOf(presentation, slideId)
  if (index < 0) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  if (presentation.slides.length <= 1) {
    return err('CANNOT_DELETE_LAST_SLIDE', 'Presentasjonen må ha minst én slide.')
  }
  return withSlides(
    presentation,
    presentation.slides.filter((slide) => slide.id !== slideId),
  )
}

/**
 * Whether `deleteSlide` would accept this one.
 *
 * The affordance and the rule are the same answer, asked of the same code: a
 * strip that greyed out a button by its own reasoning would be a second, weaker
 * statement of when a slide can go — and the interesting case, "the deck would
 * stop opening with a section", is exactly the one a count of slides cannot see.
 */
export function canDeleteSlide(presentation: Presentation, slideId: string): boolean {
  return deleteSlide(presentation, slideId).ok
}

export function duplicateSlide(presentation: Presentation, slideId: string): Result<Presentation> {
  const index = slideIndexOf(presentation, slideId)
  if (index < 0) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const duplicated = copyOf(presentation.slides[index])
  const slides = [...presentation.slides]
  slides.splice(index + 1, 0, duplicated)
  // A copy always lands after its original, so the first slide is untouched.
  return withSlides(presentation, slides)
}

/**
 * A slide copied, whichever kind it is, with every identity inside it renewed.
 *
 * Every kind is named: a fourth kind of slide would be a compile error here,
 * not a copy that silently came out as some other kind.
 */
function copyOf(source: Slide): Slide {
  switch (source.kind) {
    case 'section':
      return {
        ...createSection({
          accentColor: source.accentColor,
          backgroundColor: source.backgroundColor,
        }),
        title: structuredClone(source.title),
        subtitle: structuredClone(source.subtitle),
      }
    case 'content':
      return {
        ...createSlide({
          hasTitle: source.title !== null,
          root: cloneSubtreeWithNewIds(source.root),
        }),
        title: source.title ? (structuredClone(source.title) as TitleDoc) : null,
      }
    case 'interactive':
      // The source is copied as it stands — it is a file, and a copy of a file
      // is the same bytes. Only the identity is new.
      return createInteractiveSlide(source)
  }
}

/**
 * A new section, inheriting the colours of the one before it.
 *
 * Inheriting rather than starting from the deck's defaults is the whole point:
 * an author who wants to carry the same look across parts gets it by doing
 * nothing, and one who wants a new look changes two swatches. There is always a
 * section before this one — the deck opens with one — except when the new
 * section *is* going first, and then there is nothing to inherit from and the
 * section that used to be first is the nearest thing to it.
 *
 * The heading is what a section is for, so it is measured on the way in: an
 * absolute check, like every other placement, because a section that did not
 * exist a moment ago has no previous state to be no worse than.
 */
export interface AddSectionInput extends StructuralOptions {
  /** Insert position; defaults to the end of the deck. */
  index?: number
  title?: string
  subtitle?: string
  /** Both default to the previous section's — see above. */
  accentColor?: string
  backgroundColor?: string
}

export function addSection(
  presentation: Presentation,
  input: AddSectionInput = {},
): Result<Presentation> {
  const at = insertionIndex(presentation, input.index, 'Ugyldig posisjon for ny inndeling.')
  if (!at.ok) return at
  const index = at.value
  const inherited = index === 0
    ? presentation.slides[0]
    : sectionGoverning(presentation, presentation.slides[index - 1].id)
  const section = createSection({
    title: input.title,
    subtitle: input.subtitle,
    accentColor: input.accentColor ?? inherited.accentColor,
    backgroundColor: input.backgroundColor ?? inherited.backgroundColor,
  })

  const slides = [...presentation.slides]
  slides.splice(index, 0, section)
  const inserted = withSlides(presentation, slides)
  if (!inserted.ok) return inserted
  const next = inserted.value

  for (const [key, overflow] of sectionOverflow(section, fitContextFor(next, input.citationStyle), input)) {
    if (overflow <= FIT_TOLERANCE) continue
    const nodeId = nodeIdOfKey(key)
    return err(
      'CONTENT_DOES_NOT_FIT',
      nodeId === SECTION_SUBTITLE_NODE_ID
        ? 'Underoverskriften får ikke plass på én linje. Velg en kortere.'
        : 'Overskriften får ikke plass på én linje. Velg en kortere.',
      { slideId: section.id, nodeId, overflow },
    )
  }

  // A section inserted before existing citations shifts their numbers up, so
  // `[9]` can become `[10]` on a slide the caller never mentioned.
  return guardFit(
    presentation,
    next,
    input,
    'Den nye inndelingen endrer citation-nummereringen slik at innhold på en annen slide ikke lenger får plass.',
  )
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
  const reordered = withSlides(presentation, slides)
  if (!reordered.ok) return reordered
  return guardFit(
    presentation,
    reordered.value,
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
  const slide = contentSlide(presentation, slideId)
  if (!slide.ok) return slide
  if (slide.value.title === null) return err('TITLE_ABSENT', 'Sliden har ingen overskriftssone.')
  const next = withSlide(presentation, { ...slide.value, title: doc })
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
  const found = contentSlide(presentation, slideId)
  if (!found.ok) return found
  const slide = found.value
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
  const front = presentation.slides[0]
  for (const [key, overflow] of sectionOverflow(front, fitContextFor(presentation, options.citationStyle), options)) {
    if (overflow <= FIT_TOLERANCE) continue
    const nodeId = nodeIdOfKey(key)
    return err(
      'CONTENT_DOES_NOT_FIT',
      nodeId === SECTION_SUBTITLE_NODE_ID
        ? 'Undertittelen får ikke plass på forsiden. Velg en kortere.'
        : 'Tittelen får ikke plass på forsiden på én linje. Velg en kortere.',
      { slideId: front.id, nodeId, overflow },
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
 * Write the deck's image brief, or clear it.
 *
 * Nothing on any slide changes, so no fit gate and no geometry is involved: the
 * brief is editorial metadata about how this deck's pictures should look, read
 * by the author and by an agent writing prompts, and drawn nowhere. See
 * `Presentation.imageContext`.
 *
 * A brief that is blank is *removed* rather than stored as an empty string, so
 * "this deck has no brief" has one representation — which is what keeps a deck
 * that never had one byte-identical after somebody opens the dialog and closes
 * it again.
 *
 * **What is stored is exactly what was given, byte for byte.** The editor's
 * dialog is a controlled field that runs this command on every keystroke and
 * then shows back whatever came out, so anything normalised here is a character
 * the author watches vanish under the caret as they type it. Trimming looked
 * harmless and was not: a trailing space is how every word in a sentence but
 * the last one ends, so `«Dempet »` came back as `«Dempet»` and the next letter
 * landed against the previous word. A trailing newline is the same story for a
 * paragraph break. Emptiness is therefore a question this command *asks* of the
 * value, never an edit it makes to it — see `imageContext.test.ts`, which types a
 * sentence one character at a time the way the component does.
 */
export function setImageContext(
  presentation: Presentation,
  brief: string | null,
): Result<Presentation> {
  if (brief !== null && brief.length > MAX_IMAGE_CONTEXT_CHARS) {
    return err(
      'INVALID_ARGUMENT',
      `Bildebriefen kan ikke være lengre enn ${MAX_IMAGE_CONTEXT_CHARS} tegn.`,
      { maxChars: MAX_IMAGE_CONTEXT_CHARS, received: brief.length },
    )
  }
  const value = brief ?? ''
  const current = presentation.imageContext ?? ''
  if (value === current) return ok(presentation)
  /* Nothing but air is no brief — but that is a reading of the value, and the
     one case where discarding it costs nothing, because there is nothing in it
     to lose. A field the author is still filling in has a character in it. */
  if (value.trim() === '') {
    if (current === '') return ok(presentation)
    const { imageContext: _removed, ...rest } = presentation
    return reconcile(touch(rest))
  }
  return reconcile(touch({ ...presentation, imageContext: value }))
}

/**
 * The deck brought back into line after the shared context moved.
 *
 * The context is part of *every* picture's order — `imagePlanItemId` covers it
 * — so rewriting it re-identifies every planned picture at once: bindings that
 * answered for the old orders stop answering, and the pictures in those zones
 * become pictures made for something the deck no longer asks for.
 *
 * `syncImagePlaceholders` is this codebase's one idempotent reconciliation
 * pass, and it is what reopens the deposit for a deck that needs pictures
 * again. Without this call the shared context could be rewritten on a finished
 * deck, the workflow would ask for replacements, and the deposit would still be
 * closed — the agent told to hand over files nothing could receive.
 */
function reconcile(presentation: Presentation): Result<Presentation> {
  return syncImagePlaceholders(presentation)
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
  if (theme.boxShadows !== undefined) next.boxShadows = theme.boxShadows
  if (theme.titledCardStyle !== undefined) {
    if (!TITLED_CARD_STYLES.includes(theme.titledCardStyle)) {
      return err('INVALID_ARGUMENT', 'Ukjent utseende for kort med tittel.')
    }
    next.titledCardStyle = theme.titledCardStyle
  }

  const updated = touch({ ...presentation, theme: next })
  return guardThemeChange(presentation, updated, theme, options)
}

/**
 * Om et nytt tema kan tas i bruk: det samme spørsmålet for ett valg i
 * temaeditoren og for en hel temamal (`applyThemeTemplate`).
 *
 * `patch` er det som ble endret, og avgjør bare hvilken innstilling avslaget
 * nevner.
 */
export function guardThemeChange(
  presentation: Presentation,
  updated: Presentation,
  patch: Partial<PresentationTheme>,
  options: StructuralOptions = {},
): Result<Presentation> {
  // Two questions, and the fit one cannot answer the first. Luft and
  // skriftstørrelse move the geometry itself — the gap between zones and the
  // height of the title zone — so a change can leave a zone smaller than the
  // minimum without hiding a single character, and an empty zone would sail
  // through a check that measures content. Asked first, because a zone that is
  // too small to exist is not something shorter text would fix.
  const tooSmall = findGeometryRegression(presentation, updated, options)
  if (tooSmall) {
    // The rect is the one the theme *would* have given the zone. The zone as it
    // stands is above the minimum — that is why the change was allowed to be
    // attempted — so answering with today's rect would contradict the error.
    return err('ZONE_TOO_SMALL', minimumRefusalMessage(patch), {
      slideId: tooSmall.slideId,
      nodeId: tooSmall.nodeId,
      ...(tooSmall.rect ? { rect: tooSmall.rect } : {}),
    })
  }

  // Every part of a theme is global: a wider font, more air or larger type can
  // push text out of every zone in the deck at once. The guard measures only
  // the slides the change can affect and only reports zones that got worse, so
  // a change that *reduces* overflow stays available as a repair.
  return guardFit(presentation, updated, options, refusalMessage(patch))
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
  if (patch.titledCardStyle !== undefined && !fonts && !spacing && !size) {
    return 'Dette utseendet på kort med tittel gjør at innhold ikke lenger får plass. Kort ned innholdet først, eller velg et annet utseende.'
  }
  return 'Denne endringen gjør at innhold ikke lenger får plass. Kort ned innholdet først.'
}

export function setFolder(
  presentation: Presentation,
  folderId: string | null,
): Result<Presentation> {
  return ok(touch({ ...presentation, folderId }))
}
