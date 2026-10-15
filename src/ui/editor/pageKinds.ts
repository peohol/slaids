/**
 * What each kind of page is called, and the ways to ask for a new one.
 *
 * One list, so the strip's badges, the status bar and every door to a new page
 * use the same word and the same icon for the same thing.
 */

import type { Slide } from '../../domain/types'
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
 * A new page asked for: put in front of the slide `before` — which is how a gap
 * between two slides names its place — or, left out, after the current slide.
 */
export interface NewPageRequest {
  kind: PageKind
  before?: string
}
