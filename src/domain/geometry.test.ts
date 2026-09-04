import { describe, expect, it } from 'vitest'
import {
  COVER_PILL_PADDING_X_EM,
  COVER_PILL_PADDING_Y_EM,
  COVER_SUBTITLE_FONT_SIZE,
  G,
  MIN_ZONE_HEIGHT,
  MIN_ZONE_WIDTH,
  SLIDE_HEIGHT,
  SLIDE_INSET,
  SLIDE_WIDTH,
  TITLE_FONT_SIZE,
  TITLE_LINE_HEIGHT,
  TITLE_ZONE_HEIGHT,
} from './constants'
import {
  computeCoverGeometry,
  computeLayoutRects,
  computeMainRect,
  computeSlideGeometry,
  computeTitleRect,
  fitScale,
  hitTestLayout,
  measureSiblingGaps,
  minimumSizeFor,
  previewSplit,
  rectBottom,
  rectContainsRect,
  rectRight,
  areWeightsValid,
  splitRect,
  subtreeFitsInRect,
  validateSlideGeometry,
  viewportToSlide,
} from './geometry'
import { createLeaf, createSplit } from './layout'
import { createSlide } from './presentation'
import type { LayoutNode, Rect } from './types'

const EPS = 1e-9

function leaf(): LayoutNode {
  return createLeaf()
}

describe('weights that are finite one by one but not together', () => {
  // Individually finite is a weaker property than finite in total, and every
  // share is a division by the total. A `NaN` rect is the worst possible
  // outcome because it fails every comparison: the fit guard reads it as "no
  // overflow", stores it, and the stored layout has no geometry at all.
  it('rejects a weight array whose sum overflows to Infinity', () => {
    expect(areWeightsValid([1e308, 1e308])).toBe(false)
    expect(areWeightsValid([Number.MAX_VALUE, Number.MAX_VALUE, 1])).toBe(false)
    // Large is still fine. It is the sum that has to land somewhere.
    expect(areWeightsValid([1e307, 1e307])).toBe(true)
    expect(areWeightsValid([1, 1e6])).toBe(true)
  })

  it('keeps every rectangle a number for weights that are merely huge', () => {
    // The other way the arithmetic overflows: `usable * cumulative` is
    // `Infinity` long before the sum is, so the fraction has to come first.
    const source: Rect = { x: 0, y: 0, width: 1000, height: 400 }
    for (const weights of [[1e307, 1e307], [1, Number.MAX_VALUE / 4], [1e-6, 1e6]]) {
      const rects = splitRect(source, 'x', weights, G)
      for (const rect of rects) {
        for (const value of [rect.x, rect.y, rect.width, rect.height]) {
          expect(Number.isFinite(value), JSON.stringify({ weights, rect })).toBe(true)
        }
      }
      // And they still fill the parent exactly, edge to edge.
      expect(rects[0].x).toBeCloseTo(source.x, 9)
      expect(rectRight(rects[rects.length - 1])).toBeCloseTo(rectRight(source), 9)
    }
  })

  it('asks for the same minimum however the same ratio is written', () => {
    // `childSize * total` is the third place the product overflows before the
    // sum does. An infinite minimum would refuse a 1:1 split for being too
    // small, which is the opposite of what the minimum is for.
    const even = minimumSizeFor(createSplit('x', [1, 1], [leaf(), leaf()]))
    for (const weights of [[1e307, 1e307], [1e150, 1e150]]) {
      const huge = minimumSizeFor(createSplit('x', weights, [leaf(), leaf()]))
      expect(huge.width, JSON.stringify(weights)).toBeCloseTo(even.width, 6)
      expect(huge.height, JSON.stringify(weights)).toBeCloseTo(even.height, 6)
    }

    const uneven = minimumSizeFor(createSplit('y', [3, 1], [leaf(), leaf()]))
    const unevenLarge = minimumSizeFor(
      createSplit('y', [3e307 / 4, 1e307 / 4], [leaf(), leaf()]),
    )
    expect(unevenLarge.height).toBeCloseTo(uneven.height, 6)
  })
})

