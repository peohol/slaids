import { describe, expect, it } from 'vitest'
import { G, MAX_ZONE_RATIO, SLIDE_HEIGHT, SLIDE_WIDTH } from './constants'
import { createContentOfKind, ZONE_CONTENT_KINDS } from './content'
import { minimumSizeForContent } from './contentSize'
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
import type { LayoutNode, ZoneContent } from './types'

/** Deterministic PRNG so a failure is always reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * `ratios` is what separates the two worlds the engine serves. A *committed*
 * layout carries whole ratios and nothing else, which is what the commands
 * produce and what `validateTree` insists on. A layout being *dragged* carries
 * whatever the pointer is currently asking for, and the engine has to measure
 * that just as exactly — the handle would jump on release otherwise. Both are
 * generated here for that reason.
 */
function randomTree(
  random: () => number,
  depth: number,
  ratios: 'whole' | 'free' = 'whole',
): LayoutNode {
  // Leaves carry content, and every kind of it including none at all: how small
  // a zone may be is a property of what is in it, so a generator that only made
  // empty leaves would be generating the one case with no minimum to check.
  if (depth === 0 || random() < 0.35) return createLeaf(randomContent(random))
  const count = 2 + Math.floor(random() * 4)
  const weights = Array.from({ length: count }, () =>
    ratios === 'whole' ? 1 + Math.floor(random() * MAX_ZONE_RATIO) : 0.25 + random() * 4,
  )
  const children = Array.from({ length: count }, () => randomTree(random, depth - 1, ratios))
  return createSplit(random() < 0.5 ? 'x' : 'y', weights, children)
}

/** Any content kind, or none — `null` is a zone nobody has filled yet. */
function randomContent(random: () => number): ZoneContent | null {
  const choice = Math.floor(random() * (ZONE_CONTENT_KINDS.length + 1))
  const kind = ZONE_CONTENT_KINDS[choice]
  return kind ? createContentOfKind(kind) : null
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

  it('keeps the gap exact for the arbitrary ratios a drag passes through', () => {
    let checked = 0
    for (const seed of seeds) {
      const random = makeRandom(seed)
      const slide = createSlide({ hasTitle: random() < 0.5, root: randomTree(random, 3, 'free') })
      const geometry = computeSlideGeometry(slide)
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

  it('never leaves a zone too small for its own content when the subtree reports it fits', () => {
    for (const seed of seeds) {
      const random = makeRandom(seed)
      const root = randomTree(random, 2)
      const slide = createSlide({ hasTitle: true, root })
      if (!subtreeFitsInRect(root, computeSlideGeometry(slide).mainRect)) continue
      const geometry = computeSlideGeometry(slide)
      const visit = (node: LayoutNode): void => {
        const rect = geometry.rects.get(node.id)
        if (!rect) return
        if (node.kind === 'leaf') {
          // The minimum is the content's, so an empty zone and deliberate air
          // clear a bar of zero — which is the whole point of the rule, and
          // exactly the case a single global minimum got wrong.
          const min = minimumSizeForContent(node.content)
          expect(rect.width, `seed ${seed}`).toBeGreaterThan(min.width - 1e-6)
          expect(rect.height, `seed ${seed}`).toBeGreaterThan(min.height - 1e-6)
          return
        }
        for (const child of node.children) visit(child)
      }
      visit(root)
    }
  })
})
