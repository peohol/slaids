import { describe, expect, it } from 'vitest'
import { createPresentation } from '../presentation'
import { createLeaf, createSplit, findLeaf, findNode, findSplit } from '../layout'
import {
  bodyOf,
  containerWithDoc,
  createContainer,
  createTitledCard,
  createUntitledCard,
} from '../content'
import { estimateFitChecker } from '../fit'
import { paragraphDoc, titleDoc } from '../richdoc'
import type { Presentation, SplitNode } from '../types'
import {
  addReference,
  addSlide,
  deleteUnusedReferences,
  clearLayoutNode,
  copyZoneContent,
  deleteLayoutNode,
  deleteReference,
  deleteSlide,
  mergeReferenceInto,
  duplicateSlide,
  moveSlide,
  moveZoneContent,
  moveZoneContentToSandbox,
  placeSandboxItem,
  setBodyAxis,
  setBodyLayout,
  setBodyWeights,
  setContentKind,
  setSlideHasTitle,
  setSlideTitle,
  setSubfieldCount,
  setSubfieldDoc,
  setTheme,
  setZoneContent,
  splitLeaf,
  updateSplit,
} from './index'
import { contentAt, sectionAt } from '../testDecks'

function base(): Presentation {
  return createPresentation({ title: 'Test' })
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

describe('slide commands', () => {
  it('adds a slide at the end by default', () => {
    // A new deck is `[front section, one empty slide]`, so adding one makes three.
    const next = unwrap(addSlide(base(), {}))
    expect(next.slides).toHaveLength(3)
    expect(contentAt(next, 2).title).not.toBeNull()
  })

  it('adds a slide without a title zone', () => {
    const next = unwrap(addSlide(base(), { hasTitle: false }))
    expect(contentAt(next, 2).title).toBeNull()
  })

  it('rejects an out-of-range insert index', () => {
    const result = addSlide(base(), { index: 5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('SLIDE_INDEX_OUT_OF_RANGE')
  })

  it('refuses to delete the last remaining slide', () => {
    const deck = base()
    const presentation = unwrap(deleteSlide(deck, deck.slides[1].id))
    expect(presentation.slides).toHaveLength(1)
    const result = deleteSlide(presentation, presentation.slides[0].id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANNOT_DELETE_LAST_SLIDE')
  })

  it('duplicates a slide with fresh ids right after the original', () => {
    let presentation = base()
    presentation = unwrap(
      setZoneContent(presentation, {
        slideId: presentation.slides[1].id,
        nodeId: contentAt(presentation, 1).root.id,
        content: createUntitledCard(),
      }),
    ).presentation
    const next = unwrap(duplicateSlide(presentation, presentation.slides[1].id))
    expect(next.slides).toHaveLength(3)
    expect(next.slides[2].id).not.toBe(next.slides[1].id)
    expect(contentAt(next, 2).root.id).not.toBe(contentAt(next, 1).root.id)
    expect(findLeaf(contentAt(next, 2).root, contentAt(next, 2).root.id)?.content).not.toBeNull()
  })

  it('reorders slides', () => {
    let presentation = base()
    presentation = unwrap(addSlide(presentation, {}))
    presentation = unwrap(addSlide(presentation, {}))
    const first = presentation.slides[1].id
    const next = unwrap(moveSlide(presentation, first, 3))
    expect(next.slides[3].id).toBe(first)
  })

  it('toggles the title zone off and back on', () => {
    const presentation = base()
    const slideId = presentation.slides[1].id
    const removed = unwrap(setSlideHasTitle(presentation, slideId, false))
    expect(contentAt(removed, 1).title).toBeNull()
    const restored = unwrap(setSlideHasTitle(removed, slideId, true))
    expect(contentAt(restored, 1).title).not.toBeNull()
  })

  it('refuses to add a title when the layout would no longer fit', () => {
    let presentation = base()
    const slideId = presentation.slides[1].id
    presentation = unwrap(setSlideHasTitle(presentation, slideId, false))
    // Eight stacked rows of text fit without a title but not with one. They
    // hold content on purpose: empty rows have no minimum to fall below, so the
    // title zone could take room from them without hiding anything.
    const rows = Array.from({ length: 8 }, () => createLeaf(createContainer()))
    presentation = {
      ...presentation,
      slides: [
        sectionAt(presentation, 0),
        { ...contentAt(presentation, 1), root: createSplit('y', rows.map(() => 1), rows) },
        ...presentation.slides.slice(1),
      ],
    }
    const result = setSlideHasTitle(presentation, slideId, true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ZONE_TOO_SMALL')
  })
})

describe('splitLeaf', () => {
  it('replaces a leaf with a split of empty leaves', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const outcome = unwrap(
      splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        axis: 'x',
        weights: [2, 3],
      }),
    )
    const root = contentAt(outcome.presentation, 1).root as SplitNode
    expect(root.kind).toBe('split')
    expect(root.children).toHaveLength(2)
    expect(root.weights).toEqual([2, 3])
  })

  it('rejects fewer than two or more than ten children', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    for (const weights of [[1], Array.from({ length: 11 }, () => 1)]) {
      const result = splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        axis: 'x',
        weights,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_CHILD_COUNT')
    }
  })

  it('rejects non-positive weights', () => {
    const presentation = base()
    const result = splitLeaf(presentation, {
      slideId: presentation.slides[1].id,
      nodeId: contentAt(presentation, 1).root.id,
      axis: 'x',
      weights: [1, 0],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_WEIGHTS')
  })

  it('allows a lopsided split of an empty zone, however narrow the sliver', () => {
    // Nothing is drawn in either child yet, so nothing can be hidden. This is
    // how deliberate air is made: split first, then declare the sliver air.
    const presentation = base()
    const outcome = unwrap(
      splitLeaf(presentation, {
        slideId: presentation.slides[1].id,
        nodeId: contentAt(presentation, 1).root.id,
        axis: 'x',
        weights: [1, 100],
      }),
    )
    const root = contentAt(outcome.presentation, 1).root as SplitNode
    expect(root.weights).toEqual([1, 10])
  })

  it('rejects a split that would leave the content in it too small a child', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createContainer(),
        fits: estimateFitChecker,
      }),
    ).presentation
    const result = splitLeaf(filled, {
      slideId: presentation.slides[1].id,
      nodeId: contentAt(filled, 1).root.id,
      axis: 'x',
      weights: [1, 100],
      contentTargetIndex: 0,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ZONE_TOO_SMALL')
  })

  it('refuses to split a node that is already a split', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const once = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const result = splitLeaf(once, {
      slideId: slide.id,
      nodeId: contentAt(once, 1).root.id,
      axis: 'y',
      weights: [1, 1],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NODE_NOT_LEAF')
  })

  it('moves existing content into the chosen child', () => {
    let presentation = base()
    const slide = contentAt(presentation, 1)
    presentation = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createUntitledCard(),
      }),
    ).presentation
    const outcome = unwrap(
      splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: contentAt(presentation, 1).root.id,
        axis: 'x',
        weights: [1, 1],
        contentTargetIndex: 1,
      }),
    )
    const root = contentAt(outcome.presentation, 1).root as SplitNode
    expect(findLeaf(root.children[0], root.children[0].id)?.content).toBeNull()
    expect(findLeaf(root.children[1], root.children[1].id)?.content).not.toBeNull()
    expect(outcome.movedToSandbox).toHaveLength(0)
  })

  it('never leaves a node with both children and content', () => {
    let presentation = base()
    const slide = contentAt(presentation, 1)
    presentation = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createUntitledCard(),
      }),
    ).presentation
    const outcome = unwrap(
      splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: contentAt(presentation, 1).root.id,
        axis: 'y',
        weights: [1, 1],
        contentTargetIndex: 0,
      }),
    )
    const root = contentAt(outcome.presentation, 1).root
    expect(root.kind).toBe('split')
    expect('content' in root).toBe(false)
  })

  it('moves content to the sandbox when it cannot fit the chosen child', () => {
    let presentation = base()
    const slide = contentAt(presentation, 1)
    const card = createUntitledCard()
    const filled = {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc('lorem ipsum '.repeat(400)) }],
      },
    }
    presentation = unwrap(
      setZoneContent(presentation, { slideId: slide.id, nodeId: slide.root.id, content: filled }),
    ).presentation
    const outcome = unwrap(
      splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: contentAt(presentation, 1).root.id,
        axis: 'x',
        weights: [1, 1],
        contentTargetIndex: 0,
        fits: estimateFitChecker,
      }),
    )
    expect(outcome.movedToSandbox).toHaveLength(1)
    expect(outcome.presentation.sandbox).toHaveLength(1)
  })
})

