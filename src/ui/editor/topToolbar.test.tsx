/**
 * The toolbar's selected state.
 *
 * The rule under test is that the choice in force is told, not just shown: the
 * selected zone's content kind and the editing mode are the pressed buttons,
 * exactly one of each, and nothing reads as pressed where it cannot be used.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ZONE_CONTENT_KINDS } from '../../domain/content'
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

function pressedKinds(doc: Document): string[] {
  return [...doc.querySelectorAll('[data-testid^="content-kind-"][aria-pressed="true"]')].map(
    (button) => button.getAttribute('data-testid') ?? '',
  )
}

describe('TopToolbar', () => {
  it.each(ZONE_CONTENT_KINDS)('marks %s, and only it, as the kind in force', (kind: ZoneContentKind) => {
    expect(pressedKinds(render({ selectedKind: kind }))).toEqual([`content-kind-${kind}`])
  })

  it('marks no kind when the zone is empty', () => {
    expect(pressedKinds(render({ selectedKind: null }))).toEqual([])
  })

  it('marks no kind when the kinds cannot be used', () => {
    expect(pressedKinds(render({ selectedKind: 'image', selectionIsLeaf: false }))).toEqual([])
  })

  it('gives every kind its function ink', () => {
    const doc = render({})
    for (const kind of ZONE_CONTENT_KINDS) {
      const icon = doc.querySelector(`[data-testid="content-kind-${kind}"] svg`)
      expect(icon?.getAttribute('data-tone')).toBeTruthy()
    }
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
    const doc = render({})
    const file = doc.querySelector('[data-testid="open-image"] svg')
    const kind = doc.querySelector('[data-testid="content-kind-image"] svg')
    expect(file?.innerHTML).not.toBe(kind?.innerHTML)
  })
})
