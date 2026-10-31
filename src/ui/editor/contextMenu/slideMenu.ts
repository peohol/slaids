/**
 * The menu for one page in the slide overview.
 *
 * Everything a page can have done to it as a whole — move it, copy it, put a
 * new page after it, delete it — in one list, opened from the entry's own
 * «Flere handlinger» button, a right-click or Shift+F10. The overview's entries
 * show nothing else permanently, so this list is the one place those actions
 * live, on every surface and for every kind of pointer.
 *
 * Whether a page can go is asked of the command that deletes it, so the menu
 * can never offer what the deck would refuse, and says why when it does not.
 */

import { deleteSlide } from '../../../domain/commands'
import { describeError } from '../../../domain/result'
import type { Presentation } from '../../../domain/types'
import type { MenuEntry } from '../../components/contextMenu'
import { SEPARATOR } from '../../components/contextMenu'
import { newPageEntries, pageName, type PageKind } from '../pageKinds'
import type { ZoneMenu } from './zoneMenu'

export interface SlideMenuHandlers {
  /** Move the page by whole positions: -1 is up, 1 is down. */
  move: (delta: number) => void
  duplicate: () => void
  /** Ask to delete the page; the question itself is the caller's. */
  remove: () => void
  /** Ask for a new page of this kind, right after this one. */
  insertAfter: (kind: PageKind) => void
}

/** The actions and their names, shared with anything that tests or documents them. */
export const SLIDE_ACTIONS = {
  moveUp: { label: 'Flytt opp', icon: 'arrow-up' },
  moveDown: { label: 'Flytt ned', icon: 'arrow-down' },
  duplicate: { label: 'Dupliser', icon: 'duplicate' },
  insertAfter: { label: 'Sett inn etter denne', icon: 'plus' },
  remove: { label: 'Slett …', icon: 'trash' },
} as const

export function slideMenu(presentation: Presentation, index: number, handlers: SlideMenuHandlers): ZoneMenu {
  const slide = presentation.slides[index]
  const removal = deleteSlide(presentation, slide.id)
  const entries: MenuEntry[] = [
    {
      kind: 'action',
      id: 'slide-move-up',
      ...SLIDE_ACTIONS.moveUp,
      disabled: index === 0,
      testId: 'move-slide-up',
      onSelect: () => handlers.move(-1),
    },
    {
      kind: 'action',
      id: 'slide-move-down',
      ...SLIDE_ACTIONS.moveDown,
      disabled: index === presentation.slides.length - 1,
      testId: 'move-slide-down',
      onSelect: () => handlers.move(1),
    },
    {
      kind: 'action',
      id: 'slide-duplicate',
      ...SLIDE_ACTIONS.duplicate,
      testId: 'duplicate-slide',
      onSelect: handlers.duplicate,
    },
    SEPARATOR,
    {
      kind: 'submenu',
      id: 'slide-insert-after',
      ...SLIDE_ACTIONS.insertAfter,
      entries: newPageEntries(handlers.insertAfter, 'insert-after'),
    },
    {
      kind: 'action',
      id: 'slide-delete',
      ...SLIDE_ACTIONS.remove,
      danger: true,
      disabled: !removal.ok,
      reason: removal.ok ? null : describeError(removal.error),
      testId: 'delete-slide',
      onSelect: handlers.remove,
    },
  ]
  return { title: pageName(slide.kind, index), entries }
}
