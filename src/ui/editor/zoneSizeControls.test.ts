import { describe, expect, it } from 'vitest'
import { createPresentation } from '../../domain/presentation'
import { splitLeaf } from '../../domain/commands'
import { estimateFitChecker } from '../../domain/fit'
import { contentAt } from '../../domain/testDecks'
import { splitContextFor } from './ZoneSizeControls'

/**
 * Which split a "make this bigger" acts on.
 *
 * Two different questions wear the same words: a selected split is resized
 * from the inside — its children's ratios are what it has — and a selected
 * child is resized within the split it belongs to.
 */
describe('splitContextFor', () => {
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
    return contentAt(split.value.presentation, 1)
  }

  it('takes the selected split itself, with no single child in focus', () => {
    const slide = deckWithSplit()
    const context = splitContextFor(slide, slide.root.id)
    expect(context?.split.id).toBe(slide.root.id)
    expect(context?.childIndex).toBeNull()
  })

  it('takes the parent split when a child is selected, and says which child', () => {
    const slide = deckWithSplit()
    if (slide.root.kind !== 'split') throw new Error('roten skulle vært splittet')
    const second = slide.root.children[1].id

    const context = splitContextFor(slide, second)
    expect(context?.split.id).toBe(slide.root.id)
    expect(context?.childIndex).toBe(1)
    expect(context?.split.weights).toEqual([3, 1])
  })

  it('offers nothing for a root leaf, which belongs to no split', () => {
    const base = createPresentation({ title: 'Én sone' })
    const slide = contentAt(base, 1)
    expect(splitContextFor(slide, slide.root.id)).toBeNull()
    expect(splitContextFor(slide, null)).toBeNull()
  })
})
