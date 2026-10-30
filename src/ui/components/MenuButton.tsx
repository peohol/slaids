/**
 * A button that opens a menu of entries below itself.
 *
 * The menu is the app's one context menu, opened against the button: the same
 * keyboard handling, focus return, placement and look as every other menu, and
 * a press from the keyboard puts the focus on the first entry. The toolbar and
 * the inspector both use it, so «Innholdstype» opens the same list with the
 * same marks wherever it is pressed.
 */

import { useRef } from 'react'
import { anchorBelow, useContextMenu, type MenuEntry } from './contextMenu'
import { Icon, type IconName, type IconTone } from './Icon'
import { Tooltip } from './Tooltip'

export function MenuButton({
  id,
  label,
  title,
  tooltip,
  icon,
  tone,
  disabled = false,
  className = '',
  testId,
  entries,
  children,
}: {
  /** Which menu this is; a second press on the same button closes it. */
  id: string
  /** The accessible name. */
  label: string
  /** Said at the top of the open menu. */
  title: string
  tooltip: string
  icon: IconName
  tone?: IconTone
  disabled?: boolean
  className?: string
  testId?: string
  entries: () => MenuEntry[]
  /** What the button shows besides its icon; the label by default. */
  children?: React.ReactNode
}) {
  const open = useContextMenu((state) => state.open)
  const expanded = useContextMenu((state) => state.menu?.owner === id)
  /*
   * A second press on the button closes its menu, as it would a native one.
   * The press outside the menu has already closed it by the time the click
   * lands, so whether it was open is noted as the press begins.
   */
  const wasOpen = useRef(false)
  return (
    <Tooltip label={tooltip} wrap={disabled}>
      <button
        type="button"
        className={`btn btn--sm menu-button ${className}`.trim()}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-label={label}
        disabled={disabled}
        data-testid={testId ?? `menu-button-${id}`}
        onPointerDown={() => {
          wasOpen.current = expanded
        }}
        onClick={(event) => {
          if (wasOpen.current) {
            wasOpen.current = false
            return
          }
          open({
            anchor: anchorBelow(event.currentTarget),
            title,
            entries: entries(),
            // A click from Enter or Space has no pointer position.
            keyboard: event.detail === 0,
            owner: id,
          })
        }}
      >
        <Icon name={icon} size={15} tone={tone} />
        {children ?? <span className="menu-button__label">{label}</span>}
        <Icon name="chevron-down" size={13} className="menu-button__chevron" />
      </button>
    </Tooltip>
  )
}
