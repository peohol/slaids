/**
 * Controls that work on a field being typed in without taking its caret.
 *
 * A formatting button, the colour grid beside it and a menu opened from the
 * text toolbar act on the selection in a text field. The browser moves the
 * focus on `mousedown`, so a press that is allowed to do that has already
 * blurred the field — and a field that loses its focus can lose more than the
 * caret: an empty caption takes itself away on blur. The press keeps the focus
 * where it is instead; a keyboard user, who reached the control with Tab, has
 * moved the focus on purpose and still gets it back on the control.
 */

import { useRef, type MouseEvent } from 'react'

/** `onMouseDown` for a control that must leave the focus where it is. */
export function keepFocus(event: MouseEvent): void {
  event.preventDefault()
}

/**
 * Whether the focus has nowhere to be as a popup closes: on the page itself,
 * on an element that has gone, or inside the popup that is going.
 */
export function focusIsLost(popup: Element | null): boolean {
  const active = document.activeElement
  return !active || active === document.body || !active.isConnected || (popup?.contains(active) ?? false)
}

/**
 * `onCloseAutoFocus` for a popover opened from a field's toolbar. Radix sends
 * the focus back to the trigger as it closes, which is right for a keyboard
 * user who was inside the popover — and wrong for a pointer that never took
 * the focus out of the field, where it would blur the very text the popover
 * was about. The focus goes to the trigger only when it would otherwise be lost.
 */
export function returnFocusOnlyIfLost(event: Event): void {
  if (!focusIsLost(event.currentTarget instanceof Element ? event.currentTarget : null)) event.preventDefault()
}

/**
 * Everything a popover opened from a field's toolbar needs to leave the caret
 * in the field: presses on the trigger and inside the popover keep the focus,
 * and closing does not pull it to the trigger.
 *
 * Opening differs by how it was asked for. Opened by a pointer, the popover
 * takes no focus either — the caret stays in the text and the next press
 * lands in the grid. Opened from the keyboard, the focus moves into it as
 * usual, since a keyboard user has no other way in.
 */
export function useFieldPopoverFocus() {
  const byPointer = useRef(false)
  return {
    trigger: {
      onMouseDown: (event: MouseEvent) => {
        keepFocus(event)
        byPointer.current = true
      },
      onKeyDown: () => {
        byPointer.current = false
      },
    },
    content: {
      onMouseDown: keepFocus,
      onOpenAutoFocus: (event: Event) => {
        if (byPointer.current) event.preventDefault()
      },
      onCloseAutoFocus: returnFocusOnlyIfLost,
    },
  }
}
