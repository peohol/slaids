import { describe, expect, it, vi } from 'vitest'
import { createPresentation } from '../../../domain/presentation'
import {
  createContentOfKind,
  createNegativeSpace,
  createTitledCard,
  ZONE_CONTENT_KINDS,
} from '../../../domain/content'
import { estimateFitChecker } from '../../../domain/fit'
import { MAX_SPLIT_CHILDREN } from '../../../domain/constants'
import { makeSandboxItem, setZoneContent, splitLeaf } from '../../../domain/commands'
import { contentAt } from '../../../domain/testDecks'
import type { Presentation, SplitNode, ZoneContent } from '../../../domain/types'
import { tidyMenu, type MenuAction, type MenuEntry } from '../../components/contextMenu'
import {
  canClearZone,
  ratioPresets,
  reorderStepForKey,
  sandboxItemLabel,
  zoneModeMenu,
  type ZoneMenuHandlers,
} from './zoneMenu'
import { SIZE_SCOPE_TITLES } from '../zoneDescription'

const checks = { fits: estimateFitChecker }

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) throw new Error(JSON.stringify(result.error))
  return result.value
}

function handlers(): ZoneMenuHandlers {
  return {
    addContent: vi.fn(),
    setContentKind: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    placeSandboxItem: vi.fn(),
    openSandbox: vi.fn(),
    moveContent: vi.fn(),
    moveToSandbox: vi.fn(),
    split: vi.fn(),
    openSplitDialog: vi.fn(),
    setWeights: vi.fn(),
    duplicate: vi.fn(),
    reorder: vi.fn(),
    clear: vi.fn(),
    remove: vi.fn(),
  }
}

function deckWithSplit(weights: number[], axis: 'x' | 'y' = 'x'): Presentation {
  const deck = createPresentation({ title: 'Meny' })
  const slide = contentAt(deck, 1)
  return unwrap(splitLeaf(deck, { slideId: slide.id, nodeId: slide.root.id, axis, weights }))
    .presentation
}

function rootOf(deck: Presentation): SplitNode {
  const root = contentAt(deck, 1).root
  if (root.kind !== 'split') throw new Error('roten skulle vært delt')
  return root
}

function place(deck: Presentation, nodeId: string, content: ZoneContent): Presentation {
  const slideId = contentAt(deck, 1).id
  return unwrap(setZoneContent(deck, { slideId, nodeId, content, ...checks })).presentation
}

function menuFor(deck: Presentation, nodeId: string, on = handlers()) {
  const menu = zoneModeMenu({ presentation: deck, slide: contentAt(deck, 1), nodeId, checks }, on)
  if (!menu) throw new Error('ingen meny')
  return { ...menu, entries: tidyMenu(menu.entries) }
}

/** Every entry, submenus included, flattened in the order they are drawn. */
function flatten(entries: MenuEntry[]): MenuEntry[] {
  return entries.flatMap((entry) => (entry.kind === 'submenu' ? [entry, ...flatten(entry.entries)] : [entry]))
}

function entry(entries: MenuEntry[], id: string): MenuAction | Extract<MenuEntry, { kind: 'submenu' }> {
  const found = flatten(entries).find((each) => each.kind !== 'separator' && 'id' in each && each.id === id)
  if (!found || (found.kind !== 'action' && found.kind !== 'submenu')) throw new Error(`fant ikke ${id}`)
  return found
}

function topIds(entries: MenuEntry[]): string[] {
  return entries.flatMap((each) => (each.kind === 'separator' ? [] : [each.id]))
}

