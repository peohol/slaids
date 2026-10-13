import { describe, expect, it } from 'vitest'
import { createPresentation } from '../presentation'
import { collectNodes, findNode, findParent } from '../layout'
import {
  bodyOf,
  containerWithDoc,
  createImage,
  createTitledCard,
  withDepositIndex,
  withImagePanel,
} from '../content'
import { estimateFitChecker } from '../fit'
import { paragraphDoc } from '../richdoc'
import { MAX_SPLIT_CHILDREN } from '../constants'
import type { LayoutNode, Presentation, SplitNode, ZoneContent } from '../types'
import { duplicateLayoutNode, setZoneContent, splitLeaf } from './index'
import { contentAt } from '../testDecks'

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

/** A deck whose content slide is split into `weights.length` zones along `axis`. */
function splitDeck(axis: 'x' | 'y', weights: number[]): { deck: Presentation; slideId: string } {
  const deck = createPresentation({ title: 'Duplisering' })
  const slide = contentAt(deck, 1)
  const split = unwrap(
    splitLeaf(deck, { slideId: slide.id, nodeId: slide.root.id, axis, weights }),
  ).presentation
  return { deck: split, slideId: slide.id }
}

function rootOf(deck: Presentation): SplitNode {
  const root = contentAt(deck, 1).root
  if (root.kind !== 'split') throw new Error('roten skulle vært delt')
  return root
}

function place(deck: Presentation, slideId: string, nodeId: string, content: ZoneContent): Presentation {
  return unwrap(setZoneContent(deck, { slideId, nodeId, content, fits: estimateFitChecker }))
    .presentation
}

/** Every id the copy is addressable by: its nodes, its content and its subfields. */
function idsOf(node: LayoutNode): string[] {
  return collectNodes(node).flatMap((each) => {
    if (each.kind !== 'leaf' || !each.content) return [each.id]
    const body = bodyOf(each.content)
    return [each.id, each.content.id, ...(body?.subfields.map((field) => field.id) ?? [])]
  })
}

describe('duplicateLayoutNode', () => {
  it('puts a copy right after the zone, at the same ratio', () => {
    const { deck, slideId } = splitDeck('x', [2, 3])
    const original = rootOf(deck).children[0]
    const filled = place(deck, slideId, original.id, createTitledCard('Kort'))

    const next = unwrap(duplicateLayoutNode(filled, { slideId, nodeId: original.id })).presentation
    const root = rootOf(next)
    expect(root.weights).toEqual([2, 2, 3])
    expect(root.children[0].id).toBe(original.id)
    const copy = root.children[1]
    expect(copy.kind).toBe('leaf')
    if (copy.kind !== 'leaf' || !copy.content) throw new Error('kopien skulle hatt innhold')
    expect(copy.content.kind).toBe('titled-card')
  })

  it('gives every node, content and subfield in the copy an id of its own', () => {
    const { deck, slideId } = splitDeck('y', [1, 1])
    const inner = unwrap(
      splitLeaf(deck, { slideId, nodeId: rootOf(deck).children[0].id, axis: 'x', weights: [1, 3] }),
    ).presentation
    const target = rootOf(inner).children[0] as SplitNode
    let filled = inner
    for (const child of target.children) {
      filled = place(filled, slideId, child.id, containerWithDoc(paragraphDoc('Tekst')))
    }

    const next = unwrap(duplicateLayoutNode(filled, { slideId, nodeId: target.id })).presentation
    const original = findNode(contentAt(next, 1).root, target.id)
    const copy = rootOf(next).children[1]
    if (!original) throw new Error('originalen forsvant')
    // The same shape …
    expect(copy.kind).toBe('split')
    if (copy.kind !== 'split' || original.kind !== 'split') return
    expect(copy.axis).toBe(original.axis)
    expect(copy.weights).toEqual(original.weights)
    // … and nothing in it that the original is also addressable by.
    const before = new Set(idsOf(original))
    for (const id of idsOf(copy)) expect(before.has(id)).toBe(false)
    // The tree as a whole has no duplicate ids at all.
    const all = idsOf(contentAt(next, 1).root)
    expect(new Set(all).size).toBe(all.length)
  })

  it('refuses the root, which has no split to sit in', () => {
    const deck = createPresentation({ title: 'Rot' })
    const slide = contentAt(deck, 1)
    const result = duplicateLayoutNode(deck, { slideId: slide.id, nodeId: slide.root.id })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENT')
  })

  it('refuses to give a split more children than it may have', () => {
    const { deck, slideId } = splitDeck('y', Array.from({ length: MAX_SPLIT_CHILDREN }, () => 1))
    const result = duplicateLayoutNode(deck, { slideId, nodeId: rootOf(deck).children[0].id })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_CHILD_COUNT')
  })

  it('stops once the siblings would be smaller than what they hold', () => {
    // Cards need the width a line of text is readable in, and ten of them side
    // by side do not get it — so somewhere before the limit, a copy has nowhere
    // to go and the zones are what refuses it.
    const { deck, slideId } = splitDeck('x', [1, 1])
    let current = place(deck, slideId, rootOf(deck).children[0].id, createTitledCard('Kort'))
    current = place(current, slideId, rootOf(current).children[1].id, createTitledCard('Kort'))
    let refusal: string | null = null
    while (refusal === null) {
      const result = duplicateLayoutNode(current, { slideId, nodeId: rootOf(current).children[0].id })
      if (!result.ok) refusal = result.error.code
      else current = result.value.presentation
    }
    expect(refusal).toBe('ZONE_TOO_SMALL')
    expect(rootOf(current).children.length).toBeLessThan(MAX_SPLIT_CHILDREN)
  })

  it('refuses a copy that would leave text hidden, and changes nothing', () => {
    const { deck, slideId } = splitDeck('y', [1, 1])
    const first = rootOf(deck).children[0].id
    // As much text as half the slide holds: a third of it does not.
    let fitting: Presentation | null = null
    for (let lines = 1; lines < 60; lines += 1) {
      const text = Array.from({ length: lines }, (_, index) => `Linje ${index + 1}`).join(' ')
      const result = setZoneContent(deck, {
        slideId,
        nodeId: first,
        content: containerWithDoc(paragraphDoc(text.repeat(4))),
        fits: estimateFitChecker,
      })
      if (!result.ok) break
      fitting = result.value.presentation
    }
    if (!fitting) throw new Error('ingenting fikk plass')
    const result = duplicateLayoutNode(fitting, { slideId, nodeId: first, fits: estimateFitChecker })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
  })

  it('leaves the copy unnumbered when the original is a numbered picture zone', () => {
    const { deck, slideId } = splitDeck('x', [1, 1])
    const nodeId = rootOf(deck).children[0].id
    const picture = createImage()
    const content = withImagePanel(picture, withDepositIndex(picture.image, 1))
    const filled = place(deck, slideId, nodeId, content)
    const next = unwrap(duplicateLayoutNode(filled, { slideId, nodeId })).presentation
    const copy = rootOf(next).children[1]
    expect(findParent(contentAt(next, 1).root, copy.id)?.id).toBe(rootOf(next).id)
    if (copy.kind !== 'leaf' || copy.content?.kind !== 'image') throw new Error('kopien skulle vært et bilde')
    expect(copy.content.image.depositIndex ?? null).toBeNull()
  })
})