describe('updateSplit', () => {
  function withSplit(): { presentation: Presentation; slideId: string; nodeId: string } {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const next = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    return { presentation: next, slideId: slide.id, nodeId: contentAt(next, 1).root.id }
  }

  it('changes the axis', () => {
    const { presentation, slideId, nodeId } = withSplit()
    const outcome = unwrap(updateSplit(presentation, { slideId, nodeId, axis: 'y' }))
    expect((contentAt(outcome.presentation, 1).root as SplitNode).axis).toBe('y')
  })

  it('changes weights', () => {
    const { presentation, slideId, nodeId } = withSplit()
    const outcome = unwrap(updateSplit(presentation, { slideId, nodeId, weights: [1, 3] }))
    expect((contentAt(outcome.presentation, 1).root as SplitNode).weights).toEqual([1, 3])
  })

  it('adds children as empty leaves', () => {
    const { presentation, slideId, nodeId } = withSplit()
    const outcome = unwrap(updateSplit(presentation, { slideId, nodeId, childCount: 4 }))
    const root = contentAt(outcome.presentation, 1).root as SplitNode
    expect(root.children).toHaveLength(4)
    expect(root.weights).toEqual([1, 1, 1, 1])
  })

  it('moves content out of removed children into the sandbox', () => {
    const { presentation, slideId, nodeId } = withSplit()
    const root = contentAt(presentation, 1).root as SplitNode
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId,
        nodeId: root.children[1].id,
        content: createUntitledCard(),
      }),
    ).presentation
    const outcome = unwrap(
      updateSplit(filled, { slideId, nodeId, childCount: 2, weights: [1, 1] }),
    )
    expect(outcome.movedToSandbox).toHaveLength(0)

    const shrunk = unwrap(updateSplit(filled, { slideId, nodeId, childCount: 2 }))
    expect(shrunk.presentation.sandbox).toHaveLength(0)
  })

  it('discards removed content when asked to delete', () => {
    const initial = withSplit()
    const { slideId, nodeId } = initial
    let presentation = unwrap(
      updateSplit(initial.presentation, { slideId, nodeId, childCount: 3 }),
    ).presentation
    const root = contentAt(presentation, 1).root as SplitNode
    presentation = unwrap(
      setZoneContent(presentation, {
        slideId,
        nodeId: root.children[2].id,
        content: createUntitledCard(),
      }),
    ).presentation
    const outcome = unwrap(
      updateSplit(presentation, { slideId, nodeId, childCount: 2, removedDisposition: 'delete' }),
    )
    expect(outcome.discarded).toHaveLength(1)
    expect(outcome.presentation.sandbox).toHaveLength(0)
  })

  it('rejects an update that would make a nested subtree too small for its content', () => {
    const { presentation, slideId, nodeId } = withSplit()
    const root = contentAt(presentation, 1).root as SplitNode
    const nested = unwrap(
      splitLeaf(presentation, {
        slideId,
        nodeId: root.children[0].id,
        axis: 'x',
        weights: [1, 1],
      }),
    ).presentation
    const inner = (contentAt(nested, 1).root as SplitNode).children[0] as SplitNode
    let filled = nested
    for (const child of inner.children) {
      filled = unwrap(
        setZoneContent(filled, {
          slideId,
          nodeId: child.id,
          content: createContainer(),
          fits: estimateFitChecker,
        }),
      ).presentation
    }
    const result = updateSplit(filled, { slideId, nodeId, weights: [1, 12] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ZONE_TOO_SMALL')
  })

  it('rejects a mismatch between weights and child count', () => {
    const { presentation, slideId, nodeId } = withSplit()
    const result = updateSplit(presentation, { slideId, nodeId, childCount: 3, weights: [1, 1] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_WEIGHTS')
  })
})

describe('delete and clear', () => {
  it('refuses to delete the root', () => {
    const presentation = base()
    const result = deleteLayoutNode(presentation, {
      slideId: presentation.slides[1].id,
      nodeId: contentAt(presentation, 1).root.id,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ROOT_CANNOT_BE_DELETED')
  })

  it('collapses the parent after deleting one of two children', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const root = contentAt(split, 1).root as SplitNode
    const outcome = unwrap(
      deleteLayoutNode(split, { slideId: slide.id, nodeId: root.children[1].id }),
    )
    expect(contentAt(outcome.presentation, 1).root.kind).toBe('leaf')
    expect(contentAt(outcome.presentation, 1).root.id).toBe(root.children[0].id)
  })

  it('rescues content from a deleted subtree into the sandbox', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const root = contentAt(split, 1).root as SplitNode
    const filled = unwrap(
      setZoneContent(split, { slideId: slide.id, nodeId: root.children[1].id, content: createTitledCard('Kort') }),
    ).presentation
    const outcome = unwrap(
      deleteLayoutNode(filled, { slideId: slide.id, nodeId: root.children[1].id }),
    )
    expect(outcome.movedToSandbox).toHaveLength(1)
    expect(outcome.presentation.sandbox).toHaveLength(1)
  })

  it('clears a whole subtree back to one empty leaf', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1, 1] }),
    ).presentation
    const outcome = unwrap(
      clearLayoutNode(split, { slideId: slide.id, nodeId: contentAt(split, 1).root.id }),
    )
    expect(contentAt(outcome.presentation, 1).root.kind).toBe('leaf')
  })
})

