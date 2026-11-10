/**
 * The pages of a deck, in the order an audience meets them.
 *
 *   authored slides → derived reference slides → derived QR page
 *
 * The first group is stored; the last two are not. The reference slides are
 * recomputed from the citations on every render, and the QR page exists for
 * exactly as long as sharing is on — neither is ever written into
 * `presentation.slides`, which is what keeps them impossible to delete, move,
 * duplicate or edit.
 *
 * The front page is not a page kind of its own any more. It is the deck's
 * first section slide, and `DeckSlides` makes it impossible for the first slide
 * to be anything else — so "every deck opens with a front page" is still a
 * property of the type, and the front page is now an ordinary authored slide
 * that can be recoloured, retitled and paged to like the sections after it.
 *
 * The QR page is still not a slide and is not forced to be one: it is a
 * separate member of this union, so the authored slide format stays exactly as
 * narrow as it was.
 */

import { buildReferenceSlides } from './referenceSlides'
import type { CitationStyle } from './references'
import type { DeckSource, SectionSlide, Slide } from './types'

/** Deterministic, so React reconciles the same page across renders. */
export const QR_PAGE_ID = '__share_qr__'

export type DeckPage =
  | { kind: 'authored-slide'; id: string; slide: Slide }
  | { kind: 'reference-slide'; id: string; slide: Slide }
  | { kind: 'qr'; id: string; shareUrl: string }

export interface DeckPageOptions {
  citationStyle?: CitationStyle
  /**
   * The share link, when sharing is on. `null` — the ordinary case — means
   * there is no QR page at all.
   */
  shareUrl?: string | null
}

/** One authored slide as the page it is, for a renderer handed a slide alone. */
export function authoredPage(slide: Slide): DeckPage {
  return { kind: 'authored-slide', id: slide.id, slide }
}

/** Everything a viewer pages through, in order. */
export function deckPages(deck: DeckSource, options: DeckPageOptions = {}): DeckPage[] {
  const pages: DeckPage[] = []
  for (const slide of deck.slides) {
    pages.push(authoredPage(slide))
  }
  for (const slide of buildReferenceSlides(deck, options.citationStyle)) {
    pages.push({ kind: 'reference-slide', id: slide.id, slide })
  }
  const shareUrl = options.shareUrl?.trim()
  if (shareUrl) pages.push({ kind: 'qr', id: QR_PAGE_ID, shareUrl })
  return pages
}

/**
 * Fremdrift fra 0 til 1 per side-ID. Forsiden har ingen indikator.
 * Referanseslidene beholder fremdriften fra forrige side med mindre de telles med.
 */
export type DeckProgress = ReadonlyMap<string, number>

export function deckProgress(
  pages: readonly DeckPage[],
  includeReferencesInProgress = false,
): DeckProgress {
  const afterCover = pages.slice(1)
  const counts = (page: DeckPage) => includeReferencesInProgress || page.kind !== 'reference-slide'
  const total = afterCover.filter(counts).length
  const progress = new Map<string, number>()
  let position = 0
  for (const page of afterCover) {
    if (counts(page)) position += 1
    progress.set(page.id, total > 0 ? position / total : 0)
  }
  return progress
}

/**
 * The two colours a page is drawn in.
 *
 * `accent` paints every pill, card header and caption that carries no colour of
 * its own; `background` is the page's ground.
 */
export interface SectionColors {
  accent: string
  background: string
}

export type DeckSectionColors = ReadonlyMap<string, SectionColors>

/**
 * The colours each page inherits, from the section that governs it.
 *
 * A section sets the two colours for itself and for every page after it, up to
 * the next section — so a deck reads as a run of coloured parts rather than one
 * flat theme. Which section governs a given page is something only the deck
 * knows, exactly like a citation's number or how full the progress bar is, so
 * this is derived once from the page order rather than by each renderer
 * counting backwards for itself.
 *
 * The derived pages at the end inherit from the last section, because that is
 * where the reader is when they arrive: the bibliography and the QR code
 * continue the part of the deck they follow rather than starting a new one.
 *
 * Total by construction: the first page is a section, so there is always a
 * current pair before any page is looked at.
 */
export function deckSectionColors(pages: readonly DeckPage[]): DeckSectionColors {
  const colors = new Map<string, SectionColors>()
  let current: SectionColors | null = null
  for (const page of pages) {
    const section = page.kind === 'authored-slide' && page.slide.kind === 'section' ? page.slide : null
    if (section) current = sectionColorsOf(section)
    if (current) colors.set(page.id, current)
  }
  return colors
}

/** The pair a section sets, as the renderer reads it. */
export function sectionColorsOf(section: SectionSlide): SectionColors {
  return { accent: section.accentColor, background: section.backgroundColor }
}

/** The generated pages only: what the filmstrip lists below the authored ones. */
export function derivedPages(deck: DeckSource, options: DeckPageOptions = {}): DeckPage[] {
  return deckPages(deck, options).filter(isDerivedPage)
}

/** Derived pages are read-only by construction: nothing stores them. */
export function isDerivedPage(page: DeckPage): boolean {
  return page.kind === 'reference-slide' || page.kind === 'qr'
}

/** The slide a page draws, or `null` for a page that is not a slide. */
export function pageSlide(page: DeckPage): Slide | null {
  return page.kind === 'authored-slide' || page.kind === 'reference-slide' ? page.slide : null
}

/** What the filmstrip and the read-only stage say about a derived page. */
export function derivedPageNote(page: DeckPage): string {
  return page.kind === 'qr'
    ? 'QR-siden lages automatisk av delingslenken og forsvinner når du slår av Del. Den kan ikke redigeres, flyttes eller slettes.'
    : 'Referanseslides genereres automatisk fra referansene og kan ikke redigeres.'
}
