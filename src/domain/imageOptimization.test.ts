/**
 * The optimiser's arithmetic, pinned down as arithmetic.
 *
 * Everything here is about *which* pixels a slide shows and at *what* size,
 * decided from the document alone — so a wrong answer would be a picture that
 * comes back soft, or a crop that throws away something a frame was showing.
 * Neither is visible in a unit test, which is exactly why the rules are checked
 * here rather than left to a screenshot.
 */

import { describe, expect, it } from 'vitest'
import { OPTIMIZATION_PIXEL_DENSITY, SLIDE_HEIGHT, SLIDE_WIDTH } from './constants'
import {
  containerWithDoc,
  createImage,
  createTitledImageCard,
  createUntitledCard,
} from './content'
import { computeSlideGeometry } from './geometry'
import { coverGeometry, visibleSourceRect } from './imageGeometry'
import {
  MIN_CROP_SHARE,
  MIN_DOWNSCALE_RATIO,
  MIN_RECODE_SAVING_RATIO,
  assetOccurrences,
  encodingChoices,
  isPhotographic,
  isWorthKeeping,
  planForPanel,
  planOptimization,
  planShared,
  renameForMimeType,
  requiredSize,
  type AssetOccurrence,
  type PanelOccurrence,
} from './imageOptimization'
import { createLeaf, createSplit } from './layout'
import { geometryForTheme, themeMetrics } from './metrics'
import { createPresentation } from './presentation'
import { imageNode } from './richdoc'
import { contentAt, sectionAt } from './testDecks'
import type { AssetRef, LayoutNode, Presentation, ZoneContent } from './types'

function raster(id: string, width: number, height: number, extra: Partial<AssetRef> = {}): AssetRef {
  return {
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    byteSize: 1_000_000,
    width,
    height,
    isVector: false,
    ...extra,
  }
}

/** A deck whose second slide has this layout and knows about these files. */
function deckWith(root: LayoutNode, assets: AssetRef[], sandbox: ZoneContent[] = []): Presentation {
  const base = createPresentation({ title: 'Bilder' })
  return {
    ...base,
    assets,
    slides: [sectionAt(base, 0), { ...contentAt(base, 1), title: null, root }],
    sandbox: sandbox.map((content, index) => ({
      id: `sb${index}`,
      content,
      createdAt: base.createdAt,
      note: '',
    })),
  }
}

function panelAt(occurrences: AssetOccurrence[] | undefined, index = 0): PanelOccurrence {
  const occurrence = occurrences?.[index]
  if (occurrence?.kind !== 'panel') throw new Error('forventet et bildepanel')
  return occurrence
}

