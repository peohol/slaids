import { describe, expect, it } from 'vitest'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { viewportToSlide } from '../../domain/geometry'
import { stageView } from './EditorStage'

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