describe('content placement', () => {
  it('refuses to place content in an occupied zone', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createUntitledCard(),
      }),
    ).presentation
    const result = setZoneContent(filled, {
      slideId: slide.id,
      nodeId: slide.root.id,
      content: createUntitledCard(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TARGET_OCCUPIED')
  })

  it('refuses to place content on a split node', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const result = setZoneContent(split, {
      slideId: slide.id,
      nodeId: contentAt(split, 1).root.id,
      content: createUntitledCard(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NODE_NOT_LEAF')
  })

  it('moves content between zones and clears the source', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const root = contentAt(split, 1).root as SplitNode
    const filled = unwrap(
      setZoneContent(split, { slideId: slide.id, nodeId: root.children[0].id, content: createUntitledCard() }),
    ).presentation
    const outcome = unwrap(
      moveZoneContent(filled, {
        slideId: slide.id,
        fromNodeId: root.children[0].id,
        toNodeId: root.children[1].id,
      }),
    )
    const nextRoot = contentAt(outcome.presentation, 1).root as SplitNode
    expect(findLeaf(nextRoot, nextRoot.children[0].id)?.content).toBeNull()
    expect(findLeaf(nextRoot, nextRoot.children[1].id)?.content).not.toBeNull()
  })

  it('says which side of a move it refused, and tells missing apart from split', () => {
    // Two zones are addressed here, so a code alone cannot say which one the
    // caller has to fix. Every refusal carries the slide and node it is about.
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const root = contentAt(split, 1).root as SplitNode
    const filled = unwrap(
      setZoneContent(split, { slideId: slide.id, nodeId: root.children[0].id, content: createUntitledCard() }),
    ).presentation

    const refusal = (
      from: string,
      to: string,
    ): { code: string; details?: Record<string, unknown> } => {
      const result = moveZoneContent(filled, { slideId: slide.id, fromNodeId: from, toNodeId: to })
      if (result.ok) throw new Error('Expected a refusal')
      return result.error
    }

    // An empty source, named as the source.
    expect(refusal(root.children[1].id, root.children[0].id)).toMatchObject({
      code: 'TARGET_EMPTY',
      details: { slideId: slide.id, nodeId: root.children[1].id },
    })
    // An occupied target, named as the target.
    const occupied = unwrap(
      setZoneContent(filled, { slideId: slide.id, nodeId: root.children[1].id, content: createUntitledCard() }),
    ).presentation
    const both = moveZoneContent(occupied, {
      slideId: slide.id,
      fromNodeId: root.children[0].id,
      toNodeId: root.children[1].id,
    })
    expect(both.ok).toBe(false)
    if (!both.ok) {
      expect(both.error).toMatchObject({
        code: 'TARGET_OCCUPIED',
        details: { slideId: slide.id, nodeId: root.children[1].id },
      })
    }

    // A split node is there but unusable; an unknown id is not there at all,
    // and a caller told the first about the second would go looking for a
    // split that does not exist.
    expect(refusal(root.id, root.children[1].id).code).toBe('NODE_NOT_LEAF')
    expect(refusal(root.children[0].id, root.id).code).toBe('NODE_NOT_LEAF')
    expect(refusal('n_missing', root.children[1].id)).toMatchObject({
      code: 'NODE_NOT_FOUND',
      details: { nodeId: 'n_missing' },
    })
    expect(refusal(root.children[0].id, 'n_missing')).toMatchObject({
      code: 'NODE_NOT_FOUND',
      details: { nodeId: 'n_missing' },
    })
  })

  it('converts a container into a titled card, keeping the text', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const container = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: containerWithDoc(paragraphDoc('Hei verden')),
      }),
    ).presentation
    const converted = unwrap(
      setContentKind(container, { slideId: slide.id, nodeId: slide.root.id, kind: 'titled-card' }),
    )
    const content = findLeaf(contentAt(converted, 1).root, slide.root.id)?.content
    expect(content?.kind).toBe('titled-card')
    if (content?.kind === 'titled-card') {
      expect(JSON.stringify(content.body.subfields[0].doc)).toContain('Hei verden')
    }
  })

  it('sets count, axis and weights in one step, gated once', () => {
    // The reason `setBodyLayout` exists: a card whose two columns fit can be
    // unreachable if the three questions are asked one at a time, because the
    // two *rows* it passes through on the way are measured on their own.
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: containerWithDoc(paragraphDoc('Første')),
      }),
    ).presentation

    const shaped = unwrap(
      setBodyLayout(filled, {
        slideId: slide.id,
        nodeId: slide.root.id,
        subfieldCount: 2,
        axis: 'x',
        weights: [2, 1],
      }),
    )
    const content = findLeaf(contentAt(shaped, 1).root, slide.root.id)?.content
    if (content?.kind !== 'container') {
      throw new Error('expected a text container')
    }
    expect(content.body.axis).toBe('x')
    expect(content.body.weights).toEqual([2, 1])
    expect(content.body.subfields).toHaveLength(2)
  })

  it('matches weights against the count the call ends with', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: containerWithDoc(paragraphDoc('Første')),
      }),
    ).presentation
    const target = { slideId: slide.id, nodeId: slide.root.id }

    // One subfield today, three after the call: three weights is right, and
    // one — the count it started with — is not.
    expect(setBodyLayout(filled, { ...target, subfieldCount: 3, weights: [1, 2, 3] }).ok).toBe(true)
    const stale = setBodyLayout(filled, { ...target, subfieldCount: 3, weights: [1] })
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.error.code).toBe('INVALID_WEIGHTS')
      expect(stale.error.details).toMatchObject({ expected: 3, received: 1 })
    }
  })

  it('rejects weights that are not positive numbers, and leaves the document alone', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createTitledCard('Kort', undefined, 2),
      }),
    ).presentation
    const target = { slideId: slide.id, nodeId: slide.root.id }

    for (const weights of [[1, 0], [1, -2], [1, Number.NaN], [1, Number.POSITIVE_INFINITY]]) {
      const result = setBodyLayout(filled, { ...target, weights })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_WEIGHTS')
    }
    expect(setBodyLayout(filled, { ...target, subfieldCount: 0 }).ok).toBe(false)
    expect(setBodyLayout(filled, { ...target, subfieldCount: 7 }).ok).toBe(false)
    expect(setBodyLayout(filled, { ...target, subfieldCount: 1.5 }).ok).toBe(false)
  })

  it('leaves updatedAt alone when the layout asked for is the one it already has', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createTitledCard('Kort', undefined, 2),
      }),
    ).presentation
    const same = unwrap(
      setBodyLayout(filled, {
        slideId: slide.id,
        nodeId: slide.root.id,
        axis: 'y',
        weights: [1, 1],
      }),
    )
    expect(same).toBe(filled)
  })

  it('validates body weights against the subfield count', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createTitledCard('Kort', undefined, 2),
      }),
    ).presentation
    expect(setBodyWeights(filled, { slideId: slide.id, nodeId: slide.root.id, weights: [1, 2] }).ok).toBe(true)
    const bad = setBodyWeights(filled, { slideId: slide.id, nodeId: slide.root.id, weights: [1] })
    expect(bad.ok).toBe(false)
  })

  it('writes a subfield document', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const card = createTitledCard('Kort')
    const filled = unwrap(
      setZoneContent(presentation, { slideId: slide.id, nodeId: slide.root.id, content: card }),
    ).presentation
    const next = unwrap(
      setSubfieldDoc(filled, {
        slideId: slide.id,
        nodeId: slide.root.id,
        subfieldId: card.body.subfields[0].id,
        doc: paragraphDoc('Innhold'),
      }),
    )
    const content = findLeaf(contentAt(next, 1).root, slide.root.id)?.content
    expect(JSON.stringify(content)).toContain('Innhold')
  })

  it('divides a container into subfields like a card', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: containerWithDoc(paragraphDoc('Første')),
      }),
    ).presentation

    const split = unwrap(
      setSubfieldCount(filled, { slideId: slide.id, nodeId: slide.root.id, count: 3 }),
    )
    const content = findLeaf(contentAt(split, 1).root, slide.root.id)?.content
    if (content?.kind !== 'container') {
      throw new Error('expected a text container')
    }
    expect(content.body.subfields).toHaveLength(3)
    expect(content.body.weights).toEqual([1, 1, 1])
    // The text that was already there stays in the first field.
    expect(JSON.stringify(content.body.subfields[0].doc)).toContain('Første')

    const sideways = unwrap(
      setBodyAxis(split, { slideId: slide.id, nodeId: slide.root.id, axis: 'x' }),
    )
    const after = findLeaf(contentAt(sideways, 1).root, slide.root.id)?.content
    if (after?.kind !== 'container') {
      throw new Error('expected a text container')
    }
    expect(after.body.axis).toBe('x')

    // A field with text in it is not silently dropped by shrinking the count.
    const withText = unwrap(
      setSubfieldDoc(sideways, {
        slideId: slide.id,
        nodeId: slide.root.id,
        subfieldId: after.body.subfields[2].id,
        doc: paragraphDoc('Tredje'),
      }),
    )
    expect(
      setSubfieldCount(withText, { slideId: slide.id, nodeId: slide.root.id, count: 2 }).ok,
    ).toBe(false)
  })
})

