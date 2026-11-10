/**
 * Any colour at all: the system's own colour picker, beside the palette.
 *
 * The palette is a way to click a colour, not a limit the domain has, so every
 * palette ends with a swatch that opens the browser's native picker. One
 * hidden `<input type="color">` serves every palette on the page: it is moved
 * over the swatch that was pressed, so the picker opens where the press was,
 * and it outlives the menu or popover it was opened from — a native picker
 * often stays open after the menu that asked for it has closed.
 */

import { BLACK, PALETTE_HUES, bestTextColor, isPaletteColor, normalizeHex } from '../../domain/color'
import { Icon } from './Icon'

export const CUSTOM_COLOR_LABEL = 'Annen farge …'

/** A colour wheel drawn from the palette's own hues, so it says «every colour». */
export const CUSTOM_COLOR_WHEEL = `conic-gradient(${[...PALETTE_HUES, 360]
  .map((hue) => `hsl(${hue} 70% 55%)`)
  .join(', ')})`

/** Whether `value` is a colour the palette does not hold, so the custom swatch is the one in force. */
export function isCustomColor(value: string | null): value is string {
  return value !== null && normalizeHex(value) !== null && !isPaletteColor(value)
}

let field: HTMLInputElement | null = null
let pick: ((color: string) => void) | null = null

function systemColorField(): HTMLInputElement {
  if (field?.isConnected) return field
  const input = document.createElement('input')
  input.type = 'color'
  input.className = 'system-color-field'
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  // `change`, not `input`: one choice is one edit, not one per step of a drag
  // through the picker.
  input.addEventListener('change', () => {
    const color = normalizeHex(input.value)
    if (color) pick?.(color)
  })
  document.body.append(input)
  field = input
  return input
}

/**
 * Open the system colour picker over `anchor`, starting at `initial`, and
 * hand the colour chosen to `onPick`. Must run within a user's press.
 */
export function openSystemColorPicker(
  anchor: DOMRect,
  initial: string | null,
  onPick: (color: string) => void,
): void {
  const input = systemColorField()
  Object.assign(input.style, {
    left: `${anchor.left}px`,
    top: `${anchor.top}px`,
    width: `${anchor.width}px`,
    height: `${anchor.height}px`,
  })
  input.value = normalizeHex(initial ?? '') ?? BLACK
  pick = onPick
  try {
    input.showPicker()
  } catch {
    // Older browsers have no `showPicker`; a click opens the picker there.
    input.click()
  }
}

/**
 * The face of the custom swatch: a colour wheel round a plus, or — once a
 * colour outside the palette is in force — round that colour, checked.
 */
export function CustomColorMark({ color }: { color: string | null }) {
  return (
    <span
      className="custom-color-mark"
      style={color ? { background: color, color: bestTextColor(color) } : undefined}
      aria-hidden="true"
    >
      <Icon name={color ? 'check' : 'plus'} size={11} />
    </span>
  )
}
