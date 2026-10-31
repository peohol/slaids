/**
 * The place between two slides in the strip, where a new page can be put.
 *
 * The gap lights up as soon as the pointer is in it, so it reads as somewhere
 * something can happen. A pointer that rests there opens it: the slide below
 * slides down, and a button in the room that makes offers the three kinds of
 * page — the same menu entries, names and icons as everywhere else a page is
 * added. A pointer only passing by on its way along the strip does neither.
 *
 * It is a mouse's quick way. A finger has no way to rest between two pages
 * without pressing one, so touch and the keyboard use the slide's own menu —
 * «Sett inn etter denne» — which puts the page in the same place.
 */

import { useEffect, useRef } from 'react'
import { useContextMenu } from '../components/contextMenu'
import { MenuButton } from '../components/MenuButton'
import { newPageEntries, type PageKind } from './pageKinds'

/** How long the pointer has to rest in the gap before it opens. */
const INSERT_OPEN_DELAY_MS = 300

export function FilmstripInsert({
  id,
  open,
  onOpenChange,
  onChoose,
}: {
  /** The slide below the gap: names the gap, and its menu. */
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (kind: PageKind) => void
}) {
  const owner = `insert-before-${id}`
  const menuOpen = useContextMenu((state) => state.menu?.owner === owner)
  const timer = useRef<number | undefined>(undefined)
  // Whether the pointer is in the gap — read when the menu closes, so a gap the
  // pointer is still resting in stays open.
  const hovered = useRef(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // The menu is drawn outside the gap, so moving to it leaves the gap; the gap
  // stays open for as long as the menu does, and closes with it.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !menuOpen && !hovered.current) onOpenChange(false)
    wasOpen.current = menuOpen
  }, [menuOpen, onOpenChange])

  const enter = (event: React.PointerEvent): void => {
    if (event.pointerType !== 'mouse') return
    hovered.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onOpenChange(true), INSERT_OPEN_DELAY_MS)
  }

  const leave = (): void => {
    hovered.current = false
    window.clearTimeout(timer.current)
    if (!menuOpen) onOpenChange(false)
  }

  return (
    <div
      className="filmstrip-insert"
      data-open={open ? '' : undefined}
      data-testid="filmstrip-insert"
      onPointerEnter={enter}
      onPointerLeave={leave}
    >
      {open && (
        <MenuButton
          id={owner}
          label="Sett inn her"
          title="Sett inn her"
          tooltip="Sett inn en ny side her"
          icon="plus"
          className="btn--icon menu-button--icon filmstrip-insert__button"
          testId="filmstrip-insert-button"
          entries={() =>
            newPageEntries((kind) => {
              hovered.current = false
              onOpenChange(false)
              onChoose(kind)
            }, 'insert')
          }
        />
      )}
    </div>
  )
}