describe('splitRect', () => {
  it('places exactly one gap between adjacent children', () => {
    const source: Rect = { x: 0, y: 0, width: 1000, height: 400 }
    const rects = splitRect(source, 'x', [1, 1, 1], G)
    expect(rects).toHaveLength(3)
    expect(rects[1].x - rectRight(rects[0])).toBeCloseTo(G, 9)
    expect(rects[2].x - rectRight(rects[1])).toBeCloseTo(G, 9)
  })

  it('distributes the usable length by weight', () => {
    const rects = splitRect({ x: 0, y: 0, width: 1000, height: 100 }, 'x', [2, 3], 0)
    expect(rects[0].width).toBeCloseTo(400, 9)
    expect(rects[1].width).toBeCloseTo(600, 9)
  })

  it('subtracts gaps before distributing by weight', () => {
    const rects = splitRect({ x: 0, y: 0, width: 1024, height: 100 }, 'x', [1, 1], G)
    const usable = 1024 - G
    expect(rects[0].width).toBeCloseTo(usable / 2, 9)
    expect(rects[1].width).toBeCloseTo(usable / 2, 9)
  })

  it('ends the final child exactly on the parent edge', () => {
    const source: Rect = { x: 13.7, y: 4.25, width: 999.99, height: 501.5 }
    for (const weights of [[1, 1, 1], [1, 2, 3, 4, 5, 6, 7], [0.1, 0.7, 3.3]]) {
      const rects = splitRect(source, 'x', weights, G)
      expect(rectRight(rects[rects.length - 1])).toBeCloseTo(rectRight(source), 9)
      expect(rects[0].x).toBeCloseTo(source.x, 9)
    }
  })

  it('does not accumulate floating point drift across ten children', () => {
    const weights = [0.3, 1.1, 2.7, 0.9, 1.3, 4.1, 0.7, 2.2, 1.9, 3.3]
    const rects = splitRect({ x: 0, y: 0, width: 1552, height: 756 }, 'y', weights, G)
    expect(rectBottom(rects[9])).toBeCloseTo(756, 9)
    for (let i = 0; i < 9; i += 1) {
      expect(rects[i + 1].y - rectBottom(rects[i])).toBeCloseTo(G, 9)
    }
  })

  it('treats proportionally equivalent weights identically', () => {
    const source: Rect = { x: 0, y: 0, width: 800, height: 600 }
    const a = splitRect(source, 'y', [1, 2], G)
    const b = splitRect(source, 'y', [0.5, 1], G)
    const c = splitRect(source, 'y', [2, 4], G)
    expect(a[0].height).toBeCloseTo(b[0].height, 9)
    expect(a[0].height).toBeCloseTo(c[0].height, 9)
  })

  it('rejects invalid weights', () => {
    expect(() => splitRect({ x: 0, y: 0, width: 10, height: 10 }, 'x', [1, 0], G)).toThrow()
    expect(() => splitRect({ x: 0, y: 0, width: 10, height: 10 }, 'x', [1, -2], G)).toThrow()
    expect(() => splitRect({ x: 0, y: 0, width: 10, height: 10 }, 'x', [1, NaN], G)).toThrow()
  })

  it('keeps the cross axis untouched', () => {
    const rects = splitRect({ x: 5, y: 7, width: 100, height: 50 }, 'x', [1, 1], G)
    for (const r of rects) {
      expect(r.y).toBe(7)
      expect(r.height).toBe(50)
    }
  })
})

describe('slide framing', () => {
  it('insets content by exactly G on all sides', () => {
    const main = computeMainRect(false)
    expect(main.x).toBe(SLIDE_INSET)
    expect(main.y).toBe(SLIDE_INSET)
    expect(rectRight(main)).toBe(SLIDE_WIDTH - SLIDE_INSET)
    expect(rectBottom(main)).toBe(SLIDE_HEIGHT - SLIDE_INSET)
  })

  it('separates the title zone from the main zone by exactly G', () => {
    const title = computeTitleRect(true)
    const main = computeMainRect(true)
    expect(title).not.toBeNull()
    expect(main.y - rectBottom(title as Rect)).toBe(G)
  })

  it('gives the main zone the whole content area when there is no title', () => {
    const withTitle = computeMainRect(true)
    const withoutTitle = computeMainRect(false)
    expect(withoutTitle.height - withTitle.height).toBe(TITLE_ZONE_HEIGHT + G)
    expect(withoutTitle.width).toBe(withTitle.width)
  })
})

