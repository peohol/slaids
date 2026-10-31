import { describe, expect, it, vi } from 'vitest'
import { createPresentation } from '../../../domain/presentation'
import {
  createCaption,
  createContentOfKind,
  createImage,
  createNegativeSpace,
  createTitledCard,
  imagePanelOf,
  MAX_SUBFIELDS,
  withImagePanel,
} from '../../../domain/content'
import { estimateFitChecker } from '../../../domain/fit'
import { setZoneContent } from '../../../domain/commands'
import { contentAt } from '../../../domain/testDecks'
import type { Presentation, ZoneContent } from '../../../domain/types'
import { tidyMenu, type MenuAction, type MenuEntry } from '../../components/contextMenu'
import { contentModeMenu, type ContentMenuHandlers, type ContentMenuInput } from './contentMenu'
import type { ContentTarget } from './contentTarget'

const checks = { fits: estimateFitChecker }

function handlers(): ContentMenuHandlers {
  return {
    addContent: vi.fn(),
    setContentKind: vi.fn(),
    paste: vi.fn(),
    placeSandboxItem: vi.fn(),
    openSandbox: vi.fn(),
    pickImage: vi.fn(),
    optimizePanel: vi.fn(),
    optimizeAsset: vi.fn(),
    insertReference: vi.fn(),
    copyText: vi.fn(),
  }
}

/** A deck whose one content slide holds `content` in its root zone. */
function deckWith(content: ZoneContent | null): { deck: Presentation; nodeId: string } {
  const deck = createPresentation({ title: 'Meny' })
  const slide = contentAt(deck, 1)
  if (!content) return { deck, nodeId: slide.root.id }
  const placed = setZoneContent(deck, { slideId: slide.id, nodeId: slide.root.id, content, ...checks })
  if (!placed.ok) throw new Error(placed.error.message)
  return { deck: placed.value.presentation, nodeId: slide.root.id }
}

function menuFor(content: ZoneContent | null, target: ContentTarget = { kind: 'zone' }) {
  const { deck, nodeId } = deckWith(content)
  const commit = vi.fn<ContentMenuInput['commit']>()
  const input: ContentMenuInput = { presentation: deck, slide: contentAt(deck, 1), nodeId, checks, commit }
  const menu = contentModeMenu(input, handlers(), target)
  if (!menu) throw new Error('ingen meny')
  return { ...menu, entries: tidyMenu(menu.entries), commit, deck }
}

function flatten(entries: MenuEntry[]): MenuEntry[] {
  return entries.flatMap((entry) => (entry.kind === 'submenu' ? [entry, ...flatten(entry.entries)] : [entry]))
}

function find(entries: MenuEntry[], id: string) {
  const found = flatten(entries).find((entry) => entry.kind !== 'separator' && entry.id === id)
  if (!found || found.kind === 'separator') throw new Error(`fant ikke ${id}`)
  return found
}

function has(entries: MenuEntry[], id: string): boolean {
  return flatten(entries).some((entry) => entry.kind !== 'separator' && entry.id === id)
}

describe('contentModeMenu', () => {
  it('offers an empty zone what can fill it', () => {
    const menu = menuFor(null)
    expect(menu.title).toBe('Tom sone')
    for (const id of ['add-content', 'paste', 'from-sandbox']) expect(has(menu.entries, id)).toBe(true)
  })

  it('offers deliberate air nothing but something to replace it with', () => {
    const menu = menuFor(createNegativeSpace())
    expect(menu.entries).toHaveLength(1)
    expect(menu.entries[0]).toMatchObject({ kind: 'submenu', label: 'Erstatt med' })
  })

  it('offers a titled card its colour with «Standard» in force, its fields and its kind', () => {
    const menu = menuFor(createTitledCard('Kort'))
    expect(find(menu.entries, 'card-color-default')).toMatchObject({ checked: true, label: 'Standard (fra gjeldende inndeling)' })
    expect(find(menu.entries, 'subfields-1')).toMatchObject({ checked: true, disabled: true })
    expect(has(menu.entries, `subfields-${MAX_SUBFIELDS}`)).toBe(true)
    expect(has(menu.entries, 'content-kind')).toBe(true)
    // Nothing was picked, so there is nothing to put back.
    expect(find(menu.entries, 'reset-colors')).toMatchObject({ disabled: true })
  })

  it('offers to put back a colour that was picked, and commits the reset', () => {
    const menu = menuFor({ ...createTitledCard('Kort'), headerColor: '#a64d79' })
    const reset = find(menu.entries, 'reset-colors') as MenuAction
    expect(reset.disabled).toBe(false)
    reset.onSelect()
    expect(menu.commit).toHaveBeenCalledTimes(1)
    const [label, change] = menu.commit.mock.calls[0]
    expect(label).toBe('reset-colors')
    expect(change(menu.deck).ok).toBe(true)
  })

  it('asks an empty picture for a file, and a full one only to reset a crop that moved', () => {
    expect(has(menuFor(createImage(), { kind: 'image' }).entries, 'pick-image')).toBe(true)

    const centred = menuFor(createImage('asset-1'), { kind: 'image' })
    expect(has(centred.entries, 'replace-image')).toBe(true)
    expect(find(centred.entries, 'reset-crop')).toMatchObject({ disabled: true })

    const image = createImage('asset-1')
    const moved = withImagePanel(image, { ...image.image, focus: { x: 0.1, y: 0.5 } })
    expect(find(menuFor(moved, { kind: 'image' }).entries, 'reset-crop')).toMatchObject({ disabled: false })
  })

  it('offers a caption its place, its colour and its removal — removal last', () => {
    const image = createImage('asset-1')
    const content = withImagePanel(image, { ...image.image, caption: createCaption('top') })
    const menu = menuFor(content, { kind: 'caption' })
    expect(menu.title).toBe('Bildetekst')
    expect(find(menu.entries, 'caption-top')).toMatchObject({ checked: true })
    expect(find(menu.entries, 'caption-color-default')).toMatchObject({ label: 'Standard (fra gjeldende inndeling)' })
    expect(menu.entries.at(-1)).toMatchObject({ id: 'caption-remove', danger: true })
  })

  it("says a caption in a card with a title follows the card's title, not the section", () => {
    const card = createContentOfKind('titled-image-card')
    const panel = imagePanelOf(card)!
    const content = withImagePanel(card, { ...panel, assetId: 'asset-1', caption: createCaption('bottom') })
    const menu = menuFor(content, { kind: 'caption' })
    expect(find(menu.entries, 'caption-color-default')).toMatchObject({ label: 'Standard (fra korttittelen)' })
  })

  it.each(['container', 'untitled-card', 'titled-card', 'image', 'titled-image-card'] as const)(
    'never offers a %s an entry the command it runs would refuse without saying why',
    (kind) => {
      const content = createContentOfKind(kind)
      const target: ContentTarget = imagePanelOf(content) ? { kind: 'image' } : { kind: 'zone' }
      for (const entry of flatten(menuFor(content, target).entries)) {
        if (entry.kind === 'action' && entry.disabled && !entry.checked) {
          expect(entry.reason, entry.id).toBeTruthy()
        }
      }
    },
  )
})
