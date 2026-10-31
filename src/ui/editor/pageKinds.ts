/**
 * What each kind of page is called, and the ways to ask for a new one.
 *
 * One list, so the strip's badges, the status bar and every door to a new page
 * use the same word and the same icon for the same thing.
 */

import type { Slide } from '../../domain/types'
import type { MenuAction } from '../components/contextMenu'
import type { IconName } from '../components/Icon'

export type PageKind = Slide['kind']

/** What a page of this kind is called. The deck's first page is its front page. */
export function pageKindName(kind: PageKind, index: number): string {
  switch (kind) {
    case 'section':
      return index === 0 ? 'Forside' : 'Inndeling'
    case 'interactive':
      return 'Miniapp'
    case 'content':
      return 'Slide'
  }
}

/**
 * A page named so it can be told from every other in the deck: its kind and
 * its number, as the strip numbers it. The front page is the one page that
 * needs no number.
 */
export function pageName(kind: PageKind, index: number): string {
  const name = pageKindName(kind, index)
  return kind === 'section' && index === 0 ? name : `${name} ${index + 1}`
}

export interface NewPageOption {
  kind: PageKind
  /** A short, stable name for the door — what its test id is built from. */
  id: string
  icon: IconName
  label: string
}

/** The three kinds of page an author can add, in the order they are offered. */
export const NEW_PAGE_OPTIONS: readonly NewPageOption[] = [
  { kind: 'content', id: 'slide', icon: 'slide', label: 'Ny slide' },
  { kind: 'section', id: 'section', icon: 'section', label: 'Ny inndeling' },
  { kind: 'interactive', id: 'interactive', icon: 'interactive', label: 'Ny miniapp' },
]

/**
 * The doors to a new page as menu entries — the same names and icons on every
 * surface that offers them; only where the page goes, and the test id each
 * surface gives its doors, differ.
 */
export function newPageEntries(
  onChoose: (kind: PageKind) => void,
  testIdPrefix: string,
  options: readonly NewPageOption[] = NEW_PAGE_OPTIONS,
): MenuAction[] {
  return options.map((option) => ({
    kind: 'action',
    id: `new-page-${option.id}`,
    label: option.label,
    icon: option.icon,
    testId: `${testIdPrefix}-${option.id}`,
    onSelect: () => onChoose(option.kind),
  }))
}

/**
 * A new page asked for: put in front of the slide `before` — which is how a gap
 * between two slides names its place — or right after the slide `after`, which
 * is how a slide's own menu names it. With neither, after the current slide.
 */
export interface NewPageRequest {
  kind: PageKind
  before?: string
  after?: string
}

/**
 * Where a new page asked for this way goes, as an index into the deck.
 *
 * The place is named by a slide rather than a number, and looked up when it is
 * needed: a dialog can stand between the request and the page, and the deck the
 * page goes into is the one that is there then. A slide that has gone in the
 * meantime falls back to the current slide, and that to the end.
 */
export function insertionIndex(
  slides: readonly Pick<Slide, 'id'>[],
  request: Pick<NewPageRequest, 'before' | 'after'>,
  currentSlideId: string | null,
): number {
  const indexOf = (id: string | null | undefined): number =>
    id ? slides.findIndex((slide) => slide.id === id) : -1
  const before = indexOf(request.before)
  if (before >= 0) return before
  const after = indexOf(request.after)
  if (after >= 0) return after + 1
  const current = indexOf(currentSlideId)
  return current >= 0 ? current + 1 : slides.length
}

/**
 * Where a page put at `index` lands, said the way the strip numbers it: after
 * the page that will be in front of it — «etter slide 3», «etter forsiden».
 */
export function placementText(slides: readonly Pick<Slide, 'kind'>[], index: number): string {
  const previous = index - 1
  if (previous < 0 || previous >= slides.length) return 'først i presentasjonen'
  const name = pageName(slides[previous].kind, previous).toLowerCase()
  return previous === 0 && slides[0].kind === 'section' ? `etter ${name}n` : `etter ${name}`
}

/** A dialog's description, led by where the page it creates will go. */
export function withPlacement(placement: string | undefined, description: string): string {
  return placement ? `Kommer ${placement}. ${description}` : description
}
