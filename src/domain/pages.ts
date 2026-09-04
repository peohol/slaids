/**
 * The pages of a deck, in the order an audience meets them.
 *
 *   cover → authored slides → derived reference slides → derived QR page
 *
 * The first two are stored; the last two are not. The reference slides are
 * recomputed from the citations on every render, and the QR page exists for
 * exactly as long as sharing is on — neither is ever written into
 * `presentation.slides`, which is what keeps them impossible to delete, move,
 * duplicate or edit.
 *
 * The cover is stored and editable, but it is not a slide either. Every deck
 * has exactly one, always first: it is a field on the presentation rather than
 * a member of `slides`, which is what makes "every presentation has a cover" a
 * property of the type instead of a rule some command has to remember to
 * enforce. Nothing can delete it, move it or make a second one.
 *
 * Neither the cover nor the QR page is a slide, and neither is forced to be
 * one. Each is a separate member of this union, so the authored slide format
 * stays exactly as narrow as it was: no zone tree pretending to hold a QR code
 * or a pair of pills, no content kind that only one page can use.
 */

import { buildReferenceSlides } from './referenceSlides'
import type { DeckCover, DeckSource, Slide } from './types'

/** Deterministic, so React reconciles the same page across renders. */
export const QR_PAGE_ID = '__share_qr__'
export const COVER_PAGE_ID = '__cover__'

export type DeckPage =
  | { kind: 'cover'; id: string; cover: DeckCover }
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
  const pages: DeckPage[] = [{ kind: 'cover', id: COVER_PAGE_ID, cover: deck.cover }]
  for (const slide of deck.slides) {
    pages.push({ kind: 'authored-slide', id: slide.id, slide })
  }
  for (const slide of buildReferenceSlides(deck)) {
    pages.push({ kind: 'reference-slide', id: slide.id, slide })
  }
  const shareUrl = options.shareUrl?.trim()
  if (shareUrl) pages.push({ kind: 'qr', id: QR_PAGE_ID, shareUrl })
  return pages
}

/**
 * How far through the deck each page sits, as a fraction in `(0, 1]`.
 *
 * The cover is not in the map: it is the way in to the deck rather than a step
 * through it, and it carries no progress indicator. Everything after it counts,
 * derived pages included — the first authored slide is page one, and whatever
 * happens to be last (an authored slide, a reference slide, the QR page) is the
 * end of the deck and reads as full.
 *
 * Keyed by page id rather than by index so a renderer that was handed one page
 * — a thumbnail, the stage, a rendered preview — can still say where in the
 * deck it belongs, without the caller having to count for it.
 */
export type DeckProgress = ReadonlyMap<string, number>

export function deckProgress(pages: readonly DeckPage[]): DeckProgress {
  const counted = pages.filter((page) => page.kind !== 'cover')
  return new Map(counted.map((page, index) => [page.id, (index + 1) / counted.length]))
}

/** The generated pages only: what the filmstrip lists below the authored ones. */
export function derivedPages(deck: DeckSource, options: DeckPageOptions = {}): DeckPage[] {
  return deckPages(deck, options).filter(isDerivedPage)
}

/**
 * Derived pages are read-only by construction: nothing stores them.
 *
 * The cover is stored and editable, so it is not one of them — being outside
 * `slides` is not the same as being generated.
 */
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
