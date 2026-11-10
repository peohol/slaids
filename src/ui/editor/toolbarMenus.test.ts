/**
 * The presentation's tools and the helper tools, as both the desktop menus and
 * the compact panel offer them.
 *
 * Each tool kept the test id its button had before it moved into a menu, so
 * whatever found it before finds it still; and a choice that cannot be made
 * says why rather than just going grey.
 */

import { describe, expect, it } from 'vitest'
import { helperToolEntries, presentationToolEntries, type PresentationToolHandlers } from './toolbarMenus'

const noop = (): void => {}

const presentation = (overrides: Partial<PresentationToolHandlers> = {}): PresentationToolHandlers => ({
  canEditZones: true,
  onRename: noop,
  onOpenTheme: noop,
  onOpenTemplates: noop,
  onOpenReferences: noop,
  onOpenImageBrief: noop,
  onOptimizeImages: noop,
  ...overrides,
})

describe('presentationToolEntries', () => {
  it('offers every presentation tool under the id its button had', () => {
    expect(presentationToolEntries(presentation()).map((entry) => entry.testId)).toEqual([
      'menu-rename',
      'open-theme',
      'open-templates',
      'open-references',
      'open-image-brief',
      'optimize-images',
    ])
  })

  it('runs the handler each entry names', () => {
    const ran: string[] = []
    const handlers = presentation({
      onRename: () => ran.push('rename'),
      onOpenTheme: () => ran.push('theme'),
      onOpenTemplates: () => ran.push('templates'),
      onOpenReferences: () => ran.push('references'),
      onOpenImageBrief: () => ran.push('image-brief'),
      onOptimizeImages: () => ran.push('optimize'),
    })
    for (const entry of presentationToolEntries(handlers)) entry.onSelect()
    expect(ran).toEqual(['rename', 'theme', 'templates', 'references', 'image-brief', 'optimize'])
  })

  it('refuses templates on a page with no zones, and says why', () => {
    const entries = presentationToolEntries(presentation({ canEditZones: false }))
    const disabled = entries.filter((entry) => entry.disabled)
    expect(disabled.map((entry) => entry.id)).toEqual(['templates'])
    expect(disabled[0].reason).toBeTruthy()
    expect(presentationToolEntries(presentation()).every((entry) => !entry.disabled && !entry.reason)).toBe(true)
  })
})

describe('helperToolEntries', () => {
  const helpers = { sandboxCount: 0, onIdeas: noop, onSandbox: noop, onShowShortcuts: noop, onEditAutocorrect: noop }

  it('offers ideas, the sandbox, the shortcut list and the autoerstatt rules', () => {
    expect(helperToolEntries(helpers).map((entry) => entry.testId)).toEqual([
      'open-ideas',
      'open-sandbox',
      'menu-shortcuts',
      'menu-autocorrect',
    ])
  })

  it('says how much the sandbox holds', () => {
    const sandbox = (count: number): string | undefined =>
      helperToolEntries({ ...helpers, sandboxCount: count }).find((entry) => entry.id === 'sandbox')?.label
    expect(sandbox(0)).toBe('Sandkassen')
    expect(sandbox(3)).toContain('3')
  })

  it('marks an open window as on where the entry toggles it, and is no choice where it only opens', () => {
    const toggled = helperToolEntries({ ...helpers, ideasOpen: true, sandboxOpen: false })
    expect(toggled.map((entry) => entry.checked)).toEqual([true, false, undefined, undefined])
    expect(helperToolEntries(helpers).map((entry) => entry.checked)).toEqual([undefined, undefined, undefined, undefined])
  })
})
