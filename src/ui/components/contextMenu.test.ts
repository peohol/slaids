import { afterEach, describe, expect, it } from 'vitest'
import { SEPARATOR, tidyMenu, useContextMenu, type MenuAction, type MenuEntry } from './contextMenu'

function action(id: string): MenuAction {
  return { kind: 'action', id, label: id, onSelect: () => undefined }
}

function ids(entries: MenuEntry[]): string[] {
  return entries.map((entry) => (entry.kind === 'separator' ? '|' : entry.id))
}

describe('tidyMenu', () => {
  it('drops separators at the ends and never draws two in a row', () => {
    const entries = [SEPARATOR, action('a'), SEPARATOR, SEPARATOR, action('b'), SEPARATOR]
    expect(ids(tidyMenu(entries))).toEqual(['a', '|', 'b'])
  })

  it('leaves out a submenu with nothing in it, and tidies the ones it keeps', () => {
    const entries: MenuEntry[] = [
      action('a'),
      { kind: 'submenu', id: 'empty', label: 'Tom', entries: [SEPARATOR] },
      SEPARATOR,
      { kind: 'submenu', id: 'full', label: 'Full', entries: [SEPARATOR, action('c'), SEPARATOR] },
    ]
    const tidy = tidyMenu(entries)
    expect(ids(tidy)).toEqual(['a', '|', 'full'])
    const full = tidy[2]
    expect(full.kind === 'submenu' && ids(full.entries)).toEqual(['c'])
  })

  it('moves whatever removes something to the end, behind a separator', () => {
    const remove: MenuAction = { ...action('remove'), danger: true }
    const entries: MenuEntry[] = [
      action('a'),
      remove,
      SEPARATOR,
      action('b'),
      { kind: 'submenu', id: 'sub', label: 'Sub', entries: [{ ...remove, id: 'inner' }, action('c')] },
    ]
    const tidy = tidyMenu(entries)
    expect(ids(tidy)).toEqual(['a', '|', 'b', 'sub', '|', 'remove'])
    const sub = tidy[3]
    expect(sub.kind === 'submenu' && ids(sub.entries)).toEqual(['c', '|', 'inner'])
  })

  it('leaves out a colour grid without colours', () => {
    const entries: MenuEntry[] = [
      { kind: 'swatches', id: 'colors', label: 'Farger', rows: [[]], value: null, onSelect: () => undefined },
      action('a'),
    ]
    expect(ids(tidyMenu(entries))).toEqual(['a'])
  })
})

describe('useContextMenu', () => {
  afterEach(() => useContextMenu.getState().close())

  it('opens nothing when the menu tidies down to nothing', () => {
    useContextMenu.getState().open({ anchor: { x: 0, y: 0 }, entries: [SEPARATOR] })
    expect(useContextMenu.getState().menu).toBeNull()
  })

  it('replaces one open menu with the next, which starts afresh', () => {
    const { open } = useContextMenu.getState()
    open({ anchor: { x: 1, y: 1 }, entries: [action('a')] })
    const first = useContextMenu.getState().menu
    open({ anchor: { x: 2, y: 2 }, entries: [action('b')] })
    const second = useContextMenu.getState().menu
    expect(second?.anchor).toEqual({ x: 2, y: 2 })
    expect(second?.serial).not.toBe(first?.serial)
  })
})