describe('sandbox', () => {
  it('round-trips content out to the sandbox and back', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createUntitledCard(),
      }),
    ).presentation
    const moved = unwrap(
      moveZoneContentToSandbox(filled, { slideId: slide.id, nodeId: slide.root.id }),
    ).presentation
    expect(moved.sandbox).toHaveLength(1)
    expect(findLeaf(contentAt(moved, 1).root, slide.root.id)?.content).toBeNull()

    const placed = unwrap(
      placeSandboxItem(moved, {
        itemId: moved.sandbox[0].id,
        slideId: slide.id,
        nodeId: slide.root.id,
        fits: estimateFitChecker,
      }),
    )
    expect(placed.presentation.sandbox).toHaveLength(0)
    expect(findLeaf(contentAt(placed.presentation, 1).root, slide.root.id)?.content).not.toBeNull()
  })

  it('refuses to place content that does not fit', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const card = createUntitledCard()
    const huge = {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc('ord '.repeat(3000)) }],
      },
    }
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const root = contentAt(split, 1).root as SplitNode
    const withSandbox = { ...split, sandbox: [{ id: 'sb1', content: huge, createdAt: '', note: '' }] }
    const result = placeSandboxItem(withSandbox, {
      itemId: 'sb1',
      slideId: slide.id,
      nodeId: root.children[0].id,
      fits: estimateFitChecker,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
  })
})

