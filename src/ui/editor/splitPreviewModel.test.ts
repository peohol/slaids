/**
 * The split preview's model: which rects are the zones being edited, which
 * lines are kept structure, and how the picture is scaled.
 *
 * The rules under test hold for any proposal, so they are checked over several
 * trees rather than the one example that motivated them: the direct children
 * are exactly the zones, in field order, with the engine's own rects; every
 * deeper boundary is one divider down the middle of a real gap and none is
 * drawn at the edited level; each kept leaf is named by its path from the
 * target; and the scale contains the target in both directions.
 */

import { describe, expect, it } from 'vitest'
import { computeLayoutRects } from '../../domain/geometry'
import { collectLeaves, createLeaf, createSplit } from '../../domain/layout'
import type { LayoutNode, SplitNode } from '../../domain/types'
import { containScale, splitPreviewModel } from './splitPreviewModel'

const GAP = 48

/** The user's example: two zones over each other, the lower one in three side by side. */
function nested23(): SplitNode {
  return createSplit('y', [1, 1], [createLeaf(), createSplit('x', [1, 1, 1], [createLeaf(), createLeaf(), createLeaf()])])
}

function deep(): SplitNode {
  return createSplit('x', [2, 1, 3], [
    createSplit('y', [1, 4], [createLeaf(), createSplit('x', [1, 1], [createLeaf(), createLeaf()])]),
    createLeaf(),
    createSplit('y', [1, 1, 1, 1], [createLeaf(), createLeaf(), createLeaf(), createLeaf()]),
  ])
}

function flat(count: number): SplitNode {
  return createSplit('x', Array.from({ length: count }, (_, i) => (i % 10) + 1), Array.from({ length: count }, () => createLeaf()))
}

/** Splits strictly below the direct children, with their depth from the target. */
function descendantSplits(proposal: SplitNode): { node: SplitNode; depth: number }[] {
  const found: { node: SplitNode; depth: number }[] = []
  const visit = (node: LayoutNode, depth: number): void => {
    if (node.kind !== 'split') return
    if (depth >= 1) found.push({ node, depth })
    node.children.forEach((child) => visit(child, depth + 1))
  }
  visit(proposal, 0)
  return found
}

const SIZES = [
  { width: 1504, height: 679 },
  { width: 100, height: 1000 },
  { width: 1000, height: 100 },
  { width: 132, height: 679 },
]

const TREES: [string, () => SplitNode][] = [
  ['2 + 3', nested23],
  ['several levels', deep],
  ['ten flat zones', () => flat(10)],
]

describe('splitPreviewModel', () => {
  for (const [name, make] of TREES) {
    for (const size of SIZES) {
      describe(`${name} in ${size.width}×${size.height}`, () => {
        const proposal = make()
        const model = splitPreviewModel(proposal, size, GAP)
        const rects = computeLayoutRects(proposal, { x: 0, y: 0, ...size }, GAP)

        it('makes the direct children, and only they, the numbered zones', () => {
          expect(model.zones.map((zone) => zone.label)).toEqual(
            proposal.children.map((_, index) => String(index + 1)),
          )
          proposal.children.forEach((child, index) => {
            expect(model.zones[index].rect).toEqual(rects.get(child.id))
            expect(model.zones[index].keptZones).toBe(
              child.kind === 'split' ? collectLeaves(child).length : 0,
            )
          })
        })

        it('draws one divider per kept boundary, down the middle of its gap', () => {
          const splits = descendantSplits(proposal)
          expect(model.dividers).toHaveLength(
            splits.reduce((total, { node }) => total + node.children.length - 1, 0),
          )
          let next = 0
          for (const { node, depth } of splits) {
            const area = rects.get(node.id)!
            for (let i = 1; i < node.children.length; i += 1) {
              const before = rects.get(node.children[i - 1].id)!
              const after = rects.get(node.children[i].id)!
              const match = model.dividers.find((divider) =>
                node.axis === 'x'
                  ? divider.x1 === divider.x2 &&
                    Math.abs(divider.x1 - before.x - before.width - (after.x - before.x - before.width) / 2) < 1e-9 &&
                    divider.y1 === area.y &&
                    divider.y2 === area.y + area.height
                  : divider.y1 === divider.y2 &&
                    Math.abs(divider.y1 - before.y - before.height - (after.y - before.y - before.height) / 2) < 1e-9 &&
                    divider.x1 === area.x &&
                    divider.x2 === area.x + area.width,
              )
              expect(match, `divider ${i} of a split at depth ${depth}`).toBeDefined()
              expect(match?.depth).toBe(depth + 1)
              next += 1
            }
          }
          expect(next).toBe(model.dividers.length)
          // None at the level being edited: those boundaries are the zones' own edges.
          expect(model.dividers.every((divider) => divider.depth >= 2)).toBe(true)
        })

        it('names every kept leaf by its path from the target', () => {
          const kept = proposal.children.flatMap((child, index) =>
            child.kind === 'split' ? collectLeaves(child).map((leaf) => ({ leaf, top: index + 1 })) : [],
          )
          expect(model.context).toHaveLength(kept.length)
          for (const { leaf, top } of kept) {
            const rect = rects.get(leaf.id)
            const entry = model.context.find(
              (zone) =>
                zone.rect.x === rect?.x &&
                zone.rect.y === rect.y &&
                zone.rect.width === rect.width &&
                zone.rect.height === rect.height,
            )
            expect(entry?.label.startsWith(`${top}.`)).toBe(true)
            expect(entry?.depth).toBe(entry?.label.split('.').length)
          }
          expect(new Set(model.context.map((zone) => zone.label)).size).toBe(model.context.length)
        })
      })
    }
  }

  it('labels the example as 1, 2 and 2.1–2.3, with two dashed boundaries in zone 2', () => {
    const model = splitPreviewModel(nested23(), { width: 1504, height: 679 }, GAP)
    expect(model.zones.map((zone) => [zone.label, zone.keptZones])).toEqual([
      ['1', 0],
      ['2', 3],
    ])
    expect(model.context.map((zone) => zone.label)).toEqual(['2.1', '2.2', '2.3'])
    expect(model.dividers.map((divider) => divider.depth)).toEqual([2, 2])
  })

  it('marks the zones the minimum-size check refused, and still draws them', () => {
    const proposal = flat(3)
    const model = splitPreviewModel(proposal, { width: 900, height: 400 }, GAP, [0, 2])
    expect(model.zones.map((zone) => zone.tooSmall)).toEqual([true, false, true])
    expect(model.zones.every((zone) => zone.rect.width > 0)).toBe(true)
  })
})

describe('containScale', () => {
  const boxes = [
    { width: 560, height: 280 },
    { width: 360, height: 120 },
    { width: 300, height: 300 },
  ]
  for (const box of boxes) {
    for (const content of SIZES) {
      it(`fits ${content.width}×${content.height} inside ${box.width}×${box.height} without distortion`, () => {
        const scale = containScale(box, content)
        expect(content.width * scale).toBeLessThanOrEqual(box.width + 1e-9)
        expect(content.height * scale).toBeLessThanOrEqual(box.height + 1e-9)
        // Contain, not shrink-to-nothing: one of the two directions is filled.
        const fills =
          Math.abs(content.width * scale - box.width) < 1e-9 ||
          Math.abs(content.height * scale - box.height) < 1e-9
        expect(fills).toBe(true)
      })
    }
  }

  it('draws nothing until the box has been measured', () => {
    expect(containScale({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(0)
    expect(containScale({ width: 300, height: 200 }, { width: 0, height: 100 })).toBe(0)
  })
})