describe('computeLayoutRects', () => {
  it('maps every node in the tree', () => {
    const a = leaf()
    const b = leaf()
    const c = leaf()
    const inner = createSplit('y', [1, 1], [b, c])
    const root = createSplit('x', [1, 1], [a, inner])
    const rects = computeLayoutRects(root, { x: 0, y: 0, width: 1000, height: 500 }, G)
    expect(rects.size).toBe(5)
    for (const node of [root, a, b, c, inner]) expect(rects.has(node.id)).toBe(true)
  })

  it('never lets a child escape its parent', () => {
    const grandChildren = [leaf(), leaf(), leaf()]
    const inner = createSplit('y', [1, 2, 3], grandChildren)
    const root = createSplit('x', [3, 2], [inner, leaf()])
    const area = { x: 24, y: 120, width: 1552, height: 756 }
    const rects = computeLayoutRects(root, area, G)
    for (const child of grandChildren) {
      expect(rectContainsRect(rects.get(inner.id) as Rect, rects.get(child.id) as Rect)).toBe(true)
    }
    expect(rectContainsRect(area, rects.get(inner.id) as Rect)).toBe(true)
  })

  it('never introduces extra gap through nesting', () => {
    const deepest = createSplit('x', [1, 1], [leaf(), leaf()])
    const middle = createSplit('y', [1, 1], [deepest, leaf()])
    const root = createSplit('x', [1, 1], [middle, leaf()])
    const rects = computeLayoutRects(root, { x: 24, y: 24, width: 1552, height: 852 }, G)
    const gaps = measureSiblingGaps(root, rects)
    expect(gaps).toHaveLength(3)
    for (const gap of gaps) expect(gap).toBeCloseTo(G, 9)
  })
})

describe('minimum size analysis', () => {
  it('reports the minimum zone size for a leaf', () => {
    expect(minimumSizeFor(leaf())).toEqual({ width: MIN_ZONE_WIDTH, height: MIN_ZONE_HEIGHT })
  })

  it('accounts for gaps between children', () => {
    const root = createSplit('x', [1, 1], [leaf(), leaf()])
    expect(minimumSizeFor(root).width).toBeCloseTo(MIN_ZONE_WIDTH * 2 + G, 9)
    expect(minimumSizeFor(root).height).toBeCloseTo(MIN_ZONE_HEIGHT, 9)
  })

  it('lets the most constrained weighted child bind the minimum', () => {
    const root = createSplit('x', [1, 4], [leaf(), leaf()])
    // The narrow child needs MIN_ZONE_WIDTH at weight 1 of 5, so usable >= 5 * MIN.
    expect(minimumSizeFor(root).width).toBeCloseTo(MIN_ZONE_WIDTH * 5 + G, 9)
  })

  it('accumulates through nesting', () => {
    const inner = createSplit('y', [1, 1], [leaf(), leaf()])
    const root = createSplit('x', [1, 1], [inner, leaf()])
    expect(minimumSizeFor(root).height).toBeCloseTo(MIN_ZONE_HEIGHT * 2 + G, 9)
    expect(minimumSizeFor(root).width).toBeCloseTo(MIN_ZONE_WIDTH * 2 + G, 9)
  })

  it('decides whether a subtree fits an area', () => {
    const root = createSplit('x', [1, 1], [leaf(), leaf()])
    const min = minimumSizeFor(root)
    expect(subtreeFitsInRect(root, { x: 0, y: 0, ...min })).toBe(true)
    expect(
      subtreeFitsInRect(root, { x: 0, y: 0, width: min.width - 1, height: min.height }),
    ).toBe(false)
  })
})

describe('previewSplit', () => {
  it('accepts a split that leaves every child usable', () => {
    const preview = previewSplit({ x: 0, y: 0, width: 1000, height: 500 }, 'x', [1, 1])
    expect(preview.valid).toBe(true)
    expect(preview.tooSmall).toEqual([])
  })

  it('flags the children that would be below the minimum', () => {
    const preview = previewSplit({ x: 0, y: 0, width: 600, height: 400 }, 'x', [1, 20])
    expect(preview.valid).toBe(false)
    expect(preview.tooSmall).toContain(0)
  })

  it('validates nested subtrees, not just bare minimums', () => {
    const nested = createSplit('x', [1, 1], [leaf(), leaf()])
    // Each child gets (700 - G) / 2 = 338, above the bare 180 minimum but below
    // the 180 * 2 + G = 384 that the nested split needs.
    const area = { x: 0, y: 0, width: 700, height: 400 }
    const bare = previewSplit(area, 'x', [1, 1])
    const withSubtree = previewSplit(area, 'x', [1, 1], {}, [nested, null])
    expect(bare.valid).toBe(true)
    expect(withSubtree.valid).toBe(false)
  })

  it('rejects invalid weights without throwing', () => {
    const preview = previewSplit({ x: 0, y: 0, width: 900, height: 400 }, 'x', [1, 0])
    expect(preview.valid).toBe(false)
  })
})