describe('where a file is shown', () => {
  it('measures a picture panel as the zone it fills, less a title panel where there is one', () => {
    const plain = createImage('a')
    const titled = createTitledImageCard('b')
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(plain), createLeaf(titled)]),
      [raster('a', 4000, 3000), raster('b', 4000, 3000)],
    )
    const slide = contentAt(deck, 1)
    const rects = computeSlideGeometry(slide, geometryForTheme(deck.theme)).rects
    const leaves = (slide.root as { children: LayoutNode[] }).children

    const shown = assetOccurrences(deck)
    const a = panelAt(shown.get('a'))
    expect(a.frame).toEqual({
      width: rects.get(leaves[0].id)!.width,
      height: rects.get(leaves[0].id)!.height,
    })
    expect(a.focus).toEqual({ x: 0.5, y: 0.5 })

    // The picture is the card's lower half: the header is not part of the frame.
    const b = panelAt(shown.get('b'))
    expect(b.frame.height).toBeCloseTo(
      rects.get(leaves[1].id)!.height - themeMetrics(deck.theme).cardHeaderHeight,
    )
  })

  it('measures an inline picture as its share of the column it stands in', () => {
    const card = createUntitledCard()
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'paragraph', content: [imageNode('a', { widthPercent: 50, aspect: 2 })] },
      ],
    }
    const filled = { ...card, body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc }] } }
    const deck = deckWith(createLeaf(filled), [raster('a', 3000, 1500)])
    const rect = computeSlideGeometry(contentAt(deck, 1), geometryForTheme(deck.theme)).rects.get(
      contentAt(deck, 1).root.id,
    )!
    const tokens = themeMetrics(deck.theme)

    const [inline] = assetOccurrences(deck).get('a') ?? []
    if (inline.kind !== 'inline') throw new Error('forventet et innlinjebilde')
    const column = rect.width - tokens.cardPadding * 2
    expect(inline.box.width).toBeCloseTo(column / 2)
    expect(inline.box.height).toBeCloseTo(column / 4)
  })

  it('divides a container among side-by-side subfields before measuring a picture in one', () => {
    const container = containerWithDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [imageNode('a', { widthPercent: 100, aspect: 1 })] }],
    })
    const twoColumns = {
      ...container,
      body: {
        axis: 'x' as const,
        weights: [1, 3],
        subfields: [container.body.subfields[0], { id: 'f_other', doc: { type: 'doc' as const } }],
      },
    }
    const deck = deckWith(createLeaf(twoColumns), [raster('a', 1000, 1000)])
    const rect = computeSlideGeometry(contentAt(deck, 1), geometryForTheme(deck.theme)).rects.get(
      contentAt(deck, 1).root.id,
    )!
    const tokens = themeMetrics(deck.theme)

    const [inline] = assetOccurrences(deck).get('a') ?? []
    if (inline.kind !== 'inline') throw new Error('forventet et innlinjebilde')
    // A quarter of what is left once the gap between the two columns is taken.
    expect(inline.box.width).toBeCloseTo((rect.width - tokens.subfieldGap) / 4)
  })

  it('records a parked picture as a sandbox occurrence and lists a file shown nowhere as empty', () => {
    const deck = deckWith(createLeaf(), [raster('a', 100, 100), raster('b', 100, 100)], [
      createImage('a'),
    ])
    const shown = assetOccurrences(deck)
    expect(shown.get('a')).toEqual([{ kind: 'sandbox', itemId: 'sb0' }])
    expect(shown.get('b')).toEqual([])
  })
})

describe('how big a file has to be', () => {
  const frame = { width: 400, height: 300 }
  const panel = (width: number, height: number, focus = { x: 0.5, y: 0.5 }): PanelOccurrence => ({
    kind: 'panel',
    slideId: 's',
    nodeId: 'n',
    frame: { width, height },
    focus,
  })

  it('keeps two file pixels per logical pixel of the largest frame', () => {
    expect(requiredSize({ width: 4000, height: 3000 }, [panel(400, 300)])).toEqual({
      width: 400 * OPTIMIZATION_PIXEL_DENSITY,
      height: 300 * OPTIMIZATION_PIXEL_DENSITY,
    })
  })

  it('never scales a file up', () => {
    const small = { width: 200, height: 150 }
    expect(requiredSize(small, [panel(400, 300)])).toEqual(small)
    // Exactly as large as needed is also left alone.
    const exact = { width: 800, height: 600 }
    expect(requiredSize(exact, [panel(400, 300)])).toEqual(exact)
  })

  it('sizes a shared file by its largest use', () => {
    const natural = { width: 4000, height: 3000 }
    expect(requiredSize(natural, [panel(400, 300), panel(800, 600), panel(200, 150)])).toEqual({
      width: 1600,
      height: 1200,
    })
  })

  it('sizes a picture that covers a frame by the axis that has to stretch', () => {
    // A wide file behind a tall frame is scaled by its height, not its width.
    const natural = { width: 4000, height: 1000 }
    const scale = coverGeometry(frame, natural)!.scale
    expect(requiredSize(natural, [panel(frame.width, frame.height)])).toEqual({
      width: Math.round(4000 * scale * 2),
      height: Math.round(1000 * scale * 2),
    })
  })

  it('sizes an inline picture by the box that contains it', () => {
    const inline: AssetOccurrence = {
      kind: 'inline',
      slideId: 's',
      nodeId: 'n',
      box: { width: 300, height: 300 },
    }
    // Contained: the wide file is limited by the box's width, not its height.
    expect(requiredSize({ width: 3000, height: 1500 }, [inline])).toEqual({ width: 600, height: 300 })
  })

  it('sizes a parked picture as though it might cover a whole slide', () => {
    const parked: AssetOccurrence = { kind: 'sandbox', itemId: 'sb' }
    const natural = { width: 8000, height: 4500 }
    expect(requiredSize(natural, [parked])).toEqual({
      width: SLIDE_WIDTH * OPTIMIZATION_PIXEL_DENSITY,
      height: SLIDE_HEIGHT * OPTIMIZATION_PIXEL_DENSITY,
    })
  })

  it('leaves a file alone when the downscale would be too small to matter', () => {
    // Needs 800 wide, has 850: under the ratio, so not worth a re-encode.
    const nearly = { width: 850, height: 638 }
    expect(planShared(nearly, [panel(400, 300)]).downscale).toBe(false)
    const plenty = { width: Math.ceil(800 / MIN_DOWNSCALE_RATIO) + 1, height: 900 }
    expect(planShared(plenty, [panel(400, 300)]).downscale).toBe(true)
  })
})