describe('references', () => {
  it('rejects a reference with only a year', () => {
    const result = addReference(base(), { title: '', authors: '', url: '', year: '2020' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REFERENCE_INVALID')
  })

  it('removes citations when a reference is deleted', () => {
    const presentation = base()
    const added = unwrap(
      addReference(presentation, { title: 'Kilde', authors: 'A', url: '', year: '2020' }),
    )
    const slide = contentAt(added.presentation, 1)
    const withTitle: Presentation = {
      ...added.presentation,
      slides: [
        sectionAt(added.presentation, 0),
        {
          ...slide,
          title: {
            type: 'doc' as const,
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Tittel' },
                  { type: 'citation', attrs: { referenceIds: [added.reference.id] } },
                ],
              },
            ],
          },
        },
      ],
    }
    const cleaned = unwrap(deleteReference(withTitle, added.reference.id))
    expect(JSON.stringify(contentAt(cleaned, 1).title)).not.toContain('citation')
    expect(cleaned.references).toHaveLength(0)
  })

  it('slår sammen to referanser: citations viser til den som blir igjen, én gang', () => {
    const first = unwrap(addReference(base(), { title: 'Beholdes', authors: '', url: '', year: '' }))
    const second = unwrap(addReference(first.presentation, { title: 'Duplikat', authors: '', url: '', year: '' }))
    const keep = first.reference.id
    const drop = second.reference.id
    const slide = contentAt(second.presentation, 1)
    const cite = (...referenceIds: string[]) => ({ type: 'citation', attrs: { referenceIds } })
    const deck: Presentation = {
      ...second.presentation,
      slides: [
        sectionAt(second.presentation, 0),
        {
          ...slide,
          title: {
            type: 'doc' as const,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, cite(drop), cite(keep, drop)] }],
          },
        },
      ],
    }
    const merged = unwrap(mergeReferenceInto(deck, drop, keep))
    expect(merged.references.map(({ id }) => id)).toEqual([keep])
    expect(contentAt(merged, 1).title?.content?.[0].content?.slice(1)).toEqual([cite(keep), cite(keep)])
    expect(mergeReferenceInto(deck, drop, 'ukjent').ok).toBe(false)
  })
})

describe('immutability', () => {
  it('never mutates the input presentation', () => {
    const presentation = base()
    const snapshot = JSON.stringify(presentation)
    splitLeaf(presentation, {
      slideId: presentation.slides[1].id,
      nodeId: contentAt(presentation, 1).root.id,
      axis: 'x',
      weights: [1, 1],
    })
    addSlide(presentation, {})
    setZoneContent(presentation, {
      slideId: presentation.slides[1].id,
      nodeId: contentAt(presentation, 1).root.id,
      content: createUntitledCard(),
    })
    expect(JSON.stringify(presentation)).toBe(snapshot)
  })

  it('reports missing slides and nodes rather than throwing', () => {
    const presentation = base()
    expect(splitLeaf(presentation, { slideId: 'nope', nodeId: 'x', axis: 'x', weights: [1, 1] }).ok).toBe(false)
    expect(
      splitLeaf(presentation, {
        slideId: presentation.slides[1].id,
        nodeId: 'nope',
        axis: 'x',
        weights: [1, 1],
      }).ok,
    ).toBe(false)
  })
})

describe('titles', () => {
  it('keeps the slide title document when duplicating', () => {
    let presentation = base()
    presentation = {
      ...presentation,
      slides: [sectionAt(presentation, 0),{ ...contentAt(presentation, 1), title: titleDoc('Min tittel') }],
    }
    const next = unwrap(duplicateSlide(presentation, presentation.slides[1].id))
    expect(JSON.stringify(contentAt(next, 2).title)).toContain('Min tittel')
  })

  it('finds nodes and splits by id', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    expect(findNode(slide.root, slide.root.id)).not.toBeNull()
    expect(findSplit(slide.root, slide.root.id)).toBeNull()
  })
})