describe('hit-testing', () => {
  const a = leaf()
  const b = leaf()
  const root = createSplit('x', [1, 1], [a, b])
  const area = { x: 0, y: 0, width: 1000, height: 500 }
  const rects = computeLayoutRects(root, area, G)

  it('picks the deepest node under the point', () => {
    expect(hitTestLayout(root, rects, 100, 100)).toBe(a.id)
    expect(hitTestLayout(root, rects, 900, 100)).toBe(b.id)
  })

  it('selects the parent when the point is in the gap', () => {
    const midpoint = rectRight(rects.get(a.id) as Rect) + G / 2
    expect(hitTestLayout(root, rects, midpoint, 250)).toBe(root.id)
  })

  it('returns null outside the root rect', () => {
    expect(hitTestLayout(root, rects, -10, 250)).toBeNull()
    expect(hitTestLayout(root, rects, 1200, 250)).toBeNull()
  })
})

describe('viewport conversion', () => {
  it('converts client coordinates into slide coordinates', () => {
    const point = viewportToSlide(500, 300, { left: 100, top: 50 }, 0.5)
    expect(point).toEqual({ x: 800, y: 500 })
  })

  it('scales uniformly to the smaller axis', () => {
    expect(fitScale(1600, 900)).toBeCloseTo(1, 9)
    expect(fitScale(800, 900)).toBeCloseTo(0.5, 9)
    expect(fitScale(1600, 450)).toBeCloseTo(0.5, 9)
    expect(fitScale(0, 100)).toBe(0)
  })
})

describe('validateSlideGeometry', () => {
  it('accepts a reasonable slide', () => {
    const slide = createSlide({ hasTitle: true, root: createSplit('x', [2, 3], [leaf(), leaf()]) })
    expect(validateSlideGeometry(slide)).toEqual([])
  })

  it('reports leaves below the minimum size', () => {
    const slide = createSlide({
      hasTitle: true,
      root: createSplit('x', Array.from({ length: 10 }, () => 1), Array.from({ length: 10 }, leaf)),
    })
    const violations = validateSlideGeometry(slide)
    expect(violations.some((violation) => violation.kind === 'below-minimum')).toBe(true)
  })
})

describe('golden path geometry', () => {
  const left = leaf()
  const topRight = leaf()
  const bottomRight = leaf()
  const right = createSplit('y', [1, 2], [topRight, bottomRight])
  const root = createSplit('x', [2, 3], [left, right])
  const slide = createSlide({ hasTitle: true, root })
  const geometry = computeSlideGeometry(slide)

  const titleRect = geometry.titleRect as Rect
  const leftRect = geometry.rects.get(left.id) as Rect
  const topRightRect = geometry.rects.get(topRight.id) as Rect
  const bottomRightRect = geometry.rects.get(bottomRight.id) as Rect
  const rightRect = geometry.rects.get(right.id) as Rect

  it('insets the title from the slide edge by G', () => {
    expect(titleRect.x).toBe(G)
    expect(titleRect.y).toBe(G)
    expect(rectRight(titleRect)).toBe(SLIDE_WIDTH - G)
  })

  it('separates title and main by exactly G', () => {
    expect(geometry.mainRect.y - rectBottom(titleRect)).toBe(G)
  })

  it('separates left and right by exactly G', () => {
    expect(rightRect.x - rectRight(leftRect)).toBeCloseTo(G, 9)
  })

  it('separates top-right and bottom-right by exactly G', () => {
    expect(bottomRightRect.y - rectBottom(topRightRect)).toBeCloseTo(G, 9)
  })

  it('does not add extra gap when nesting the right column', () => {
    expect(topRightRect.x - rectRight(leftRect)).toBeCloseTo(G, 9)
    expect(bottomRightRect.x - rectRight(leftRect)).toBeCloseTo(G, 9)
  })

  it('keeps the 2:3 ratio across the usable width', () => {
    expect(rightRect.width / leftRect.width).toBeCloseTo(1.5, 9)
    expect(leftRect.width + G + rightRect.width).toBeCloseTo(geometry.mainRect.width, 9)
  })

  it('keeps the 1:2 ratio in the right column', () => {
    expect(bottomRightRect.height / topRightRect.height).toBeCloseTo(2, 9)
    expect(topRightRect.height + G + bottomRightRect.height).toBeCloseTo(rightRect.height, 9)
  })

  it('keeps every leaf inside the slide', () => {
    const slideRect = { x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT }
    for (const r of geometry.rects.values()) expect(rectContainsRect(slideRect, r)).toBe(true)
    expect(validateSlideGeometry(slide)).toEqual([])
  })

  it('produces exactly one distinct gap value across the whole slide', () => {
    const gaps = measureSiblingGaps(root, geometry.rects)
    const distinct = new Set(gaps.map((gap) => Math.round(gap * 1e6) / 1e6))
    expect([...distinct]).toEqual([G])
  })

  it('matches the expected absolute rects', () => {
    expect(titleRect).toEqual({ x: 24, y: 24, width: 1552, height: 72 })
    expect(geometry.mainRect).toEqual({ x: 24, y: 120, width: 1552, height: 756 })
    expect(leftRect.width).toBeCloseTo(611.2, EPS)
    expect(rightRect.width).toBeCloseTo(916.8, EPS)
    expect(topRightRect.height).toBeCloseTo(244, EPS)
    expect(bottomRightRect.height).toBeCloseTo(488, EPS)
  })
})

