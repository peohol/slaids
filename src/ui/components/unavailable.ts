import type { SyntheticEvent } from 'react'

/**
 * The props of a button that cannot be used here and says why in its tooltip.
 *
 * A native `disabled` button takes no focus and no pointer, so a reason in its
 * tooltip could only ever be read by someone with a mouse, and only through a
 * wrapper. Marked `aria-disabled` instead, the button stays in the tab order
 * and under the pointer: the tooltip opens on focus as on hover and becomes
 * the button's accessible description, and a screen reader still announces it
 * as unavailable. The press itself is refused here, in the capture phase,
 * before the button's own handler or anything around it sees it — from the
 * mouse, Enter and Space alike, since each arrives as a click.
 *
 * The look is the disabled one (`global.css` styles both). Spread it after the
 * button's own handlers: `<button onClick={act} {...unavailable(!can)}>`.
 */
export function unavailable(disabled: boolean) {
  return disabled ? { 'aria-disabled': true, onClickCapture: refuse } : {}
}

function refuse(event: SyntheticEvent) {
  event.preventDefault()
  event.stopPropagation()
}