describe('a permanent crop', () => {
  const frame = { width: 400, height: 300 }
  const occurrence = (focus: { x: number; y: number }): PanelOccurrence => ({
    kind: 'panel',
    slideId: 's',
    nodeId: 'n',
    frame,
    focus,
  })

  it('keeps exactly the pixels the frame was showing, and comes out the shape of the frame', () => {
    // Twice as wide as the frame's proportions: the sides are hidden.
    const natural = { width: 1600, height: 600 }
    const plan = planForPanel(natural, occurrence({ x: 0.5, y: 0.5 }))

    expect(plan.crop).toBe(true)
    // What `cover` puts on screen, in file pixels — the same arithmetic the
    // editor's drag uses, so the two cannot disagree about what is visible.
    expect(plan.source).toEqual(visibleSourceRect(frame, { x: 0.5, y: 0.5 }, natural))
    expect(plan.source).toEqual({ x: 400, y: 0, width: 800, height: 600 })
    // Nothing to downscale: the crop holds exactly what the frame needs.
    expect(plan.target).toEqual({ width: 800, height: 600 })
    expect(plan.downscale).toBe(false)

    // After the crop the file *is* the frame's shape: nothing is hidden, so a
    // centred focus shows all of it and the picture lands where it was.
    const after = coverGeometry(frame, plan.target)!
    expect(after.overflowX).toBeCloseTo(0, 5)
    expect(after.overflowY).toBeCloseTo(0, 5)
  })

  it('follows the focus to the edge that is on screen', () => {
    const natural = { width: 1600, height: 600 }
    expect(planForPanel(natural, occurrence({ x: 0, y: 0.5 })).source.x).toBe(0)
    expect(planForPanel(natural, occurrence({ x: 1, y: 0.5 })).source.x).toBe(800)
    expect(planForPanel(natural, occurrence({ x: 0.25, y: 0.5 })).source.x).toBe(200)
  })

  it('crops and downscales in one step when the crop still holds more than the frame needs', () => {
    const natural = { width: 8000, height: 3000 }
    const plan = planForPanel(natural, occurrence({ x: 0.5, y: 0.5 }))
    expect(plan.crop).toBe(true)
    expect(plan.downscale).toBe(true)
    // The visible half of the file, brought down to two pixels per logical one.
    expect(plan.source).toEqual({ x: 2000, y: 0, width: 4000, height: 3000 })
    expect(plan.target).toEqual({ width: 800, height: 600 })
  })

  it('keeps the frame\'s proportions rather than rounding each side on its own', () => {
    // Fractional frame, as a real zone rectangle is.
    const odd: PanelOccurrence = {
      ...occurrence({ x: 0.5, y: 0.5 }),
      frame: { width: 371.33, height: 289.5 },
    }
    const plan = planForPanel({ width: 3000, height: 1000 }, odd)
    expect(plan.target.height).toBe(Math.round((plan.target.width * 289.5) / 371.33))
    const after = coverGeometry(odd.frame, plan.target)!
    // Well under a pixel of overflow in the frame's own units.
    expect(Math.max(after.overflowX, after.overflowY)).toBeLessThan(1)
  })

  it('does not call a sliver of rounding a crop', () => {
    // Hides a quarter of a percent: under `MIN_CROP_SHARE`, so nothing is cut.
    const natural = { width: 401, height: 300 }
    const plan = planForPanel(natural, occurrence({ x: 0.5, y: 0.5 }))
    expect(plan.crop).toBe(false)
    expect(plan.source).toEqual({ x: 0, y: 0, width: 401, height: 300 })

    const justOver = { width: Math.ceil(400 / (1 - MIN_CROP_SHARE)) + 1, height: 300 }
    expect(planForPanel(justOver, occurrence({ x: 0.5, y: 0.5 })).crop).toBe(true)
  })
})

