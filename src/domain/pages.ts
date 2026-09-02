/**
 * The pages of a deck, in the order an audience meets them.
 *
 *   authored slides → derived reference slides → derived QR page
 *
 * Only the first of those three is stored. The reference slides are recomputed
 * from the citations on every render, and the QR page exists for exactly as
 * long as sharing is on — neither is ever written into `presentation.slides`,
 * which is what keeps them impossible to delete, move, duplicate or edit.
 *
 * A QR page is not a slide and is not forced to be one. It is a separate member
 * of this union, so the authored slide format stays exactly as narrow as it
 * was: no zone tree pretending to hold a QR code, no content kind that only one
 * page can use.
 */

import { buildReferenceSlides } from './referenceSlides'
import type { DeckSource, Slide } from './types'

/** Deterministic, so React reconciles the same page across renders. */
export const QR_PAGE_ID = '__share_qr__'

export type DeckPage =
  | { kind: 'authored-slide'; id: string; slide: Slide }
  | { kind: 'reference-slide'; id: string; slide: Slide }
  | { kind: 'qr'; id: string; shareUrl: string }

export interface DeckPageOptions {
  /**
   * The share link, when sharing is on. `null` — the ordinary case — means
   * there is no QR page at all.
   */
  shareUrl?: string | null
}

/** Everything a viewer pages through, in order. */
export function deckPages(deck: DeckSource, options: DeckPageOptions = {}): DeckPage[] {
  const pages: DeckPage[] = deck.slides.map((slide) => ({
    kind: 'authored-slide',
    id: slide.id,
    slide,
  }))
  for (const slide of buildReferenceSlides(deck)) {
    pages.push({ kind: 'reference-slide', id: slide.id, slide })
  }
  const shareUrl = options.shareUrl?.trim()
  if (shareUrl) pages.push({ kind: 'qr', id: QR_PAGE_ID, shareUrl })
  return pages
}

/** The generated pages only: what the filmstrip lists below the authored ones. */
export function derivedPages(deck: DeckSource, options: DeckPageOptions = {}): DeckPage[] {
  return deckPages(deck, options).filter(isDerivedPage)
}

/** Derived pages are read-only by construction: nothing stores them. */
export function isDerivedPage(page: DeckPage): boolean {
  return page.kind !== 'authored-slide'
}

/** The slide a page draws, or `null` for a page that is not a slide. */
export function pageSlide(page: DeckPage): Slide | null {
  return page.kind === 'qr' ? null : page.slide
}

/** What the filmstrip and the read-only stage say about a derived page. */
export function derivedPageNote(page: DeckPage): string {
  return page.kind === 'qr'
    ? 'QR-siden lages automatisk av delingslenken og forsvinner når du slår av Del. Den kan ikke redigeres, flyttes eller slettes.'
    : 'Referanseslides genereres automatisk fra referansene og kan ikke redigeres.'
}
