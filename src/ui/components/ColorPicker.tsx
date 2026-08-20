/**
 * The 12 x 4 palette plus a black/white row.
 *
 * Text colour is never picked here — it is derived from the chosen background
 * by contrast.
 */

import * as Popover from '@radix-ui/react-popover'
import { PALETTE, bestTextColor } from '../../domain/color'
import { Icon } from './Icon'

export function ColorSwatchGrid({
  value,
  onSelect,
}: {
  value: string
  onSelect: (color: string) => void
}) {
  return (
    <div className="palette" data-testid="palette">
      {PALETTE.map((row, rowIndex) => (
        <div className="palette__row" key={rowIndex}>
          {row.map((color) => (
            <button
              key={color}
              type="button"
              className={color === value ? 'palette__swatch palette__swatch--active' : 'palette__swatch'}
              style={{ background: color }}
              onClick={() => onSelect(color)}
              aria-label={color}
              data-color={color}
            >
              {color === value && (
                <span style={{ color: bestTextColor(color), display: 'flex' }}>
                  <Icon name="check" size={14} />
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export function ColorPickerButton({
  value,
  onChange,
  label,
  testId,
}: {
  value: string
  onChange: (color: string) => void
  label: string
  testId?: string
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn color-trigger" aria-label={label} data-testid={testId}>
          <span className="color-trigger__chip" style={{ background: value }} />
          <span>{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" sideOffset={6}>
          <ColorSwatchGrid value={value} onSelect={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
