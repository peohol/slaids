import { describe, expect, it } from 'vitest'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { viewportToSlide } from '../../domain/geometry'
import {
  FULL_SLIDE,
  MAX_STAGE_ZOOM,
  NO_ZOOM,
  isZoomed,
  panBy,
  stageView,
  viewRect,
  zoomAbout,
} from './stageView'

/**
 * The zoomed view is a view transform and nothing else.
 *
 * What has to stay true across it is the one thing selection depends on: a
 * point on screen converts back into the same slide coordinate whether the
 * stage is showing the whole page or one zone of it. If that ever stopped
 * holding, a press would select a different zone from the one under the finger.
 */
describe('stageView', () => {
  const box = { width: 800, height: 600 }

  it('fits the whole slide when nothing is focused', () => {
    const view = stageView(box, null)
    expect(view.scale).toBeCloseTo(800 / SLIDE_WIDTH, 6)
    expect(view.offsetX).toBe(0)
    expect(view.offsetY).toBe(0)
    expect(view.width).toBeCloseTo(800, 6)
    expect(view.height).toBeCloseTo((800 / SLIDE_WIDTH) * SLIDE_HEIGHT, 6)
  })

  it('fills the stage with the focused rect, and only with it', () => {
    const focus = { x: 400, y: 200, width: 400, height: 300 }
    const view = stageView(box, focus)
    expect(view.scale).toBeCloseTo(Math.min(800 / 400, 600 / 300), 6)
    expect(view.width).toBeCloseTo(focus.width * view.scale, 6)
    expect(view.height).toBeCloseTo(focus.height * view.scale, 6)
    // The zone starts at the stage's corner, so the slide is pulled up and left.
    expect(view.offsetX).toBeCloseTo(-focus.x * view.scale, 6)
    expect(view.offsetY).toBeCloseTo(-focus.y * view.scale, 6)
    // Zooming in means a bigger scale, never a different design space.
    expect(view.scale).toBeGreaterThan(stageView(box, null).scale)
  })

  it('puts a screen point back on the same slide point, zoomed or not', () => {
    const focus = { x: 400, y: 200, width: 400, height: 300 }
    const stageLeft = 100
    const stageTop = 50

    for (const view of [stageView(box, null), stageView(box, focus)]) {
      // The slide element's own origin on screen: the stage's corner, moved by
      // the view's offset — which is exactly what a bounding rect reports.
      const origin = { left: stageLeft + view.offsetX, top: stageTop + view.offsetY }
      const slidePoint = { x: 620, y: 330 }
      const screenX = origin.left + slidePoint.x * view.scale
      const screenY = origin.top + slidePoint.y * view.scale

      const back = viewportToSlide(screenX, screenY, origin, view.scale)
      expect(back.x).toBeCloseTo(slidePoint.x, 6)
      expect(back.y).toBeCloseTo(slidePoint.y, 6)
    }
  })

  it('reports nothing at all for a stage with no room yet', () => {
    expect(stageView({ width: 0, height: 0 }, null)).toEqual({
      scale: 0,
      offsetX: 0,
      offsetY: 0,
      width: 0,
      height: 0,
    })
  })

  it('ignores a degenerate focus rect rather than dividing by it', () => {
    const view = stageView(box, { x: 10, y: 10, width: 0, height: 0 })
    expect(view.scale).toBeCloseTo(stageView(box, null).scale, 6)
  })
})

/**
 * The pinch, as the same model.
 *
 * A magnified view is not a second transform layered over the first: it is the
 * same "which rectangle of the slide fills the stage" question with a smaller
 * rectangle. Everything below is about that one rule holding — including when
 * the base rect is a focused zone rather than the page.
 */
describe('viewRect', () => {
  const zone = { x: 400, y: 200, width: 400, height: 300 }

  it('shows the base rect exactly when nothing is magnified', () => {
    expect(viewRect(FULL_SLIDE, NO_ZOOM)).toEqual(FULL_SLIDE)
    expect(viewRect(zone, NO_ZOOM)).toEqual(zone)
    expect(isZoomed(NO_ZOOM)).toBe(false)
  })

  it('never leaves the base rect, however far the centre is pushed', () => {
    for (const base of [FULL_SLIDE, zone]) {
      const rect = viewRect(base, { scale: 3, centreX: -9000, centreY: 9000 })
      expect(rect.x).toBeCloseTo(base.x, 6)
      expect(rect.y).toBeCloseTo(base.y + base.height - rect.height, 6)
      expect(rect.x + rect.width).toBeLessThanOrEqual(base.x + base.width + 1e-6)
      expect(rect.y + rect.height).toBeGreaterThanOrEqual(base.y - 1e-6)
    }
  })

  it('stops magnifying at the limit rather than at infinity', () => {
    const far = viewRect(FULL_SLIDE, { scale: 1000, centreX: 800, centreY: 450 })
    expect(far.width).toBeCloseTo(SLIDE_WIDTH / MAX_STAGE_ZOOM, 6)
    expect(far.height).toBeCloseTo(SLIDE_HEIGHT / MAX_STAGE_ZOOM, 6)
  })

  it('cannot be pinched out past the base rect', () => {
    expect(viewRect(zone, { scale: 0.2, centreX: 600, centreY: 350 })).toEqual(zone)
  })
})

