/**
 * What the inspector says about the selection, and in which order.
 *
 * The rules under test: the panel always names what is selected and where it
 * sits; its groups come in one order — content, then the zone, then its size —
 * with what removes something last; an action that cannot be used says why in
 * its own text, not only in a tooltip; and the kind in force is the label of
 * the one control that changes it. The actions themselves are built by the
 * editor from `ZONE_ACTIONS`, and the menus from the builders tested beside them.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setZoneContent, splitLeaf } from '../../domain/commands'
import { CONTENT_KIND_LABELS, createContentOfKind, ZONE_CONTENT_KINDS } from '../../domain/content'
import { estimateFitChecker } from '../../domain/fit'
import { createPresentation } from '../../domain/presentation'
import { contentAt } from '../../domain/testDecks'
import type { ContentSlide, NodeId, Presentation, ZoneContentKind } from '../../domain/types'
import { useEditorStore } from '../../state/store'
import { TooltipProvider } from '../components/Tooltip'
import { contentKindOptions } from './contentKinds'
import { Inspector } from './Inspector'
import type { ZoneAction } from './ZoneOverlay'

const noop = (): void => {}

function deck(): { presentation: Presentation; slide: ContentSlide } {
  const presentation = createPresentation({ title: 'Inspektør' })
  return { presentation, slide: contentAt(presentation, 1) }
}

function split(presentation: Presentation, nodeId: NodeId): Presentation {
  const slide = contentAt(presentation, 1)
  const result = splitLeaf(presentation, {
    slideId: slide.id,
    nodeId,
    axis: 'x',
    weights: [1, 1],
    fits: estimateFitChecker,
  })
  if (!result.ok) throw new Error('kunne ikke splitte')
  return result.value.presentation
}

function fill(presentation: Presentation, nodeId: NodeId, kind: ZoneContentKind): Presentation {
  const slide = contentAt(presentation, 1)
  const result = setZoneContent(presentation, {
    slideId: slide.id,
    nodeId,
    content: createContentOfKind(kind),
    fits: estimateFitChecker,
  })
  if (!result.ok) throw new Error(`kunne ikke fylle sonen med ${kind}`)
  return result.value.presentation
}

// Rendered for real rather than to a string: a server render reads the
// store's initial state, not the selection a test has just made.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let mounted: { root: Root; container: HTMLElement } | null = null

function render(
  presentation: Presentation,
  selected: NodeId | null,
  actions: ZoneAction[] = [],
): HTMLElement {
  useEditorStore.setState({ presentation, selectedNodeId: selected })
  const slide = contentAt(presentation, 1)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  act(() => root.render(
    <TooltipProvider>
      <Inspector
        slide={slide}
        actions={actions}
        contentKinds={contentKindOptions(null)}
        onSetContentKind={noop}
        onOptimizeImage={noop}
      />
    </TooltipProvider>,
  ))
  return container
}

const text = (doc: ParentNode, testId: string): string =>
  doc.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''

const sectionOrder = (doc: ParentNode): string[] =>
  [...doc.querySelectorAll('.inspector__section > .inspector__heading')].map((heading) => heading.textContent ?? '')

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
  useEditorStore.setState({ presentation: null, selectedNodeId: null })
})

describe('Inspector', () => {
  it('says that nothing is selected, and how to select something', () => {
    const { presentation } = deck()
    const doc = render(presentation, null)
    expect(text(doc, 'inspector-selection')).toContain('Ingen sone er valgt')
    expect(sectionOrder(doc)).toEqual([])
  })

  it('names an empty zone and offers every kind to fill it with, as buttons', () => {
    const { presentation, slide } = deck()
    const doc = render(presentation, slide.root.id)
    expect(text(doc, 'inspector-selection')).toContain('Tom sone')
    expect(text(doc, 'inspector-selection')).toContain('Hovedsonen')
    for (const kind of ZONE_CONTENT_KINDS) {
      expect(doc.querySelector(`[data-testid="inspector-add-${kind}"]`)).not.toBeNull()
    }
    expect(doc.querySelector('[data-testid="inspector-content-kind"]')).toBeNull()
  })

  it.each(ZONE_CONTENT_KINDS)('names %s in the heading and on the control that changes it', (kind) => {
    const { presentation, slide } = deck()
    const doc = render(fill(presentation, slide.root.id, kind), slide.root.id)
    expect(doc.querySelector('.inspector-head__name')?.textContent).toBe(CONTENT_KIND_LABELS[kind])
    const control = doc.querySelector('[data-testid="inspector-content-kind"]')
    expect(control?.getAttribute('aria-haspopup')).toBe('menu')
    expect(control?.getAttribute('aria-label')).toBe(`Innholdstype: ${CONTENT_KIND_LABELS[kind]}`)
  })

  it('puts content first, then the zone, then its size — and says where the zone sits', () => {
    const { presentation, slide } = deck()
    const halves = split(presentation, slide.root.id)
    const root = contentAt(halves, 1).root
    if (root.kind !== 'split') throw new Error('roten skulle vært splittet')
    const doc = render(halves, root.children[1].id)
    expect(sectionOrder(doc)).toEqual(['Innhold', 'Sone', 'Størrelse blant søskensonene'])
    expect(text(doc, 'inspector-selection')).toContain('Sone 2 av 2, side ved side')
    expect(text(doc, 'zone-size-scope')).toBe('Denne sonen er sone 2 av 2 i Rot.')
    // The selected zone's row says so in words, not only in weight.
    expect(doc.querySelector('[aria-current="true"]')?.textContent).toBe('Sone 2 (denne)')
    // A single zone is grown or shrunk directly; each ratio is one fold away.
    expect(doc.querySelector('[data-testid="zone-size-grow"]')).not.toBeNull()
    expect(doc.querySelector('[data-testid="zone-weight-0"]')?.closest('details')).not.toBeNull()
  })

  it('gives a split no content section, and its ratios unfolded', () => {
    const { presentation, slide } = deck()
    const doc = render(split(presentation, slide.root.id), slide.root.id)
    expect(sectionOrder(doc)).toEqual(['Sone', 'Fordeling inni denne sonen'])
    expect(text(doc, 'zone-size-scope')).toBe('Forholdet mellom de 2 direkte subsonene i Rot.')
    expect(text(doc, 'inspector-selection')).toContain('Delt sone')
    expect(text(doc, 'inspector-selection')).toContain('2 soner side ved side')
    expect(doc.querySelector('[data-testid="zone-weight-0"]')?.closest('details')).toBeNull()
    expect(text(doc, 'zone-ratios')).toBe('1 : 1')
    // Its zones by name: the way down without aiming at the slide.
    expect(text(doc, 'inspector-child-0')).toBe('Sone 1: Tom sone')
    expect(text(doc, 'inspector-child-1')).toBe('Sone 2: Tom sone')
  })

  /*
   * A split that is itself a child answers two questions with two sets of
   * ratios, and the panel keeps them apart: its own children inside, then
   * itself among its siblings — each under its own name, with its own numbers
   * and the path of the split it acts on.
   */
  it('separates a nested split\'s own distribution from its size among its siblings', () => {
    const { presentation, slide } = deck()
    const halves = split(presentation, slide.root.id)
    const root = contentAt(halves, 1).root
    if (root.kind !== 'split') throw new Error('roten skulle vært splittet')
    const nested = split(halves, root.children[1].id)
    const doc = render(nested, root.children[1].id)
    expect(sectionOrder(doc)).toEqual(['Sone', 'Fordeling inni denne sonen', 'Størrelse blant søskensonene'])

    const inside = doc.querySelector('[data-testid="inspector-distribution"]')
    const siblings = doc.querySelector('[data-testid="inspector-size-section"]')
    expect(inside?.querySelector('[data-testid="zone-size-scope"]')?.textContent).toBe(
      'Forholdet mellom de 2 direkte subsonene i Rot › 2.',
    )
    expect(siblings?.querySelector('[data-testid="zone-size-scope"]')?.textContent).toBe(
      'Denne sonen er sone 2 av 2 i Rot.',
    )
    // Inside: every child's ratio, unfolded. Among siblings: grow or shrink this one.
    expect(inside?.querySelector('[data-testid="zone-weight-0"]')?.closest('details')).toBeNull()
    expect(inside?.querySelector('[data-testid="zone-size-grow"]')).toBeNull()
    expect(siblings?.querySelector('[data-testid="zone-size-grow"]')).not.toBeNull()
    // Each group of fields is named after its question for a screen reader.
    expect(inside?.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Fordeling inni denne sonen')
    expect(siblings?.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Størrelse blant søskensonene')
    // One explanation, under the last of them.
    expect(doc.querySelectorAll('[data-testid="inspector-fold-zone-size-help"]')).toHaveLength(1)
    expect(siblings?.querySelector('[data-testid="inspector-fold-zone-size-help"]')).not.toBeNull()
  })

  it('files actions by what they act on, removals last, with the reason a disabled one gives', () => {
    const { presentation, slide } = deck()
    const action = (id: string, group: ZoneAction['group'], extra: Partial<ZoneAction> = {}): ZoneAction => ({
      id,
      group,
      label: id,
      icon: 'plus',
      onSelect: noop,
      ...extra,
    })
    const doc = render(fill(presentation, slide.root.id, 'titled-card'), slide.root.id, [
      action('delete', 'zone', { danger: true, disabled: true, reason: 'Hovedsonen kan ikke slettes.' }),
      action('move', 'content'),
      action('split', 'zone'),
      action('kind', 'content', { menu: [] }),
    ])
    const content = doc.querySelector('[data-testid="inspector-content"]')
    const zone = doc.querySelector('[data-testid="inspector-zone"]')
    expect(content?.querySelector('[data-testid="inspector-action-move"]')).not.toBeNull()
    // The picker is the panel's own kind control, not a second button.
    expect(doc.querySelector('[data-testid="inspector-action-kind"]')).toBeNull()
    const zoneButtons = [...(zone?.querySelectorAll('button') ?? [])].map((button) => button.dataset.testid)
    expect(zoneButtons).toEqual(['inspector-action-split', 'inspector-action-delete'])
    const remove = doc.querySelector('[data-testid="inspector-action-delete"]')
    expect(remove?.hasAttribute('disabled')).toBe(true)
    expect(remove?.textContent).toContain('Hovedsonen kan ikke slettes.')
  })
})
