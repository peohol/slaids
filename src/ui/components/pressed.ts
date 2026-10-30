/**
 * The props of a button that shows a choice in force.
 *
 * The selected look is drawn from `aria-pressed` (see `global.css`), so what a
 * screen reader is told and what the eye sees come from the same attribute.
 * `.btn--active` is set alongside it because existing selectors address the
 * class; both are derived from one boolean here so they cannot disagree.
 */
export function pressedButton(className: string, pressed: boolean) {
  return {
    className: pressed ? `${className} btn--active` : className,
    'aria-pressed': pressed,
  }
}
