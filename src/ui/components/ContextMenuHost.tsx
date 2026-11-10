/**
 * The context menu on screen.
 *
 * Mounted once, near the root of the editor, and drawn from whatever request
 * `useContextMenu` holds. Built on Radix's dropdown menu rather than by hand,
 * because a menu is mostly the parts nobody notices until they are missing:
 * arrow keys and type-ahead, submenus that open sideways from the keyboard,
 * `role="menu"` and its items, focus that goes in and comes back, and a box
 * that flips and shifts to stay inside the viewport.
 *
 * The one thing a dropdown does not have is a place to open from that is not a
 * button. That is supplied by an invisible trigger at the pointer: a box of no
 * size, fixed where the menu was asked for, which the menu is positioned
 * against like any other anchor — and which also names the menu for a screen
 * reader, since a menu is labelled by its trigger.
 */

import { useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { bestTextColor } from '../../domain/color'
import { ConfirmDialog } from './ConfirmDialog'
import { Icon } from './Icon'
import { useContextMenu, type MenuAction, type MenuEntry } from './contextMenu'
import { focusIsLost } from './focusKeeping'
import {
  CUSTOM_COLOR_LABEL,
  CUSTOM_COLOR_WHEEL,
  CustomColorMark,
  isCustomColor,
  openSystemColorPicker,
} from './customColor'

/** Space kept between a menu and the edge of the window. */
const VIEWPORT_MARGIN = 8

/**
 * Run a chosen entry once the menu has gone.
 *
 * Choosing closes the menu, and closing hands the focus back. An entry that
 * opens a dialog or puts the caret in a field needs the focus *after* that, or
 * the menu's own clean-up would take it straight back — so the work waits one
 * turn of the event loop, by which time the menu is unmounted.
 */
function afterClose(run: () => void): () => void {
  return () => {
    window.setTimeout(run, 0)
  }
}

function Entries({
  entries,
  onConfirm,
}: {
  entries: MenuEntry[]
  /** An entry that asks first hands itself here instead of running. */
  onConfirm: (entry: MenuAction) => void
}) {
  return (
    <>
      {entries.map((entry, index) => {
        switch (entry.kind) {
          case 'separator':
            return <DropdownMenu.Separator key={`separator-${index}`} className="context-menu__separator" />
          case 'swatches':
            return (
              <DropdownMenu.RadioGroup
                key={entry.id}
                className="context-menu__swatches"
                value={entry.value ?? ''}
                aria-label={entry.label}
                onValueChange={(color) => afterClose(() => entry.onSelect(color))()}
              >
                {entry.rows.map((row, rowIndex) => (
                  <div className="context-menu__swatch-row" key={rowIndex}>
                    {row.map((color) => (
                      <DropdownMenu.RadioItem
                        key={color}
                        value={color}
                        className="context-menu__swatch"
                        style={{ background: color }}
                        aria-label={color}
                        textValue={color}
                        data-color={color}
                      >
                        <DropdownMenu.ItemIndicator
                          className="context-menu__swatch-check"
                          style={{ color: bestTextColor(color) }}
                        >
                          <Icon name="check" size={13} />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                    {rowIndex === entry.rows.length - 1 && (
                      <DropdownMenu.Item
                        className="context-menu__swatch"
                        style={{ background: CUSTOM_COLOR_WHEEL }}
                        aria-label={CUSTOM_COLOR_LABEL}
                        title={CUSTOM_COLOR_LABEL}
                        textValue={CUSTOM_COLOR_LABEL}
                        data-testid="menu-custom-color"
                        onSelect={(event) => {
                          // Where the swatch was, measured before the menu goes.
                          const anchor = (event.target as Element).getBoundingClientRect()
                          afterClose(() => openSystemColorPicker(anchor, entry.value, entry.onSelect))()
                        }}
                      >
                        <CustomColorMark color={isCustomColor(entry.value) ? entry.value : null} />
                      </DropdownMenu.Item>
                    )}
                  </div>
                ))}
              </DropdownMenu.RadioGroup>
            )
          case 'submenu':
            return (
              <DropdownMenu.Sub key={entry.id}>
                <DropdownMenu.SubTrigger
                  className="context-menu__item"
                  disabled={entry.disabled}
                  data-testid={entry.testId ?? `menu-${entry.id}`}
                  textValue={entry.label}
                >
                  <ItemBody entry={entry} />
                  <span className="context-menu__chevron" aria-hidden="true">
                    <Icon name="chevron-right" size={14} />
                  </span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    className="context-menu"
                    sideOffset={2}
                    alignOffset={-5}
                    collisionPadding={VIEWPORT_MARGIN}
                    data-testid={`menu-${entry.id}-content`}
                  >
                    <Entries entries={entry.entries} onConfirm={onConfirm} />
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            )
          case 'action': {
            const className = entry.danger
              ? 'context-menu__item context-menu__item--danger'
              : 'context-menu__item'
            const shared = {
              className,
              disabled: entry.disabled,
              textValue: entry.label,
              'data-testid': entry.testId ?? `menu-${entry.id}`,
              onSelect: afterClose(entry.confirm ? () => onConfirm(entry) : entry.onSelect),
            }
            const body = (
              <>
                <ItemBody entry={entry} />
                {entry.shortcut && <kbd className="context-menu__shortcut">{entry.shortcut}</kbd>}
              </>
            )
            // A choice that is in force is announced as one: a checkbox item
            // carries `aria-checked`, which a plain item cannot.
            return entry.checked === undefined ? (
              <DropdownMenu.Item key={entry.id} {...shared}>
                {body}
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.CheckboxItem key={entry.id} {...shared} checked={entry.checked}>
                {body}
              </DropdownMenu.CheckboxItem>
            )
          }
        }
      })}
    </>
  )
}

function ItemBody({ entry }: { entry: Exclude<MenuEntry, { kind: 'separator' | 'swatches' }> }) {
  const checked = entry.kind === 'action' && entry.checked === true
  return (
    <>
      <span className="context-menu__icon" aria-hidden="true">
        {entry.icon ? <Icon name={entry.icon} size={15} tone={entry.tone} /> : null}
      </span>
      <span className="context-menu__text">
        <span className="context-menu__label">{entry.label}</span>
        {entry.disabled && entry.reason && <span className="context-menu__reason">{entry.reason}</span>}
      </span>
      {/* The choice in force is marked the way every surface marks it: the
          entry keeps its own icon, and the check sits at the end. */}
      {checked && (
        <span className="context-menu__check" aria-hidden="true">
          <Icon name="check" size={15} />
        </span>
      )}
    </>
  )
}

export function ContextMenuHost() {
  const menu = useContextMenu((state) => state.menu)
  const close = useContextMenu((state) => state.close)
  const contentRef = useRef<HTMLDivElement>(null)
  /** The entry whose question is on screen, once its menu has gone. */
  const [asking, setAsking] = useState<MenuAction | null>(null)

  /*
   * A menu is about something at a place on screen. When the page moves under
   * it — the wheel turns the deck, the window is resized, the window loses
   * focus — that place is gone, and so is the menu, the way a native one goes.
   * The wheel inside the menu itself is the menu's, for a long list.
   */
  useEffect(() => {
    if (!menu) return
    const onWheel = (event: WheelEvent): void => {
      const target = event.target instanceof Node ? event.target : null
      if (target && target instanceof Element && target.closest('.context-menu')) return
      close()
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [close, menu])

  /*
   * The menu focuses itself as it opens; a keyboard user then wants the first
   * entry rather than the box around it. Done once the menu has done its own
   * focusing, or that would win.
   */
  useEffect(() => {
    if (!menu?.keyboard) return
    const frame = window.requestAnimationFrame(() => {
      const first = contentRef.current?.querySelector<HTMLElement>(
        '[role^="menuitem"]:not([data-disabled])',
      )
      first?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [menu])

  const question = asking?.confirm ? (
    <ConfirmDialog
      open
      title={asking.confirm.title}
      message={asking.confirm.message}
      confirmLabel={asking.confirm.confirmLabel}
      onConfirm={() => {
        setAsking(null)
        asking.onSelect()
      }}
      onCancel={() => setAsking(null)}
    />
  ) : null

  if (!menu) return question

  return (
    <>
      {question}
      <DropdownMenu.Root
        key={menu.serial}
        open
        // Not modal: a right-click elsewhere while one menu is open should open
        // the next one there, not land on a page that ignores the pointer.
        modal={false}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DropdownMenu.Trigger
          className="context-menu__anchor"
          style={{ left: menu.anchor.x, top: menu.anchor.y }}
          tabIndex={-1}
        >
          {menu.title ?? 'Hurtigmeny'}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            ref={contentRef}
            className="context-menu"
            data-testid="context-menu"
            side="bottom"
            align="start"
            sideOffset={2}
            collisionPadding={VIEWPORT_MARGIN}
            loop
            // The browser's own menu has no business on top of this one.
            onContextMenu={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              // Back where it was — unless the chosen entry has sent the focus
              // somewhere on purpose: a dialog, or the caret in a field.
              if (focusIsLost(contentRef.current) && menu.returnFocus?.isConnected) {
                menu.returnFocus.focus({ preventScroll: true })
              }
            }}
          >
            {menu.title && <DropdownMenu.Label className="context-menu__title">{menu.title}</DropdownMenu.Label>}
            <Entries entries={menu.entries} onConfirm={setAsking} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  )
}