describe('zoomAbout', () => {
  /**
   * The promise a pinch makes: whatever was under the fingers stays under them.
   *
   * Checked through the transform the stage actually applies, so it is the
   * pixel the author is looking at that is asserted about, not an intermediate
   * number.
   */
  it('keeps the point it was anchored on where it is on screen', () => {
    const box = { width: 800, height: 600 }
    const anchor = { x: 1100, y: 300 }
    const before = stageView(box, viewRect(FULL_SLIDE, NO_ZOOM))
    const screenX = before.offsetX + anchor.x * before.scale
    const screenY = before.offsetY + anchor.y * before.scale

    const zoomed = zoomAbout(FULL_SLIDE, NO_ZOOM, 2.5, anchor.x, anchor.y)
    const after = stageView(box, viewRect(FULL_SLIDE, zoomed))
    expect(after.offsetX + anchor.x * after.scale).toBeCloseTo(screenX, 4)
    expect(after.offsetY + anchor.y * after.scale).toBeCloseTo(screenY, 4)
    expect(isZoomed(zoomed)).toBe(true)
  })

  it('anchors inside a focused zone the same way', () => {
    const zone = { x: 400, y: 200, width: 400, height: 300 }
    const box = { width: 800, height: 600 }
    const anchor = { x: 700, y: 260 }
    const before = stageView(box, viewRect(zone, NO_ZOOM))
    const screenX = before.offsetX + anchor.x * before.scale

    const zoomed = zoomAbout(zone, NO_ZOOM, 2, anchor.x, anchor.y)
    const after = stageView(box, viewRect(zone, zoomed))
    expect(after.offsetX + anchor.x * after.scale).toBeCloseTo(screenX, 4)
    // Still the zone, never the rest of the slide.
    const rect = viewRect(zone, zoomed)
    expect(rect.x).toBeGreaterThanOrEqual(zone.x - 1e-6)
    expect(rect.x + rect.width).toBeLessThanOrEqual(zone.x + zone.width + 1e-6)
  })

  it('lands back on the base rect when the pinch is undone', () => {
    const zoomed = zoomAbout(FULL_SLIDE, NO_ZOOM, 3, 200, 700)
    const back = zoomAbout(FULL_SLIDE, zoomed, 1 / 3, 200, 700)
    expect(viewRect(FULL_SLIDE, back)).toEqual(FULL_SLIDE)
    expect(isZoomed(back)).toBe(false)
  })
})

describe('panBy', () => {
  it('moves the view against the hand, and stops at the edge', () => {
    const zoomed = zoomAbout(FULL_SLIDE, NO_ZOOM, 2, 800, 450)
    const moved = panBy(FULL_SLIDE, zoomed, 100, 0)
    expect(viewRect(FULL_SLIDE, moved).x).toBeCloseTo(viewRect(FULL_SLIDE, zoomed).x - 100, 6)

    const far = panBy(FULL_SLIDE, zoomed, 99999, 99999)
    expect(viewRect(FULL_SLIDE, far).x).toBe(0)
    expect(viewRect(FULL_SLIDE, far).y).toBe(0)
  })

  it('has nothing to move while the whole base rect is showing', () => {
    expect(viewRect(FULL_SLIDE, panBy(FULL_SLIDE, NO_ZOOM, 250, 250))).toEqual(FULL_SLIDE)
  })
})

/**
 * The one thing selection depends on, now with a pinch in the way: a point on
 * screen has to convert back to the same slide coordinate whatever the view is
 * doing. If it ever stopped holding, a press would select the wrong zone.
 */
describe('hit-testing through a magnified view', () => {
  const box = { width: 800, height: 600 }
  const zone = { x: 400, y: 200, width: 400, height: 300 }

  it('puts a screen point back on the same slide point at every zoom', () => {
    const views = [
      viewRect(FULL_SLIDE, NO_ZOOM),
      viewRect(FULL_SLIDE, zoomAbout(FULL_SLIDE, NO_ZOOM, 2.5, 1100, 300)),
      viewRect(zone, NO_ZOOM),
      viewRect(zone, zoomAbout(zone, NO_ZOOM, 2, 700, 260)),
    ]
    for (const rect of views) {
      const view = stageView(box, rect)
      const origin = { left: 100 + view.offsetX, top: 50 + view.offsetY }
      const slidePoint = { x: rect.x + rect.width / 3, y: rect.y + rect.height / 4 }
      const back = viewportToSlide(
        origin.left + slidePoint.x * view.scale,
        origin.top + slidePoint.y * view.scale,
        origin,
        view.scale,
      )
      expect(back.x).toBeCloseTo(slidePoint.x, 4)
      expect(back.y).toBeCloseTo(slidePoint.y, 4)
    }
  })
})