describe('content fit on structural changes', () => {
  function filledCard(text: string) {
    const card = createUntitledCard()
    return {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc(text) }],
      },
    }
  }

  it('refuses a ratio change that would make existing content overflow', () => {
    let presentation = base()
    const slide = contentAt(presentation, 1)
    presentation = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const root = contentAt(presentation, 1).root as SplitNode
    presentation = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: root.children[0].id,
        content: filledCard('ord '.repeat(120)),
        fits: estimateFitChecker,
      }),
    ).presentation

    const shrink = updateSplit(presentation, {
      slideId: slide.id,
      nodeId: root.id,
      weights: [1, 6],
      fits: estimateFitChecker,
    })
    expect(shrink.ok).toBe(false)
    if (!shrink.ok) expect(shrink.error.code).toBe('CONTENT_DOES_NOT_FIT')

    // Growing the same zone is fine.
    expect(
      updateSplit(presentation, {
        slideId: slide.id,
        nodeId: root.id,
        weights: [6, 1],
        fits: estimateFitChecker,
      }).ok,
    ).toBe(true)
  })

  it('refuses to add a title zone when the content would then overflow', () => {
    let presentation = base()
    const slideId = presentation.slides[1].id
    presentation = unwrap(setSlideHasTitle(presentation, slideId, false))
    presentation = unwrap(
      setZoneContent(presentation, {
        slideId,
        nodeId: contentAt(presentation, 1).root.id,
        // Fits the full-height main zone, but not once the title zone and the
        // gap under it take their share off the top.
        content: filledCard('ord '.repeat(300)),
        fits: estimateFitChecker,
      }),
    ).presentation

    const result = setSlideHasTitle(presentation, slideId, true, { fits: estimateFitChecker })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
  })

  it('refuses to remove a title that has text unless forced', () => {
    let presentation = base()
    const slideId = presentation.slides[1].id
    presentation = unwrap(setSlideTitle(presentation, slideId, titleDoc('Viktig overskrift')))

    const refused = setSlideHasTitle(presentation, slideId, false)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('INVALID_ARGUMENT')

    const forced = setSlideHasTitle(presentation, slideId, false, { force: true })
    expect(forced.ok).toBe(true)
    if (forced.ok) expect(contentAt(forced.value, 1).title).toBeNull()
  })

  it('removes an empty title zone without forcing', () => {
    const presentation = base()
    expect(setSlideHasTitle(presentation, presentation.slides[1].id, false).ok).toBe(true)
  })

  /** A slide split in two, with a titled card in the left half. */
  function filledPair(): { presentation: Presentation; slideId: string; root: SplitNode } {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const root = contentAt(split, 1).root as SplitNode
    const filled = unwrap(
      setZoneContent(split, {
        slideId: slide.id,
        nodeId: root.children[0].id,
        content: createTitledCard('Kilde'),
      }),
    ).presentation
    return { presentation: filled, slideId: slide.id, root }
  }

  it('gives copied content fresh ids and leaves the source exactly as it was', () => {
    const { presentation, slideId, root } = filledPair()
    const before = structuredClone(presentation)

    const copied = unwrap(
      copyZoneContent(presentation, {
        slideId,
        fromNodeId: root.children[0].id,
        toNodeId: root.children[1].id,
      }),
    ).presentation

    const nextRoot = contentAt(copied, 1).root as SplitNode
    const a = findLeaf(nextRoot, nextRoot.children[0].id)?.content
    const b = findLeaf(nextRoot, nextRoot.children[1].id)?.content
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a?.id).not.toBe(b?.id)
    if (a?.kind === 'titled-card' && b?.kind === 'titled-card') {
      expect(a.body.subfields[0].id).not.toBe(b.body.subfields[0].id)
    }
    // The source is not merely still there: it is the same object it was, ids
    // included. A copy that renewed the source's ids would look identical on
    // screen and break every id its caller was holding.
    const sourceBefore = findLeaf(contentAt(before, 1).root, root.children[0].id)?.content
    expect(a).toEqual(sourceBefore)
    // Commands are pure, so the document handed in is untouched too.
    expect(presentation).toEqual(before)
  })

  it('gives a copied text zone fresh subfield ids too, not only a card', () => {
    // A plain text zone is a `container` whose payload *is* a `CardBody`, so its
    // subfields are addressable by id exactly like a card's. Cloning only the
    // two card kinds left the copy sharing those ids with its source: not an
    // independent copy, and an agent handed them back was handed the source's.
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1] }),
    ).presentation
    const root = contentAt(split, 1).root as SplitNode
    const filled = unwrap(
      setZoneContent(split, {
        slideId: slide.id,
        nodeId: root.children[0].id,
        content: containerWithDoc(paragraphDoc('Ren tekst')),
      }),
    ).presentation

    const copied = unwrap(
      copyZoneContent(filled, {
        slideId: slide.id,
        fromNodeId: root.children[0].id,
        toNodeId: root.children[1].id,
      }),
    ).presentation

    const nextRoot = contentAt(copied, 1).root as SplitNode
    const source = findLeaf(nextRoot, nextRoot.children[0].id)?.content
    const copy = findLeaf(nextRoot, nextRoot.children[1].id)?.content
    expect(source?.kind).toBe('container')
    expect(copy?.id).not.toBe(source?.id)
    const sourceFields = source ? bodyOf(source)?.subfields.map((field) => field.id) : undefined
    const copyFields = copy ? bodyOf(copy)?.subfields.map((field) => field.id) : undefined
    expect(sourceFields).toHaveLength(1)
    expect(copyFields).toHaveLength(1)
    expect(copyFields).not.toEqual(sourceFields)
    // The text itself did travel: only the ids are new.
    expect(copy && bodyOf(copy)?.subfields[0].doc).toEqual(
      source && bodyOf(source)?.subfields[0].doc,
    )
  })

  it('refuses a copy onto the source zone instead of reporting a copy it never made', () => {
    // A move onto the zone the content already sits in is a legal no-op: the
    // document is already in the state asked for. A copy is not — the target
    // is occupied, by the very content being copied — and answering `ok` would
    // send the caller looking for a second content object that was never made.
    const { presentation, slideId, root } = filledPair()
    const onto = { slideId, fromNodeId: root.children[0].id, toNodeId: root.children[0].id }

    const moved = moveZoneContent(presentation, onto)
    expect(moved.ok).toBe(true)
    if (moved.ok) expect(moved.value.presentation).toBe(presentation)

    const copied = copyZoneContent(presentation, onto)
    expect(copied.ok).toBe(false)
    if (!copied.ok) {
      expect(copied.error).toMatchObject({
        code: 'TARGET_OCCUPIED',
        details: { slideId, nodeId: root.children[0].id },
      })
    }
  })

  it('names the side of a copy it refused, on both sides', () => {
    // The same rule as a move, and for the same reason: two zones are addressed,
    // so a code alone cannot say which one the caller has to fix.
    const { presentation, slideId, root } = filledPair()
    const refusal = (from: string, to: string): { code: string; details?: Record<string, unknown> } => {
      const result = copyZoneContent(presentation, { slideId, fromNodeId: from, toNodeId: to })
      if (result.ok) throw new Error('Expected a refusal')
      return result.error
    }

    expect(refusal(root.children[1].id, root.children[0].id)).toMatchObject({
      code: 'TARGET_EMPTY',
      details: { slideId, nodeId: root.children[1].id },
    })
    expect(refusal(root.id, root.children[1].id)).toMatchObject({
      code: 'NODE_NOT_LEAF',
      details: { slideId, nodeId: root.id },
    })
    expect(refusal(root.children[0].id, root.id)).toMatchObject({
      code: 'NODE_NOT_LEAF',
      details: { slideId, nodeId: root.id },
    })
    expect(refusal('n_missing', root.children[1].id)).toMatchObject({
      code: 'NODE_NOT_FOUND',
      details: { slideId, nodeId: 'n_missing' },
    })
    expect(refusal(root.children[0].id, 'n_missing')).toMatchObject({
      code: 'NODE_NOT_FOUND',
      details: { slideId, nodeId: 'n_missing' },
    })
    expect(
      copyZoneContent(presentation, {
        slideId,
        fromNodeId: root.children[0].id,
        toSlideId: 's_missing',
        toNodeId: root.children[1].id,
      }),
    ).toMatchObject({ ok: false, error: { code: 'SLIDE_NOT_FOUND', details: { slideId: 's_missing' } } })
  })
})