describe('degenerate rects', () => {
  it('keeps children inside a rect too small to hold the gaps', () => {
    const source = { x: 100, y: 50, width: 40, height: 30 }
    const rects = splitRect(source, 'x', [1, 1, 1, 1, 1], G)
    for (const r of rects) {
      expect(r.width).toBeGreaterThanOrEqual(0)
      expect(rectContainsRect(source, r)).toBe(true)
    }
    expect(rectRight(rects[rects.length - 1])).toBeCloseTo(rectRight(source), 9)
  })

  it('keeps children inside a zero-sized rect', () => {
    const source = { x: 0, y: 0, width: 0, height: 0 }
    for (const r of splitRect(source, 'y', [1, 2], G)) {
      expect(rectContainsRect(source, r)).toBe(true)
      expect(r.height).toBe(0)
    }
  })

  it('still reports the violation through validateSlideGeometry', () => {
    const many = Array.from({ length: 10 }, () => createLeaf())
    const inner = createSplit('y', many.map(() => 1), many)
    const outer = createSplit('y', [1, 1, 1, 1, 1, 1], [
      inner,
      createLeaf(),
      createLeaf(),
      createLeaf(),
      createLeaf(),
      createLeaf(),
    ])
    const slide = createSlide({ hasTitle: true, root: outer })
    const violations = validateSlideGeometry(slide)
    expect(violations.some((violation) => violation.kind === 'below-minimum')).toBe(true)
    expect(violations.some((violation) => violation.kind === 'outside-parent')).toBe(false)
  })
})

describe('computeCoverGeometry', () => {
  const geometry = computeCoverGeometry()

  it('leaves each line the page less its own pill padding', () => {
    const usable = SLIDE_WIDTH - SLIDE_INSET * 2
    expect(geometry.areaRect.width).toBe(usable)
    expect(geometry.titleRect.width).toBeCloseTo(
      usable - TITLE_FONT_SIZE * COVER_PILL_PADDING_X_EM * 2,
      9,
    )
    // The subtitle is set smaller, so its padding is smaller and its line is
    // wider — which is exactly why it holds more characters than the title.
    expect(geometry.subtitleRect.width).toBeCloseTo(
      usable - COVER_SUBTITLE_FONT_SIZE * COVER_PILL_PADDING_X_EM * 2,
      9,
    )
    expect(geometry.subtitleRect.width).toBeGreaterThan(geometry.titleRect.width)
  })

  it('centres the two pills as one block, with exactly one gap between them', () => {
    const { areaRect, blockRect, titleRect, subtitleRect } = geometry
    expect(rectContainsRect(areaRect, blockRect)).toBe(true)
    // Equal air above and below: the block is centred, not the pills separately.
    expect(blockRect.y - areaRect.y).toBeCloseTo(rectBottom(areaRect) - rectBottom(blockRect), 9)

    // The pill boxes, reconstructed from the line rects and the padding that
    // put them there — the distance between them is the deck's one gap, and
    // nothing here adds a second one.
    const titlePadY = titleRect.y - blockRect.y
    const subtitlePadY = COVER_SUBTITLE_FONT_SIZE * COVER_PILL_PADDING_Y_EM
    const titlePillBottom = rectBottom(titleRect) + titlePadY
    expect(subtitleRect.y - subtitlePadY - titlePillBottom).toBeCloseTo(G, 9)
    expect(rectBottom(subtitleRect) + subtitlePadY).toBeCloseTo(rectBottom(blockRect), 9)
  })

  it('grows the block with the type it is set in', () => {
    const bigger = computeCoverGeometry({ titleFontSize: TITLE_FONT_SIZE * 2 })
    expect(bigger.blockRect.height).toBeGreaterThan(geometry.blockRect.height)
    expect(bigger.titleRect.height).toBeCloseTo(TITLE_FONT_SIZE * 2 * TITLE_LINE_HEIGHT, 9)
    // Still centred, and still inside the page.
    expect(rectContainsRect(bigger.areaRect, bigger.blockRect)).toBe(true)
  })
})