describe('zoneModeMenu', () => {
  it('offers an empty zone content, paste, the sandbox and a split — and nothing to clear', () => {
    const deck = deckWithSplit([1, 1])
    const ids = topIds(menuFor(deck, rootOf(deck).children[0].id).entries)
    expect(ids).toEqual(expect.arrayContaining(['add-content', 'paste', 'from-sandbox', 'split', 'duplicate', 'delete']))
    expect(ids).not.toContain('clear')
    expect(ids).not.toContain('cut')
  })

  it('offers a zone with content the clipboard, moving, converting and clearing', () => {
    let deck = deckWithSplit([1, 1])
    const nodeId = rootOf(deck).children[0].id
    deck = place(deck, nodeId, createTitledCard('Kort'))
    const menu = menuFor(deck, nodeId)
    expect(topIds(menu.entries)).toEqual(
      expect.arrayContaining(['copy', 'cut', 'move', 'to-sandbox', 'content-kind', 'split', 'clear', 'delete']),
    )
    const kinds = entry(menu.entries, 'content-kind')
    const checked = submenuActions(kinds).filter((each) => each.checked)
    expect(checked.map((each) => each.id)).toEqual(['kind-titled-card'])
  })

  it('treats deliberate air as something to replace or empty, not to cut', () => {
    let deck = deckWithSplit([1, 1])
    const nodeId = rootOf(deck).children[0].id
    deck = place(deck, nodeId, createNegativeSpace())
    const ids = topIds(menuFor(deck, nodeId).entries)
    // Emptying is the way back to the picker for a zone too small to convert.
    expect(ids).toEqual(expect.arrayContaining(['content-kind', 'copy', 'split', 'clear', 'delete']))
    expect(ids).not.toContain('cut')
  })

  it('offers «Tøm sone» exactly where there is something to empty, whatever the content kind', () => {
    const deck = deckWithSplit([1, 1])
    const nodeId = rootOf(deck).children[0].id
    expect(canClearZone(rootOf(deck))).toBe(true)
    expect(canClearZone(rootOf(deck).children[0])).toBe(false)
    expect(topIds(menuFor(deck, nodeId).entries)).not.toContain('clear')
    for (const kind of ZONE_CONTENT_KINDS) {
      const filled = place(deck, nodeId, createContentOfKind(kind))
      expect(canClearZone(rootOf(filled).children[0]), kind).toBe(true)
      expect(topIds(menuFor(filled, nodeId).entries), kind).toContain('clear')
    }
  })

  it('offers a split its ratios, with the one in force checked and «equal» off when it already is', () => {
    const deck = deckWithSplit([1, 1])
    const menu = menuFor(deck, rootOf(deck).id)
    expect(topIds(menu.entries)).toEqual(expect.arrayContaining(['edit-split', 'ratios', 'equalize', 'clear']))
    expect(entry(menu.entries, 'ratio-1-1')).toMatchObject({ checked: true })
    expect(entry(menu.entries, 'ratio-1-2')).toMatchObject({ checked: false, disabled: false })
    expect(entry(menu.entries, 'equalize')).toMatchObject({ disabled: true, reason: expect.any(String) })

    const uneven = deckWithSplit([1, 3])
    expect(entry(menuFor(uneven, rootOf(uneven).id).entries, 'equalize')).toMatchObject({ disabled: false })
  })

  /*
   * The same two questions as the inspector, in the same words: a nested
   * split's own children («inni») and the split it sits in («søskensonene»)
   * are told apart by name, and each entry acts on its own split.
   */
  it('names a nested split\'s own distribution and its siblings apart, as the inspector does', () => {
    const deck = deckWithSplit([1, 3])
    const rootId = rootOf(deck).id
    const nestedId = rootOf(deck).children[1].id
    const nested = unwrap(
      splitLeaf(deck, { slideId: contentAt(deck, 1).id, nodeId: nestedId, axis: 'y', weights: [1, 2] }),
    ).presentation
    const on = handlers()
    const menu = menuFor(nested, nestedId, on)
    expect(entry(menu.entries, 'ratios').label).toBe(SIZE_SCOPE_TITLES.inside)
    expect(entry(menu.entries, 'equalize').label).toBe('Fordel subsonene likt')
    expect(entry(menu.entries, 'equalize-siblings').label).toBe('Fordel søskensonene likt')

    ;(entry(menu.entries, 'equalize') as MenuAction).onSelect()
    expect(on.setWeights).toHaveBeenLastCalledWith(nestedId, [1, 1])
    ;(entry(menu.entries, 'equalize-siblings') as MenuAction).onSelect()
    expect(on.setWeights).toHaveBeenLastCalledWith(rootId, [1, 1])
  })

  it('never offers to copy or delete the root, and says why it cannot be deleted', () => {
    const deck = createPresentation({ title: 'Meny' })
    const menu = menuFor(deck, contentAt(deck, 1).root.id)
    expect(topIds(menu.entries)).not.toContain('duplicate')
    expect(topIds(menu.entries)).not.toContain('reorder')
    expect(entry(menu.entries, 'delete')).toMatchObject({ disabled: true, reason: expect.any(String) })
  })

  it('disables a duplicate the command would refuse, with the command’s own reason', () => {
    const deck = deckWithSplit(Array.from({ length: MAX_SPLIT_CHILDREN }, () => 1))
    const duplicate = entry(menuFor(deck, rootOf(deck).children[0].id).entries, 'duplicate')
    expect(duplicate).toMatchObject({ disabled: true })
    expect(duplicate.reason).toBeTruthy()
  })

  it('keeps destructive entries last, whatever kind of zone the menu is for', () => {
    let deck = deckWithSplit([1, 1, 1])
    const [empty, full, air] = rootOf(deck).children.map((child) => child.id)
    deck = place(deck, full, createTitledCard('Kort'))
    deck = place(deck, air, createNegativeSpace())
    for (const nodeId of [empty, full, air, rootOf(deck).id]) {
      const actions = menuFor(deck, nodeId).entries.filter((each): each is MenuAction => each.kind === 'action')
      const firstDanger = actions.findIndex((each) => each.danger)
      expect(firstDanger).toBeGreaterThan(-1)
      expect(actions.slice(firstDanger).every((each) => each.danger)).toBe(true)
    }
  })

  it('hands every choice to the editor’s handler for the zone it was opened on', () => {
    const deck = deckWithSplit([1, 1])
    const nodeId = rootOf(deck).children[1].id
    const on = handlers()
    const menu = menuFor(deck, nodeId, on)
    ;(entry(menu.entries, 'split-y') as MenuAction).onSelect()
    ;(entry(menu.entries, 'duplicate') as MenuAction).onSelect()
    ;(entry(menu.entries, 'kind-container') as MenuAction).onSelect()
    expect(on.split).toHaveBeenCalledWith(nodeId, 'y')
    expect(on.duplicate).toHaveBeenCalledWith(nodeId)
    expect(on.addContent).toHaveBeenCalledWith(nodeId, 'container')
  })

  it('moves a zone to every other place among its siblings, and not to where it is', () => {
    const deck = deckWithSplit([1, 2, 1, 3])
    const ids = rootOf(deck).children.map((child) => child.id)
    for (const [index, nodeId] of ids.entries()) {
      const on = handlers()
      const places = submenuActions(entry(menuFor(deck, nodeId, on).entries, 'reorder'))
      const expected: Record<string, number> = {
        'reorder-previous': Math.max(0, index - 1),
        'reorder-next': Math.min(ids.length - 1, index + 1),
        'reorder-first': 0,
        'reorder-last': ids.length - 1,
      }
      expect(places.map((each) => each.id)).toEqual(Object.keys(expected))
      for (const place of places) {
        const toIndex = expected[place.id]
        expect(place.disabled).toBe(toIndex === index)
        if (place.disabled) {
          expect(place.reason).toBeTruthy()
          continue
        }
        place.onSelect()
        expect(on.reorder).toHaveBeenLastCalledWith(nodeId, toIndex)
      }
    }
  })

  it('names the places by the way the split runs, and skips the ends when there are only two', () => {
    const across = deckWithSplit([1, 1])
    const row = submenuActions(entry(menuFor(across, rootOf(across).children[0].id).entries, 'reorder'))
    expect(row.map((each) => each.label)).toEqual(['Til venstre', 'Til høyre'])

    const down = deckWithSplit([1, 1, 1], 'y')
    const column = submenuActions(entry(menuFor(down, rootOf(down).children[1].id).entries, 'reorder'))
    expect(column.map((each) => each.label)).toEqual(['Opp', 'Ned', 'Øverst', 'Nederst'])
  })

  it('lists sandbox items by what they say', () => {
    const base = deckWithSplit([1, 1])
    const item = makeSandboxItem(createTitledCard('Idé om salg'))
    const deck: Presentation = { ...base, sandbox: [item] }
    const sandbox = entry(menuFor(deck, rootOf(deck).children[0].id).entries, `sandbox-${item.id}`)
    expect(sandbox.label).toBe(sandboxItemLabel(item))
    expect(sandbox.label).toContain('Idé om salg')
  })
})

describe('reorderStepForKey', () => {
  it('reads left and up as earlier, right and down as later, and nothing else as a move', () => {
    expect(reorderStepForKey('ArrowLeft')).toBe(-1)
    expect(reorderStepForKey('ArrowUp')).toBe(-1)
    expect(reorderStepForKey('ArrowRight')).toBe(1)
    expect(reorderStepForKey('ArrowDown')).toBe(1)
    expect(reorderStepForKey('Enter')).toBeNull()
  })
})

describe('ratioPresets', () => {
  it('starts with equal weights and offers only distinct presets of the right length', () => {
    for (let count = 2; count <= MAX_SPLIT_CHILDREN; count += 1) {
      const presets = ratioPresets(count)
      expect(presets[0]).toEqual(Array.from({ length: count }, () => 1))
      expect(presets.every((weights) => weights.length === count)).toBe(true)
      expect(new Set(presets.map((weights) => weights.join(':'))).size).toBe(presets.length)
    }
  })
})

function submenuActions(submenu: MenuEntry): MenuAction[] {
  if (submenu.kind !== 'submenu') throw new Error('ikke en undermeny')
  return submenu.entries.filter((each): each is MenuAction => each.kind === 'action')
}
