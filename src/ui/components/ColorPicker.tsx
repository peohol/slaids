/**
 * The 12 x 4 palette plus a black/white row.
 *
 * Text colour is never picked here — it is derived from the chosen background
 * by contrast.
 */

import * as Popover from '@radix-ui/react-popover'
import { PALETTE, bestTextColor } from '../../domain/color'
import { Icon } from './Icon'

/**
 * A value that follows something else until somebody picks a colour.
 *
 * The heading pill is the case this exists for: with no colour of its own it
 * takes the deck's, so the grid needs a choice that means *no* choice — and
 * shows which colour that currently resolves to, since it is not a fixed one.
 */
export interface InheritedColor {
  /** What "standard" paints with right now. */
  color: string
  label: string
  /** True when nothing has been picked, so the default is in force. */
  active: boolean
  onSelect: () => void
}

export function ColorSwatchGrid({
  value,
  onSelect,
  inherited,
}: {
  value: string
  onSelect: (color: string) => void
  inherited?: InheritedColor
}) {
  return (
    <div className="palette" data-testid="palette">
      {inherited && (
        <div className="palette__row palette__row--inherited">
          <button
            type="button"
            className={
              inherited.active ? 'palette__inherited palette__inherited--active' : 'palette__inherited'
            }
            onClick={inherited.onSelect}
            data-testid="palette-inherited"
            aria-pressed={inherited.active}
          >
            <span className="palette__swatch" style={{ background: inherited.color }}>
              {inherited.active && (
                <span style={{ color: bestTextColor(inherited.color), display: 'flex' }}>
                  <Icon name="check" size={14} />
                </span>
              )}
            </span>
            <span>{inherited.label}</span>
          </button>
        </div>
      )}
      {PALETTE.map((row, rowIndex) => (
        <div className="palette__row" key={rowIndex}>
          {row.map((color) => (
            <button
              key={color}
              type="button"
              className={
                color === value && !inherited?.active
                  ? 'palette__swatch palette__swatch--active'
                  : 'palette__swatch'
              }
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
  inherited,
}: {
  value: string
  onChange: (color: string) => void
  label: string
  testId?: string
  inherited?: InheritedColor
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
          <ColorSwatchGrid value={value} onSelect={onChange} inherited={inherited} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * The swatch that is both the colour and the way to change it.
 *
 * Where a label would only repeat what the colour already says — a category
 * heading in the ideas window — the chip stands alone and carries the press
 * itself. `className` is the caller's, because the button also has to be
 * nameable by whatever it sits inside: the ideas window excludes it from the
 * drag zone by class, so a press on the colour opens the palette instead of
 * lifting the row it sits in.
 */
export function ColorSwatchButton({
  value,
  onChange,
  label,
  className,
  testId,
}: {
  value: string
  onChange: (color: string) => void
  label: string
  className: string
  testId?: string
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={className}
          style={{ background: value }}
          aria-label={label}
          data-testid={testId}
          data-color={value}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" sideOffset={6}>
          <ColorSwatchGrid value={value} onSelect={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
