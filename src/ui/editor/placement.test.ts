import { describe, expect, it } from 'vitest'
import { createPresentation } from '../../domain/presentation'
import { createUntitledCard } from '../../domain/content'
import { setZoneContent, splitLeaf } from '../../domain/commands'
import { estimateFitChecker } from '../../domain/fit'
import { contentAt } from '../../domain/testDecks'
import type { Presentation } from '../../domain/types'
import { placementTargets } from './placement'

const fits = { fits: estimateFitChecker }

/** A slide split in three, with content in the first zone. */
function deckWithThreeZones(): { deck: Presentation; zones: string[] } {
  const base = createPresentation({ title: 'Plassering' })
  const slide = contentAt(base, 1)
  const split = splitLeaf(base, {
    slideId: slide.id,
    nodeId: slide.root.id,
    axis: 'x',
    weights: [1, 1, 1],
    ...fits,
  })
  if (!split.ok) throw new Error('kunne ikke splitte')
  const withSplit = split.value.presentation
  const root = contentAt(withSplit, 1).root
  if (root.kind !== 'split') throw new Error('roten skulle vært splittet')
  const zones = root.children.map((child) => child.id)

  const filled = setZoneContent(withSplit, {
    slideId: slide.id,
    nodeId: zones[0],
    content: createUntitledCard(),
    ...fits,
  })
  if (!filled.ok) throw new Error('kunne ikke fylle sonen')
  return { deck: filled.value.presentation, zones }
}

/**
 * The targets a press may land on are the targets a drop would have been
 * allowed to land on: one question, answered by `canAcceptContent`, so the two
 * roads cannot disagree about where content may go.
 */
describe('placementTargets', () => {
  it('offers the empty zones and never an occupied one', () => {
    const { deck, zones } = deckWithThreeZones()
    const slideId = contentAt(deck, 1).id
    const targets = placementTargets(deck, slideId, {
      kind: 'sandbox',
      itemId: 'x',
      slideId,
      content: createUntitledCard(),
    })
    expect([...targets].sort()).toEqual([zones[1], zones[2]].sort())
  })

  it('never offers the zone the content is already in', () => {
    const { deck, zones } = deckWithThreeZones()
    const slideId = contentAt(deck, 1).id
    const targets = placementTargets(deck, slideId, {
      kind: 'zone',
      nodeId: zones[1],
      slideId,
      content: createUntitledCard(),
    })
    expect(targets.has(zones[1])).toBe(false)
    expect(targets.has(zones[2])).toBe(true)
  })

  it('answers nothing at all for a page that has no zones', () => {
    const deck = createPresentation({ title: 'Forside' })
    const frontId = deck.slides[0].id
    const targets = placementTargets(deck, frontId, {
      kind: 'sandbox',
      itemId: 'x',
      slideId: frontId,
      content: createUntitledCard(),
    })
    expect(targets.size).toBe(0)
  })
})