describe('planning a presentation', () => {
  function twoPanels(assetA: string, assetB: string): LayoutNode {
    return createSplit('x', [1, 1], [createLeaf(createImage(assetA)), createLeaf(createImage(assetB))])
  }

  it('crops a file shown once and downscales one shown twice, by its largest use', () => {
    const deck = deckWith(twoPanels('once', 'twice'), [raster('once', 8000, 3000), raster('twice', 8000, 3000)], [
      createImage('twice'),
    ])
    const plans = planOptimization(deck, { kind: 'all' })
    const once = plans.find((plan) => plan.ref.id === 'once')!
    const twice = plans.find((plan) => plan.ref.id === 'twice')!

    expect(once.mode).toBe('shared')
    expect(once.raster?.crop).toBe(true)

    // Shown in a frame and parked in the sandbox: what one frame hides, the
    // other may show, so nothing is cut — and the parked use is the largest.
    expect(twice.mode).toBe('shared')
    expect(twice.raster?.crop).toBe(false)
    expect(twice.raster?.downscale).toBe(true)
    expect(twice.raster?.target).toEqual(
      requiredSize(twice.ref, twice.occurrences),
    )
  })

  it('leaves a vector file as it is and leaves out a file shown nowhere', () => {
    const svg: AssetRef = { ...raster('fig', 100, 50), mimeType: 'image/svg+xml', isVector: true }
    const deck = deckWith(createLeaf(createImage('fig')), [svg, raster('unused', 10, 10)])
    const plans = planOptimization(deck, { kind: 'all' })
    expect(plans.map((plan) => plan.ref.id)).toEqual(['fig'])
    expect(plans[0].raster).toBeNull()
  })

  it('forks a shared file for the one panel that crops it, and leaves the other uses alone', () => {
    const deck = deckWith(twoPanels('shared', 'shared'), [raster('shared', 8000, 3000)])
    const slide = contentAt(deck, 1)
    const [left] = (slide.root as { children: LayoutNode[] }).children

    const [plan] = planOptimization(deck, { kind: 'panel', slideId: slide.id, nodeId: left.id })
    expect(plan.mode).toBe('fork')
    expect(plan.only).toEqual({ slideId: slide.id, nodeId: left.id })
    expect(plan.raster?.crop).toBe(true)
    expect(plan.occurrences).toHaveLength(2)

    // The same file, asked about as a whole: sized by its uses, cropped for none.
    const [whole] = planOptimization(deck, { kind: 'asset', assetId: 'shared' })
    expect(whole.mode).toBe('shared')
    expect(whole.raster?.crop).toBe(false)
  })

  it('treats a panel that hides nothing as an ordinary shared use', () => {
    // The file already has the frames' proportions (both frames are equal).
    const deck = deckWith(twoPanels('fit', 'fit'), [raster('fit', 100, 100)])
    const slide = contentAt(deck, 1)
    const [left] = (slide.root as { children: LayoutNode[] }).children
    const rect = computeSlideGeometry(slide, geometryForTheme(deck.theme)).rects.get(left.id)!
    const fitted: Presentation = {
      ...deck,
      assets: [raster('fit', Math.round(rect.width * 10), Math.round(rect.height * 10))],
    }

    const [plan] = planOptimization(fitted, { kind: 'panel', slideId: slide.id, nodeId: left.id })
    expect(plan.mode).toBe('shared')
    expect(plan.only).toBeNull()
  })

  it('answers nothing for a zone that is not a picture', () => {
    const deck = deckWith(createLeaf(createUntitledCard()), [raster('a', 10, 10)])
    const slide = contentAt(deck, 1)
    expect(planOptimization(deck, { kind: 'panel', slideId: slide.id, nodeId: slide.root.id })).toEqual([])
  })
})

