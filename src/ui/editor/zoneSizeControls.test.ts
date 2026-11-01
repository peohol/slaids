import { describe, expect, it } from 'vitest'
import { createPresentation } from '../../domain/presentation'
import { splitLeaf } from '../../domain/commands'
import { estimateFitChecker } from '../../domain/fit'
import { contentAt } from '../../domain/testDecks'
import { sizeContextsFor } from './ZoneSizeControls'

/**
 * Which splits a "make this bigger" acts on.
 *
 * Two different questions wear the same words: a selected split is resized
 * from the inside — its children's ratios are what it has — and a selected
 * child is resized within the split it belongs to. A split that is itself a
 * child answers both, and the inspector offers both, inside first.
 */
describe('sizeContextsFor', () => {
  function deckWithSplit() {
    const base = createPresentation({ title: 'Soner' })
    const slide = contentAt(base, 1)
    const split = splitLeaf(base, {
      slideId: slide.id,
      nodeId: slide.root.id,
      axis: 'x',
      weights: [3, 1],
      fits: estimateFitChecker,
    })
    if (!split.ok) throw new Error('kunne ikke splitte')
    return split.value.presentation
  }

  function nestedDeck() {
    const base = deckWithSplit()
    const slide = contentAt(base, 1)
    if (slide.root.kind !== 'split') throw new Error('roten skulle vært splittet')
    const nested = splitLeaf(base, {
      slideId: slide.id,
      nodeId: slide.root.children[1].id,
      axis: 'y',
      weights: [1, 2, 1],
      fits: estimateFitChecker,
    })
    if (!nested.ok) throw new Error('kunne ikke splitte undersonen')
    return contentAt(nested.value.presentation, 1)
  }

  it('takes only the inside of a root split, with no single child in focus', () => {
    const slide = contentAt(deckWithSplit(), 1)
    const contexts = sizeContextsFor(slide, slide.root.id)
    expect(contexts.map((context) => context.scope)).toEqual(['inside'])
    expect(contexts[0].split.id).toBe(slide.root.id)
    expect(contexts[0].childIndex).toBeNull()
  })

  it('takes the parent split when a leaf child is selected, and says which child', () => {
    const slide = contentAt(deckWithSplit(), 1)
    if (slide.root.kind !== 'split') throw new Error('roten skulle vært splittet')
    const second = slide.root.children[1].id

    const contexts = sizeContextsFor(slide, second)
    expect(contexts.map((context) => context.scope)).toEqual(['siblings'])
    expect(contexts[0].split.id).toBe(slide.root.id)
    expect(contexts[0].childIndex).toBe(1)
    expect(contexts[0].split.weights).toEqual([3, 1])
  })

  it('gives a nested split both: its own children inside, and itself among its siblings', () => {
    const slide = nestedDeck()
    if (slide.root.kind !== 'split') throw new Error('roten skulle vært splittet')
    const nested = slide.root.children[1]
    if (nested.kind !== 'split') throw new Error('sone 2 skulle vært delt')

    const contexts = sizeContextsFor(slide, nested.id)
    expect(contexts.map((context) => [context.scope, context.split.id, context.childIndex])).toEqual([
      ['inside', nested.id, null],
      ['siblings', slide.root.id, 1],
    ])
    // Each names the ratios of the split it acts on — not the other one's.
    expect(contexts[0].split.weights).toEqual([1, 2, 1])
    expect(contexts[1].split.weights).toEqual([3, 1])
  })

  it('offers nothing for a root leaf, which belongs to no split', () => {
    const base = createPresentation({ title: 'Én sone' })
    const slide = contentAt(base, 1)
    expect(sizeContextsFor(slide, slide.root.id)).toEqual([])
    expect(sizeContextsFor(slide, null)).toEqual([])
  })
})
