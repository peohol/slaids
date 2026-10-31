import { describe, expect, it, vi } from 'vitest'
import { addSection, addSlide, deleteSlide } from '../../../domain/commands'
import { describeError } from '../../../domain/result'
import { createPresentation } from '../../../domain/presentation'
import type { Presentation } from '../../../domain/types'
import type { MenuAction, MenuEntry, MenuSubmenu } from '../../components/contextMenu'
import { NEW_PAGE_OPTIONS } from '../pageKinds'
import { slideMenu, type SlideMenuHandlers } from './slideMenu'

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) throw new Error(JSON.stringify(result.error))
  return result.value
}

/** Front page, a slide, a section, a slide — every position a menu can be about. */
function deck(): Presentation {
  let presentation = createPresentation({ title: 'Meny' })
  presentation = unwrap(addSection(presentation, { title: 'Del to' }))
  presentation = unwrap(addSlide(presentation, {}))
  return presentation
}

function handlers(): SlideMenuHandlers {
  return { move: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), insertAfter: vi.fn() }
}

function action(entries: MenuEntry[], testId: string): MenuAction {
  const found = entries.find((entry) => entry.kind === 'action' && entry.testId === testId)
  if (!found || found.kind !== 'action') throw new Error(`no ${testId}`)
  return found
}

describe('slideMenu', () => {
  it('names the page as the strip numbers it', () => {
    const presentation = deck()
    expect(presentation.slides.map((_, index) => slideMenu(presentation, index, handlers()).title)).toEqual([
      'Forside',
      'Slide 2',
      'Inndeling 3',
      'Slide 4',
    ])
  })

  it('offers deleting exactly when the delete command would, with its reason', () => {
    const presentation = deck()
    for (const [index, slide] of presentation.slides.entries()) {
      const entry = action(slideMenu(presentation, index, handlers()).entries, 'delete-slide')
      const refusal = deleteSlide(presentation, slide.id)
      expect(entry.disabled).toBe(!refusal.ok)
      expect(entry.reason).toBe(refusal.ok ? null : describeError(refusal.error))
      expect(entry.danger).toBe(true)
    }
  })

  it('cannot move past either end, and moves by one place otherwise', () => {
    const presentation = deck()
    const last = presentation.slides.length - 1
    const first = slideMenu(presentation, 0, handlers()).entries
    const end = slideMenu(presentation, last, handlers()).entries
    expect(action(first, 'move-slide-up').disabled).toBe(true)
    expect(action(end, 'move-slide-down').disabled).toBe(true)

    const calls = handlers()
    const middle = slideMenu(presentation, 2, calls).entries
    action(middle, 'move-slide-up').onSelect()
    action(middle, 'move-slide-down').onSelect()
    action(middle, 'duplicate-slide').onSelect()
    expect(calls.move).toHaveBeenNthCalledWith(1, -1)
    expect(calls.move).toHaveBeenNthCalledWith(2, 1)
    expect(calls.duplicate).toHaveBeenCalledOnce()
  })

  it('puts every kind of new page after this one, under the shared names', () => {
    const calls = handlers()
    const entries = slideMenu(deck(), 1, calls).entries
    const insert = entries.find((entry): entry is MenuSubmenu => entry.kind === 'submenu')
    expect(insert?.label).toBe('Sett inn etter denne')
    const doors = (insert?.entries ?? []) as MenuAction[]
    expect(doors.map((door) => [door.label, door.icon])).toEqual(
      NEW_PAGE_OPTIONS.map((option) => [option.label, option.icon]),
    )
    for (const door of doors) door.onSelect()
    expect(vi.mocked(calls.insertAfter).mock.calls.map(([kind]) => kind)).toEqual(
      NEW_PAGE_OPTIONS.map((option) => option.kind),
    )
  })

  it('keeps the action that removes something last', () => {
    const entries = slideMenu(deck(), 1, handlers()).entries
    const last = entries[entries.length - 1]
    expect(last.kind === 'action' && last.testId).toBe('delete-slide')
  })
})
