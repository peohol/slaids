/**
 * An agent is held to the content's soft minimum; a person is not.
 *
 * A person may drag a zone below the size its text fits in at normal type —
 * the slide then draws the text smaller — through the editor's own entry,
 * `domain/commands/manualLayout.ts`. An agent may not, by any route: the same
 * shrink through `adjust_split` is refused, a deck a person left that way reads
 * back as not fitting, and every repair that makes it better is allowed while
 * nothing that makes it worse is.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { setSplitWeightsByHand } from '../domain/commands/manualLayout'
import { findContentSlide } from '../domain/presentation'
import { findSplit } from '../domain/layout'
import type { ContentSlideInspection } from './operations/deck'
import type { ValidationReport } from './operations/validation'
import type { ZoneChange } from './operations/layout'
import {
  agentOperation,
  agentRefusal,
  closeTestDatabases,
  newAgentDeck,
  storedPresentation,
  testAgentContext,
  type NewDeck,
  type TestDeckContext,
} from './testDeck'

afterEach(closeTestDatabases)

/** Words enough to fill most of half a slide's width, and no more. */
const TEXT = Array.from({ length: 70 }, (_, index) => `ord${index % 9}`).join(' ')

interface Setup {
  context: TestDeckContext
  deck: NewDeck
  left: string
}

/** A row of two equal zones, the left one holding text that fits it at normal size. */
async function rowWithText(): Promise<Setup> {
  const context = testAgentContext()
  const deck = await newAgentDeck(context, 'Myk grense')
  const split = await agentOperation<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
    presentationId: deck.presentationId,
    slideId: deck.slideId,
    nodeId: deck.rootNodeId,
    axis: 'x',
    weights: [1, 1],
  })
  const [left] = split.childNodeIds
  await agentOperation(context, 'set_zone_text', {
    presentationId: deck.presentationId,
    slideId: deck.slideId,
    nodeId: left,
    blocks: [{ type: 'paragraph', spans: [{ text: TEXT }] }],
  })
  return { context, deck, left }
}

/** The shrink a person makes by hand, stored the way the editor stores it. */
async function shrinkByHand({ context, deck }: Setup, weights: number[]): Promise<void> {
  const presentation = await storedPresentation(context, deck.presentationId)
  const result = setSplitWeightsByHand(presentation, {
    slideId: deck.slideId,
    nodeId: deck.rootNodeId,
    weights,
  })
  if (!result.ok) throw new Error(`refused: ${result.error.code}`)
  await context.repository.savePresentation(result.value.presentation)
}

async function storedWeights({ context, deck }: Setup): Promise<number[]> {
  const presentation = await storedPresentation(context, deck.presentationId)
  const slide = findContentSlide(presentation, deck.slideId)
  return (slide && findSplit(slide.root, deck.rootNodeId)?.weights) ?? []
}

function adjust({ deck }: Setup, weights: number[]) {
  return { presentationId: deck.presentationId, slideId: deck.slideId, nodeId: deck.rootNodeId, weights }
}

describe('MCP holder den myke minstegrensen', () => {
  it('avviser den samme forminskingen som et menneske fikk utføre', async () => {
    const setup = await rowWithText()
    const refused = await agentRefusal(setup.context, 'adjust_split', adjust(setup, [1, 3]))
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(await storedWeights(setup)).toEqual([1, 1])

    // The person's way in takes it — and only down to the hard minimum.
    await shrinkByHand(setup, [1, 3])
    expect(await storedWeights(setup)).toEqual([1, 3])
  })

  it('leser en for liten sone som en sone der innholdet ikke får plass', async () => {
    const setup = await rowWithText()
    await shrinkByHand(setup, [1, 3])
    const { context, deck, left } = setup

    const inspected = await agentOperation<ContentSlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(inspected.zones.find((zone) => zone.nodeId === left)?.fits).toBe(false)

    const report = await agentOperation<ValidationReport>(context, 'validate_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(report.valid).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toContain('CONTENT_DOES_NOT_FIT')
  })

  it('kan ikke gjøre en for liten sone verre, verken med forhold eller tekst', async () => {
    const setup = await rowWithText()
    await shrinkByHand(setup, [1, 3])
    const { context, deck, left } = setup

    expect((await agentRefusal(context, 'adjust_split', adjust(setup, [1, 4]))).code).toBe('CONTENT_DOES_NOT_FIT')
    const longer = await agentRefusal(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: left,
      blocks: [{ type: 'paragraph', spans: [{ text: `${TEXT} ${TEXT}` }] }],
    })
    expect(longer.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(await storedWeights(setup)).toEqual([1, 3])
  })

  it('kan gjøre sonen større igjen, steg for steg, til den er gyldig', async () => {
    const setup = await rowWithText()
    await shrinkByHand(setup, [1, 3])
    const { context, deck } = setup

    // Bigger but still too small is a repair, and a repair is allowed.
    await agentOperation(context, 'adjust_split', adjust(setup, [2, 5]))
    await agentOperation(context, 'adjust_split', adjust(setup, [1, 1]))
    const report = await agentOperation<ValidationReport>(context, 'validate_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(report.valid).toBe(true)
  })

  it('har ingen parameter som slipper en agent forbi grensen', async () => {
    const setup = await rowWithText()
    for (const extra of [{ allowOverflow: true }, { byHand: true }, { fits: null }]) {
      const refused = await agentRefusal(setup.context, 'adjust_split', { ...adjust(setup, [1, 3]), ...extra })
      expect(refused.code).not.toBe('OK')
    }
    expect(await storedWeights(setup)).toEqual([1, 1])
  })
})