describe('theme validation', () => {
  it('rejects an empty font stack', () => {
    expect(setTheme(base(), { bodyFontFamily: '  ' }).ok).toBe(false)
  })
})

/** A card whose single text field is one citation pill. */
function citedCard(referenceId: string) {
  const card = createUntitledCard()
  return {
    ...card,
    body: {
      ...card.body,
      subfields: [
        {
          ...card.body.subfields[0],
          doc: {
            type: 'doc' as const,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'citation', attrs: { referenceIds: [referenceId] } }],
              },
            ],
          },
        },
      ],
    },
  }
}

describe('reference pruning', () => {
  it('keeps a reference that is only cited from the sandbox', () => {
    const presentation = base()
    const added = unwrap(addReference(presentation, { title: 'Kilde', authors: '', url: '', year: '' }))
    const card = createUntitledCard()
    const withCitation = {
      ...card,
      body: {
        ...card.body,
        subfields: [
          {
            ...card.body.subfields[0],
            doc: {
              type: 'doc' as const,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'citation', attrs: { referenceIds: [added.reference.id] } }],
                },
              ],
            },
          },
        ],
      },
    }
    const parked = {
      ...added.presentation,
      sandbox: [{ id: 'sb1', content: withCitation, createdAt: '', note: '' }],
    }

    const pruned = unwrap(deleteUnusedReferences(parked))
    expect(pruned.references).toHaveLength(1)
  })

  it('still prunes a reference nothing cites', () => {
    const added = unwrap(addReference(base(), { title: 'Ubrukt', authors: '', url: '', year: '' }))
    expect(unwrap(deleteUnusedReferences(added.presentation)).references).toHaveLength(0)
  })

  it('prunes several unused references in one pass', () => {
    let presentation = base()
    for (const title of ['En', 'To', 'Tre']) {
      presentation = unwrap(addReference(presentation, { title, authors: '', url: '', year: '' }))
        .presentation
    }
    expect(presentation.references).toHaveLength(3)
    expect(unwrap(deleteUnusedReferences(presentation)).references).toEqual([])
  })

  it('keeps the cited ones and drops the rest, in one call', () => {
    // The mixed case is the one that matters: pruning is defined by what the
    // deck cites, not by insertion order or by how many there are.
    let presentation = base()
    const ids: string[] = []
    for (const title of ['Sitert', 'Ubrukt', 'Sitert i tittelen']) {
      const added = unwrap(addReference(presentation, { title, authors: '', url: '', year: '' }))
      presentation = added.presentation
      ids.push(added.reference.id)
    }
    const [cited, unused, citedInTitle] = ids

    // One citation in a zone's text, one in a slide title: both count.
    presentation = unwrap(
      setZoneContent(presentation, {
        slideId: presentation.slides[1].id,
        nodeId: contentAt(presentation, 1).root.id,
        content: citedCard(cited),
        replace: true,
      }),
    ).presentation
    presentation = unwrap(
      setSlideTitle(presentation, presentation.slides[1].id, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'citation', attrs: { referenceIds: [citedInTitle] } }],
          },
        ],
      }),
    )

    const pruned = unwrap(deleteUnusedReferences(presentation))
    expect(pruned.references.map((reference) => reference.id).sort()).toEqual(
      [cited, citedInTitle].sort(),
    )
    expect(pruned.references.map((reference) => reference.id)).not.toContain(unused)
  })

  it('is a no-op when there is nothing to prune, down to the object itself', () => {
    // Idempotence is what makes this safe to call on a schedule: a second run
    // must not rewrite the document, because a rewrite is a new revision and a
    // new `updatedAt` for a change nobody made.
    const presentation = base()
    const once = unwrap(deleteUnusedReferences(presentation))
    expect(once).toBe(presentation)

    const added = unwrap(addReference(presentation, { title: 'Ubrukt', authors: '', url: '', year: '' }))
    const pruned = unwrap(deleteUnusedReferences(added.presentation))
    expect(pruned.references).toEqual([])
    expect(unwrap(deleteUnusedReferences(pruned))).toBe(pruned)
  })
})

