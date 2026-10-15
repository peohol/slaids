/**
 * The place between two slides in the strip, where a new page can be put.
 *
 * The gap lights up as soon as the pointer is in it, so it reads as somewhere
 * something can happen. A pointer that rests there opens it: the slide below
 * slides down, and a button in the room that makes offers the three kinds of
 * page. A pointer only passing by on its way along the strip does neither.
 *
 * It is a mouse's affordance. A finger has no way to rest between two pages
 * without pressing one, so touch keeps the strip's own buttons — the same three
 * doors, offered in the same words.
 */

import { useEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Icon } from '../components/Icon'
import { NEW_PAGE_OPTIONS, type PageKind } from './pageKinds'

/** How long the pointer has to rest in the gap before it opens. */
const INSERT_OPEN_DELAY_MS = 300

export function FilmstripInsert({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (kind: PageKind) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  // Whether the pointer is in the gap — read when the menu closes, so a gap the
  // pointer is still resting in stays open.
  const hovered = useRef(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const enter = (event: React.PointerEvent): void => {
    if (event.pointerType !== 'mouse') return
    hovered.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onOpenChange(true), INSERT_OPEN_DELAY_MS)
  }

  const leave = (): void => {
    hovered.current = false
    window.clearTimeout(timer.current)
    // The menu is drawn outside the gap, so moving to it leaves the gap; the
    // gap stays open for as long as the menu does.
    if (!menuOpen) onOpenChange(false)
  }

  const changeMenu = (next: boolean): void => {
    setMenuOpen(next)
    if (!next && !hovered.current) onOpenChange(false)
  }

  const choose = (kind: PageKind): void => {
    setMenuOpen(false)
    onOpenChange(false)
    onChoose(kind)
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
        <Popover.Root open={menuOpen} onOpenChange={changeMenu}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="btn btn--icon btn--sm filmstrip-insert__button"
              aria-label="Sett inn her"
              data-testid="filmstrip-insert-button"
            >
              <Icon name="plus" size={16} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="popover zone-action-menu"
              side="right"
              align="center"
              sideOffset={8}
              data-testid="filmstrip-insert-menu"
            >
              {NEW_PAGE_OPTIONS.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  className="btn btn--sm"
                  onClick={() => choose(option.kind)}
                  data-testid={`insert-${option.id}`}
                >
                  <Icon name={option.icon} size={16} /> {option.label}
                </button>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  )
}
