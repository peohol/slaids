// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createPresentation } from '../../domain/presentation'
import { createUntitledCard } from '../../domain/content'
import { moveZoneContent, placeSandboxItem, setZoneContent, splitLeaf } from '../../domain/commands'
import { estimateFitChecker } from '../../domain/fit'
import { appendToSandbox } from '../../domain/commands/sandbox'
import { contentAt } from '../../domain/testDecks'
import { domFitCheckers } from '../../state/measure'
import type { Presentation } from '../../domain/types'
import { placementTargets } from './placement'

const fits = { fits: estimateFitChecker }

/** A slide split in three, with content in the first zone and one parked item. */
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
  const parked = appendToSandbox(filled.value.presentation, [createUntitledCard()], '')
  return { deck: parked, zones }
}

/**
 * Which zones may receive content is one question, and it is asked of the
 * command that would do the placing — never of a look-alike.
 *
 * A move and a copy are different transitions: a check that adds a second copy
 * of the content while leaving the original in place is measuring a document
 * the move never produces, and content carrying a citation is exactly where
 * the two come apart. So the property that matters is not any particular
 * verdict but that the offer and the commit can never disagree.
 */
describe('placementTargets', () => {
  it('offers the empty zones and never an occupied one', () => {
    const { deck, zones } = deckWithThreeZones()
    const slideId = contentAt(deck, 1).id
    const targets = placementTargets(deck, slideId, {
      kind: 'sandbox',
      itemId: deck.sandbox[0].id,
    })
    expect([...targets].sort()).toEqual([zones[1], zones[2]].sort())
  })

  /*
   * `moveZoneContent` answers "done" for the zone the content already sits in
   * — the document is already in that state — so the command alone would offer
   * it. It is not a target: the prompt is asking where to put it instead.
   */
  it('never offers the zone the content is already in', () => {
    const { deck, zones } = deckWithThreeZones()
    const slideId = contentAt(deck, 1).id
    const targets = placementTargets(deck, slideId, { kind: 'zone', nodeId: zones[0] })
    expect(targets.has(zones[0])).toBe(false)
    expect([...targets].sort()).toEqual([zones[1], zones[2]].sort())
  })

  it('offers exactly the zones the command would accept', () => {
    const { deck, zones } = deckWithThreeZones()
    const slideId = contentAt(deck, 1).id

    for (const placement of [
      { kind: 'sandbox', itemId: deck.sandbox[0].id } as const,
      { kind: 'zone', nodeId: zones[0] } as const,
    ]) {
      const offered = placementTargets(deck, slideId, placement)
      for (const nodeId of zones) {
        // The same call the press ends in, run for its verdict.
        const outcome =
          placement.kind === 'sandbox'
            ? placeSandboxItem(deck, {
                itemId: placement.itemId,
                slideId,
                nodeId,
                ...domFitCheckers,
              })
            : moveZoneContent(deck, {
                slideId,
                fromNodeId: placement.nodeId,
                toNodeId: nodeId,
                ...domFitCheckers,
              })
        const isSource = placement.kind === 'zone' && nodeId === placement.nodeId
        expect(offered.has(nodeId), `${placement.kind} → ${nodeId}`).toBe(outcome.ok && !isSource)
      }
    }
  })

  it('answers nothing at all for a page that has no zones', () => {
    const deck = createPresentation({ title: 'Forside' })
    const frontId = deck.slides[0].id
    const targets = placementTargets(deck, frontId, { kind: 'sandbox', itemId: 'x' })
    expect(targets.size).toBe(0)
  })

  it('answers nothing for content that is not there any more', () => {
    const { deck } = deckWithThreeZones()
    const slideId = contentAt(deck, 1).id
    expect(placementTargets(deck, slideId, { kind: 'sandbox', itemId: 'borte' }).size).toBe(0)
  })
})
