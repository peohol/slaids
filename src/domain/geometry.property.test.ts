import { describe, expect, it } from 'vitest'
import { G, MIN_ZONE_HEIGHT, MIN_ZONE_WIDTH, SLIDE_HEIGHT, SLIDE_WIDTH } from './constants'
import {
  computeSlideGeometry,
  measureSiblingGaps,
  minimumSizeFor,
  rectBottom,
  rectContainsRect,
  rectRight,
  subtreeFitsInRect,
  validateSlideGeometry,
} from './geometry'
import { createLeaf, createSplit, normalizeTree, validateTree } from './layout'
import { createSlide } from './presentation'
import type { LayoutNode } from './types'

/** Deterministic PRNG so a failure is always reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomTree(random: () => number, depth: number): LayoutNode {
  if (depth === 0 || random() < 0.35) return createLeaf()
  const count = 2 + Math.floor(random() * 4)
  const weights = Array.from({ length: count }, () => 0.25 + random() * 4)
  const children = Array.from({ length: count }, () => randomTree(random, depth - 1))
  return createSplit(random() < 0.5 ? 'x' : 'y', weights, children)
}

describe('geometry invariants hold for arbitrary trees', () => {
  const seeds = Array.from({ length: 60 }, (_, index) => index * 7919 + 13)

  it('keeps every sibling gap exactly G for every layout the commands allow', () => {
    let checked = 0
    for (const seed of seeds) {
      const random = makeRandom(seed)
      const slide = createSlide({ hasTitle: random() < 0.5, root: randomTree(random, 3) })
      const geometry = computeSlideGeometry(slide)
      // Layouts that fail minimum-size validation cannot be created through the
      // commands; there the engine deliberately collapses the gap instead of
      // letting a child escape its parent.
      if (!subtreeFitsInRect(slide.root, geometry.mainRect)) continue
      checked += 1
      for (const gap of measureSiblingGaps(slide.root, geometry.rects)) {
        expect(Math.abs(gap - G), `seed ${seed}`).toBeLessThan(1e-6)
      }
    }
    expect(checked).toBeGreaterThan(5)
  })

  it('never lets a node escape its parent or the slide', () => {
    const slideRect = { x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT }
    for (const seed of seeds) {
      const random = makeRandom(seed)
      const slide = createSlide({ hasTitle: random() < 0.5, root: randomTree(random, 3) })
      const geometry = computeSlideGeometry(slide)

      const visit = (node: LayoutNode): void => {
        const area = geometry.rects.get(node.id)
        expect(area, `seed ${seed}`).toBeDefined()
        if (!area) return
        expect(rectContainsRect(slideRect, area), `seed ${seed}`).toBe(true)
        if (node.kind !== 'split') return
        for (const child of node.children) {
          const childRect = geometry.rects.get(child.id)
          expect(childRect).toBeDefined()
          if (childRect) expect(rectContainsRect(area, childRect), `seed ${seed}`).toBe(true)
          visit(child)
        }
      }
      visit(slide.root)
    }
  })

  it('exactly fills the parent along the split axis', () => {
    for (const seed of seeds) {
      const random = makeRandom(seed)
      const slide = createSlide({ hasTitle: false, root: randomTree(random, 3) })
      const geometry = computeSlideGeometry(slide)

      const visit = (node: LayoutNode): void => {
        if (node.kind !== 'split') return
        const parent = geometry.rects.get(node.id)
        if (!parent) return
        const first = geometry.rects.get(node.children[0].id)
        const last = geometry.rects.get(node.children[node.children.length - 1].id)
        expect(first).toBeDefined()
        expect(last).toBeDefined()
        if (!first || !last) return
        if (node.axis === 'x') {
          expect(Math.abs(first.x - parent.x), `seed ${seed}`).toBeLessThan(1e-6)
          expect(Math.abs(rectRight(last) - rectRight(parent)), `seed ${seed}`).toBeLessThan(1e-6)
        } else {
          expect(Math.abs(first.y - parent.y), `seed ${seed}`).toBeLessThan(1e-6)
          expect(Math.abs(rectBottom(last) - rectBottom(parent)), `seed ${seed}`).toBeLessThan(1e-6)
        }
        for (const child of node.children) visit(child)
      }
      visit(slide.root)
    }
  })

  it('agrees with minimumSizeFor about whether a subtree fits', () => {
    for (const seed of seeds) {
      const random = makeRandom(seed)
      const root = randomTree(random, 3)
      const min = minimumSizeFor(root)
      const slide = createSlide({ hasTitle: false, root })
      const geometry = computeSlideGeometry(slide)
      const fits = subtreeFitsInRect(root, geometry.mainRect)
      const violations = validateSlideGeometry(slide).filter(
        (violation) => violation.kind === 'below-minimum',
      )
      if (fits) {
        expect(violations, `seed ${seed} min ${JSON.stringify(min)}`).toEqual([])
      }
    }
  })

  it('produces trees that satisfy the structural invariants after normalization', () => {
    for (const seed of seeds) {
      const random = makeRandom(seed)
      const root = normalizeTree(randomTree(random, 3))
      expect(validateTree(root), `seed ${seed}`).toEqual([])
    }
  })

  it('never produces a leaf smaller than the minimum when the subtree reports it fits', () => {
    for (const seed of seeds) {
      const random = makeRandom(seed)
      const root = randomTree(random, 2)
      const slide = createSlide({ hasTitle: true, root })
      if (!subtreeFitsInRect(root, computeSlideGeometry(slide).mainRect)) continue
      const geometry = computeSlideGeometry(slide)
      const visit = (node: LayoutNode): void => {
        const rect = geometry.rects.get(node.id)
        if (!rect) return
        expect(rect.width, `seed ${seed}`).toBeGreaterThan(MIN_ZONE_WIDTH - 1e-6)
        expect(rect.height, `seed ${seed}`).toBeGreaterThan(MIN_ZONE_HEIGHT - 1e-6)
        if (node.kind === 'split') for (const child of node.children) visit(child)
      }
      visit(root)
    }
  })
})
