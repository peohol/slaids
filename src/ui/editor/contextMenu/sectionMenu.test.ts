import { describe, expect, it, vi } from 'vitest'
import { createPresentation } from '../../../domain/presentation'
import type { SectionSlide } from '../../../domain/types'
import type { MenuEntry } from '../../components/contextMenu'
import { sectionMenu, type SectionMenuInput } from './sectionMenu'

const handlers = { insertReference: vi.fn(), optimizeAsset: vi.fn(), copyText: vi.fn() }

describe('sectionMenu', () => {
  it('offers the page its accent and background, committed to that section', () => {
    const deck = createPresentation({ title: 'Seksjon' })
    const section = deck.slides[0] as SectionSlide
    const commit = vi.fn<SectionMenuInput['commit']>()
    const menu = sectionMenu({ section, isFront: true, commit }, handlers, null)
    expect(menu.title).toBe('Forside')
    expect(menu.entries.map((entry) => (entry.kind === 'separator' ? '|' : entry.id))).toEqual([
      'section-accent',
      'section-background',
    ])

    const background = menu.entries[1] as Extract<MenuEntry, { kind: 'submenu' }>
    // What a section decides is inherited by everything after it, and from nothing.
    expect(background.entries.map((entry) => entry.kind)).toEqual(['swatches'])
    const swatches = background.entries[0] as Extract<MenuEntry, { kind: 'swatches' }>
    expect(swatches.value).toBe(section.backgroundColor)

    swatches.onSelect('#4d4d80')
    const [label, change] = commit.mock.calls[0]
    expect(label).toBe('section-background')
    const result = change(deck)
    expect(result.ok && (result.value.slides[0] as SectionSlide).backgroundColor).toBe('#4d4d80')
  })
})
