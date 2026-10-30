/**
 * The context menu: what it is made of, and the one place it is opened from.
 *
 * Every right-click menu in the app is the same component drawn from the same
 * description — a list of entries — so the keyboard, the focus handling, the
 * placement inside the viewport and the look are decided once. What differs
 * between the menu for a zone, a picture or a section is only *which* entries a
 * builder puts in the list; see `ui/editor/contextMenu/`.
 *
 * There is exactly one menu on screen at a time, so the open request lives in a
 * small store rather than in whichever component happened to be clicked: a
 * press on a zone, Shift+F10 and the «more» button on a touch screen all open
 * the same menu, and opening a new one replaces the old.
 */

import { create } from 'zustand'
import type { IconName, IconTone } from './Icon'

interface EntryBase {
  id: string
  label: string
  icon?: IconName
  /** The function family the icon is inked with, as on every other surface. */
  tone?: IconTone
  disabled?: boolean
  /**
   * Why the entry is disabled, shown under it. Only worth writing when the
   * reason is not obvious from the label — «the zone is too small» is, «the
   * sandbox is empty» is not needed beside an empty submenu.
   */
  reason?: string | null
  testId?: string
}

/** Something that happens when it is chosen. */
export interface MenuAction extends EntryBase {
  kind: 'action'
  onSelect: () => void
  /** The keyboard shortcut that does the same, as the shortcut list writes it. */
  shortcut?: string
  /** Data is lost or structure removed: drawn as a warning, and kept last. */
  danger?: boolean
  /**
   * Whether this is the state in force — the current content kind, the
   * current alignment. `undefined` for an entry that is not a choice at all.
   */
  checked?: boolean
  /**
   * Asked before it runs, for what cannot be had back by looking: what is
   * about to go, and the word on the button that lets it. Undo still works
   * afterwards; the question is for the moment before.
   */
  confirm?: MenuConfirm
}

export interface MenuConfirm {
  title: string
  message: string
  confirmLabel: string
}

/** A named group of entries, opened sideways. */
export interface MenuSubmenu extends EntryBase {
  kind: 'submenu'
  entries: MenuEntry[]
}

/** A colour grid: one entry per swatch, laid out as rows. */
export interface MenuSwatches {
  kind: 'swatches'
  id: string
  label: string
  rows: readonly (readonly string[])[]
  /** The colour in force, or `null` when none of these is. */
  value: string | null
  onSelect: (color: string) => void
}

export interface MenuSeparator {
  kind: 'separator'
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuSwatches | MenuSeparator

export const SEPARATOR: MenuSeparator = { kind: 'separator' }

/**
 * The list as it should be drawn.
 *
 * Builders compose menus from parts that may each be empty — the picture part
 * of a zone that holds none, a layout part for the root — so the separators
 * between them are tidied here rather than reasoned about at every call site:
 * none first, none last, never two in a row, and a submenu with nothing left in
 * it is not offered at all. And whatever removes something comes last, after a
 * separator, in every list — so the entry the hand reaches for first is never
 * the one that deletes.
 */
export function tidyMenu(entries: readonly MenuEntry[]): MenuEntry[] {
  const kept: MenuEntry[] = []
  const destructive: MenuEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'submenu') {
      const nested = tidyMenu(entry.entries)
      if (nested.length > 0) kept.push({ ...entry, entries: nested })
      continue
    }
    if (entry.kind === 'swatches' && entry.rows.every((row) => row.length === 0)) continue
    if (entry.kind === 'action' && entry.danger) destructive.push(entry)
    else kept.push(entry)
  }
  const out: MenuEntry[] = []
  for (const entry of [...kept, SEPARATOR, ...destructive]) {
    const previous = out[out.length - 1]
    if (entry.kind === 'separator' && (!previous || previous.kind === 'separator')) continue
    out.push(entry)
  }
  while (out.length > 0 && out[out.length - 1].kind === 'separator') out.pop()
  return out
}

/** Where a menu opens, in viewport pixels: its top-left corner, if there is room. */
export interface MenuAnchor {
  x: number
  y: number
}

export interface ContextMenuRequest {
  anchor: MenuAnchor
  /** What the menu is about, said at the top of it — «Tom sone», «Bilde». */
  title?: string
  entries: MenuEntry[]
  /**
   * Opened from the keyboard (Shift+F10, the menu key). The first entry then
   * takes the focus, so the arrow keys and Enter work straight away — a menu
   * opened by a pointer waits for the pointer instead, as a native one does.
   */
  keyboard?: boolean
  /**
   * The control that opened it, for a menu that belongs to a button: lets the
   * button say `aria-expanded` while its own menu is the one on screen.
   */
  owner?: string
}

interface OpenMenu extends ContextMenuRequest {
  /** Distinguishes two menus opened in a row, so the second starts afresh. */
  serial: number
  /** Where the focus goes back to when the menu closes without sending it elsewhere. */
  returnFocus: HTMLElement | null
}

interface ContextMenuStore {
  menu: OpenMenu | null
  open: (request: ContextMenuRequest) => void
  close: () => void
}

let serial = 0

export const useContextMenu = create<ContextMenuStore>((set) => ({
  menu: null,
  open: (request) => {
    const entries = tidyMenu(request.entries)
    if (entries.length === 0) return
    serial += 1
    const active = typeof document === 'undefined' ? null : document.activeElement
    set({
      menu: {
        ...request,
        entries,
        serial,
        returnFocus: active instanceof HTMLElement && active !== document.body ? active : null,
      },
    })
  },
  close: () => set({ menu: null }),
}))

/** The anchor just under an element — where a menu opened by a button belongs. */
export function anchorBelow(element: Element): MenuAnchor {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}

/**
 * The anchor for a menu opened from the keyboard on something that has a box:
 * just inside its top-left corner, so the menu visibly belongs to it.
 */
export function anchorInside(element: Element): MenuAnchor {
  const rect = element.getBoundingClientRect()
  const inset = Math.min(16, rect.width / 2, rect.height / 2)
  return { x: rect.left + inset, y: rect.top + inset }
}
