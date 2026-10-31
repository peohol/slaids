/**
 * The toolbar's state and its controls.
 *
 * The rule under test is that the choice in force is told, not just shown: the
 * selected zone's content kind is named on the one control that changes it,
 * the editing mode is exactly one pressed button, and nothing offers itself
 * where it cannot be used. What the menus hold is checked where they are built
 * (`toolbarMenus.test.ts`, `contentKinds.test.ts`).
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CONTENT_KIND_LABELS, ZONE_CONTENT_KINDS } from '../../domain/content'
import type { ZoneContentKind } from '../../domain/types'
import { TooltipProvider } from '../components/Tooltip'
import { contentKindOptions } from './contentKinds'
import { TopToolbar, type TopToolbarProps } from './TopToolbar'

const noop = (): void => {}

function render(props: Partial<TopToolbarProps>): Document {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <TopToolbar
        title="Dekk"
        hasTitleZone
        canToggleTitle
        canEditZones
        selectionIsLeaf
        selectionHasContent
        selectedKind={null}
        contentKinds={contentKindOptions(null)}
        sandboxCount={0}
        ideasOpen={false}
        sandboxOpen={false}
        onShowShortcuts={noop}
        onBack={noop}
        onRename={noop}
        onToggleTitle={noop}
        onSetContentKind={noop}
        onOpenReferences={noop}
        onOpenTemplates={noop}
        onOpenImage={noop}
        onToggleIdeas={noop}
        onToggleSandbox={noop}
        onPresent={noop}
        onOpenTheme={noop}
        onOpenImageBrief={noop}
        onOptimizeImages={noop}
        onToggleShare={noop}
        {...props}
      />
    </TooltipProvider>,
  )
  return new DOMParser().parseFromString(markup, 'text/html')
}

const kindButton = (doc: Document): Element | null => doc.querySelector('[data-testid="toolbar-menu-content-kind"]')

describe('TopToolbar', () => {
  it.each(ZONE_CONTENT_KINDS)('names %s, inked with its family, as the kind in force', (kind: ZoneContentKind) => {
    const button = kindButton(render({ selectedKind: kind }))
    expect(button?.querySelector('[data-kind]')?.getAttribute('data-kind')).toBe(kind)
    expect(button?.textContent).toContain(CONTENT_KIND_LABELS[kind])
    expect(button?.getAttribute('aria-label')).toContain(CONTENT_KIND_LABELS[kind])
    expect(button?.querySelector('svg')?.getAttribute('data-tone')).toBeTruthy()
  })

  it('asks for a kind when the selected zone is empty', () => {
    const button = kindButton(render({ selectedKind: null }))
    expect(button?.querySelector('[data-kind]')?.getAttribute('data-kind')).toBe('')
    expect(button?.textContent).toContain('Velg innholdstype')
    expect(button?.hasAttribute('aria-disabled')).toBe(false)
  })

  it('names no kind, and offers none, when the selection is not one zone', () => {
    const button = kindButton(render({ selectedKind: 'image', selectionIsLeaf: false }))
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    expect(button?.querySelector('[data-kind]')?.getAttribute('data-kind')).toBe('')
  })

  it('opens every menu from a button that says it has one', () => {
    const doc = render({})
    const menus = [...doc.querySelectorAll('[aria-haspopup="menu"]')].map((button) =>
      button.getAttribute('data-testid'),
    )
    expect(menus).toEqual(['toolbar-menu-content-kind', 'toolbar-menu-presentation', 'toolbar-menu-tools'])
    for (const button of doc.querySelectorAll('[aria-haspopup="menu"]')) {
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(button.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('counts the sandbox on the menu that holds it', () => {
    expect(render({ sandboxCount: 0 }).querySelector('[data-testid="sandbox-count"]')).toBeNull()
    const doc = render({ sandboxCount: 4 })
    expect(doc.querySelector('[data-testid="sandbox-count"]')?.textContent).toBe('4')
    expect(doc.querySelector('[data-testid="toolbar-menu-tools"]')?.getAttribute('aria-label')).toContain('4')
  })

  it('presses exactly the mode in force, inked with its family', () => {
    const doc = render({})
    const content = doc.querySelector('[data-testid="mode-content"]')
    const zone = doc.querySelector('[data-testid="mode-zone"]')
    expect(content?.getAttribute('aria-pressed')).toBe('true')
    expect(zone?.getAttribute('aria-pressed')).toBe('false')
    expect(content?.getAttribute('data-tone')).toBe('content')
    expect(zone?.getAttribute('data-tone')).toBe('zone')
  })

  it('tells the image file apart from the image content kind', () => {
    const doc = render({ selectedKind: 'image' })
    const file = doc.querySelector('[data-testid="open-image"]')
    const kind = kindButton(doc)
    expect(file?.getAttribute('aria-label')).not.toBe(kind?.getAttribute('aria-label'))
    expect(file?.querySelector('svg')?.innerHTML).not.toBe(kind?.querySelector('svg')?.innerHTML)
    expect(file?.hasAttribute('aria-haspopup')).toBe(false)
  })

  it('keeps sharing, presenting and the save state on the bar itself', () => {
    const doc = render({})
    for (const id of ['toggle-share', 'present', 'save-status', 'presentation-title', 'back-to-library']) {
      expect(doc.querySelectorAll(`[data-testid="${id}"]`).length, id).toBe(1)
      expect(doc.querySelector(`[data-testid="${id}"]`)?.closest('.context-menu'), id).toBeNull()
    }
  })
})
