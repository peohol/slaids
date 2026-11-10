/**
 * The menu for one page in the slide overview.
 *
 * Everything a page can have done to it as a whole — move it, copy it, put a
 * new page after it, delete it — in one list, opened from the entry's own
 * «Flere handlinger» button, a right-click or Shift+F10. The overview's entries
 * show nothing else permanently, so this list is the one place those actions
 * live, on every surface and for every kind of pointer.
 *
 * Whether a page can go or move is asked of the command that would do it, so
 * the menu never offers what the deck would refuse, and says why when it does
 * not — moving a plain slide into the front page's place, for one.
 */

import { deleteSlide, moveSlide } from '../../../domain/commands'
import { describeError } from '../../../domain/result'
import type { Presentation } from '../../../domain/types'
import type { MenuAction, MenuEntry } from '../../components/contextMenu'
import { SEPARATOR } from '../../components/contextMenu'
import { newPageEntries, pageName, type PageKind } from '../pageKinds'
import type { ZoneMenu } from './zoneMenu'

export interface SlideMenuHandlers {
  /** Move the page by whole positions: -1 is up, 1 is down. */
  move: (delta: number) => void
  duplicate: () => void
  /** Ask to delete the page; the question itself is the caller's. */
  remove: () => void
  toSandbox: () => void
  /** Ask for a new page of this kind, right after this one. */
  insertAfter: (kind: PageKind) => void
}

/** The actions and their names, shared with anything that tests or documents them. */
export const SLIDE_ACTIONS = {
  moveUp: { label: 'Flytt opp', icon: 'arrow-up' },
  moveDown: { label: 'Flytt ned', icon: 'arrow-down' },
  duplicate: { label: 'Dupliser', icon: 'duplicate' },
  insertAfter: { label: 'Sett inn etter denne', icon: 'plus' },
  toSandbox: { label: 'Flytt sliden til sandkassen', icon: 'sandbox' },
  remove: { label: 'Slett …', icon: 'trash' },
} as const

/**
 * Whether the page at `index` can move one place, and why not.
 *
 * The answer is `moveSlide` itself, run without measuring: the deck's own rules
 * about order — it opens with a section — decide, exactly as they will when
 * the move is committed. Whether every label still fits after the citations
 * are renumbered is a measurement, and stays with the commit, which rolls back
 * with its own message if not. Past either end there is nowhere to go, which
 * needs no explaining.
 */
function moveAvailability(
  presentation: Presentation,
  index: number,
  delta: number,
): Pick<MenuAction, 'disabled' | 'reason'> {
  const target = index + delta
  if (target < 0 || target >= presentation.slides.length) return { disabled: true, reason: null }
  const moved = moveSlide(presentation, presentation.slides[index].id, target)
  return moved.ok ? { disabled: false, reason: null } : { disabled: true, reason: describeError(moved.error) }
}

export function slideMenu(presentation: Presentation, index: number, handlers: SlideMenuHandlers): ZoneMenu {
  const slide = presentation.slides[index]
  const removal = deleteSlide(presentation, slide.id)
  const entries: MenuEntry[] = [
    {
      kind: 'action',
      id: 'slide-move-up',
      ...SLIDE_ACTIONS.moveUp,
      ...moveAvailability(presentation, index, -1),
      testId: 'move-slide-up',
      onSelect: () => handlers.move(-1),
    },
    {
      kind: 'action',
      id: 'slide-move-down',
      ...SLIDE_ACTIONS.moveDown,
      ...moveAvailability(presentation, index, 1),
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
  ]
  if (slide.kind === 'content') {
    entries.push({
      kind: 'action',
      id: 'slide-to-sandbox',
      ...SLIDE_ACTIONS.toSandbox,
      testId: 'move-slide-to-sandbox',
      onSelect: handlers.toSandbox,
    })
  }
  entries.push({
    kind: 'action',
    id: 'slide-delete',
    ...SLIDE_ACTIONS.remove,
    danger: true,
    disabled: !removal.ok,
    reason: removal.ok ? null : describeError(removal.error),
    testId: 'delete-slide',
    onSelect: handlers.remove,
  })
  return { title: pageName(slide.kind, index), entries }
}