describe('choosing a container', () => {
  const photo = { hasAlpha: false, photographic: true, lossySource: false }
  const graphics = { hasAlpha: false, photographic: false, lossySource: false }

  it('puts a photograph in a lossy container, WebP where the browser can write it', () => {
    expect(encodingChoices(photo, true)).toEqual([{ mimeType: 'image/webp', quality: expect.any(Number) }])
    expect(encodingChoices(photo, false)).toEqual([{ mimeType: 'image/jpeg', quality: expect.any(Number) }])
  })

  it('keeps graphics lossless whatever they were stored as', () => {
    expect(encodingChoices(graphics, true).every((choice) => choice.quality === undefined)).toBe(true)
    expect(encodingChoices(graphics, false)).toEqual([{ mimeType: 'image/png' }])
  })

  it('never puts a transparent picture in a container without an alpha channel', () => {
    const seeThrough = { ...photo, hasAlpha: true }
    // JPEG has no alpha, so without WebP the photograph stays lossless.
    expect(encodingChoices(seeThrough, false)).toEqual([{ mimeType: 'image/png' }])
    expect(encodingChoices(seeThrough, true).map((choice) => choice.mimeType)).toEqual(['image/webp'])
  })

  it('treats pixels that already came through a lossy codec as lossy', () => {
    const recompressed = { ...graphics, lossySource: true }
    expect(encodingChoices(recompressed, false)).toEqual([
      { mimeType: 'image/jpeg', quality: expect.any(Number) },
    ])
  })

  it('leans towards graphics when the sample is ambiguous', () => {
    expect(isPhotographic({ flatFraction: 0.05, distinctFraction: 0.8 })).toBe(true)
    // Flat areas dominate: text on a background, or a diagram.
    expect(isPhotographic({ flatFraction: 0.7, distinctFraction: 0.8 })).toBe(false)
    // Few colours, whatever the texture: a palette image.
    expect(isPhotographic({ flatFraction: 0.05, distinctFraction: 0.05 })).toBe(false)
  })
})

describe('keeping a result', () => {
  it('keeps a result that changed pixels as soon as it is smaller', () => {
    expect(isWorthKeeping(1000, 999, true)).toBe(true)
    expect(isWorthKeeping(1000, 1000, true)).toBe(false)
  })

  it('asks a plain re-encode to earn its rewrite', () => {
    const threshold = 1000 * (1 - MIN_RECODE_SAVING_RATIO)
    expect(isWorthKeeping(1000, threshold, false)).toBe(true)
    expect(isWorthKeeping(1000, threshold + 1, false)).toBe(false)
  })

  it('never keeps a result that grew', () => {
    expect(isWorthKeeping(1000, 1200, true)).toBe(false)
  })
})

describe('naming the result', () => {
  it('replaces an extension that has become a lie and leaves the rest of the name alone', () => {
    expect(renameForMimeType('ferie.JPG', 'image/webp')).toBe('ferie.webp')
    expect(renameForMimeType('ferie.jpeg', 'image/jpeg')).toBe('ferie.jpeg')
    expect(renameForMimeType('ferie', 'image/webp')).toBe('ferie')
    expect(renameForMimeType('min.fine.figur.png', 'image/png')).toBe('min.fine.figur.png')
  })
})