/**
 * Whole ratios.
 *
 * The commands are where the rule is made true rather than merely checked: a
 * caller may ask for any positive relative weights, and what gets stored is the
 * closest ratio the deck can be written in. Everything downstream — the schema,
 * `validateTree`, the agent API — can then simply insist on it.
 */
describe('zone ratios', () => {
  const splitWith = (weights: number[]): SplitNode => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const outcome = unwrap(
      splitLeaf(presentation, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights }),
    )
    return contentAt(outcome.presentation, 1).root as SplitNode
  }

  const whole = (weights: readonly number[]): boolean =>
    weights.every((weight) => Number.isInteger(weight) && weight >= 1 && weight <= 10)

  it('stores whole numbers for a wish written in decimals', () => {
    expect(splitWith([0.2, 0.3]).weights).toEqual([2, 3])
    expect(splitWith([0.25, 0.5, 0.25]).weights).toEqual([1, 2, 1])
    expect(whole(splitWith([1.6, 3.14159]).weights)).toBe(true)
    expect(splitWith([1.6, 3.14159]).weights).toEqual([1, 2])
  })

  it('gives proportionally equal wishes the same layout', () => {
    expect(splitWith([10, 20, 10]).weights).toEqual([1, 2, 1])
    expect(splitWith([0.5, 1, 0.5]).weights).toEqual([1, 2, 1])
    expect(splitWith([2, 4, 2]).weights).toEqual([1, 2, 1])
  })

  it('measures the layout it will store, not the one it was asked for', () => {
    const split = splitWith([1, 7.4])
    expect(split.weights).toEqual([1, 7])
  })

  it('still refuses a wish whose nearest whole ratio is too lopsided for the content', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const filled = unwrap(
      setZoneContent(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        content: createContainer(),
        fits: estimateFitChecker,
      }),
    ).presentation
    const result = splitLeaf(filled, {
      slideId: presentation.slides[1].id,
      nodeId: contentAt(filled, 1).root.id,
      axis: 'x',
      weights: [1, 40],
      contentTargetIndex: 0,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ZONE_TOO_SMALL')
  })

  it('writes whole ratios into a split that predates the rule, whatever was changed', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    // A split as an older version of Slaids could have stored it.
    const legacy = createSplit('x', [1.5, 2.5], [createLeaf(), createLeaf()])
    const stored: Presentation = {
      ...presentation,
      slides: [sectionAt(presentation, 0), { ...slide, root: { ...legacy, id: slide.root.id } }],
    }
    const outcome = unwrap(
      updateSplit(stored, { slideId: slide.id, nodeId: slide.root.id, axis: 'y' }),
    )
    const root = contentAt(outcome.presentation, 1).root as SplitNode
    expect(root.axis).toBe('y')
    expect(root.weights).toEqual([3, 5])
  })

  it('keeps whole ratios when a child is added or removed', () => {
    const presentation = base()
    const slide = contentAt(presentation, 1)
    const split = unwrap(
      splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        axis: 'x',
        weights: [1, 2],
      }),
    ).presentation
    const grown = unwrap(
      updateSplit(split, { slideId: slide.id, nodeId: slide.root.id, childCount: 3 }),
    ).presentation
    expect((contentAt(grown, 1).root as SplitNode).weights).toEqual([1, 2, 1])
    const shrunk = unwrap(
      updateSplit(grown, { slideId: slide.id, nodeId: slide.root.id, childCount: 2 }),
    ).presentation
    expect((contentAt(shrunk, 1).root as SplitNode).weights).toEqual([1, 2])
  })

  it('never commits anything but whole ratios in range', () => {
    let random = 12345
    const next = (): number => {
      random = (random * 1664525 + 1013904223) >>> 0
      return random / 0x100000000
    }
    let accepted = 0
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const count = 2 + Math.floor(next() * 3)
      const weights = Array.from({ length: count }, () => 0.05 + next() * 30)
      const presentation = base()
      const slide = contentAt(presentation, 1)
      const result = splitLeaf(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        axis: next() < 0.5 ? 'x' : 'y',
        weights,
      })
      // A wish can still be refused for being too lopsided to fit; what it can
      // never do is be accepted and stored as something other than a ratio.
      if (!result.ok || !result.value) continue
      accepted += 1
      const root = contentAt(result.value.presentation, 1).root as SplitNode
      expect(whole(root.weights), weights.join(':')).toBe(true)
      expect(root.weights).toHaveLength(count)
    }
    expect(accepted).toBeGreaterThan(20)
  })
})
