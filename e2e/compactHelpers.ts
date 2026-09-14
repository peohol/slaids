/**
 * The compact workspace, from a test's point of view.
 *
 * Everything here is about *where* a control is on a small screen, never about
 * what it does: the buttons are the same buttons, in the panel the shell puts
 * them in. A helper that reached past the panel to click something the user
 * cannot see would prove nothing.
 */

import { expect, type Page } from './fixtures'
import { slidePoint } from './helpers'

export type CompactPanel = 'slides' | 'content' | 'zone' | 'tools'

/** Open one of the four panels, whatever is open now. */
export async function openPanel(page: Page, panel: CompactPanel): Promise<void> {
  const tab = page.getByTestId(`compact-tab-${panel}`)
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click()
  await expect(page.getByTestId('compact-panel')).toHaveAttribute('data-panel', panel)
}

/** Close whichever panel is open, so the slide has the whole screen. */
export async function closePanel(page: Page): Promise<void> {
  if (await page.getByTestId('compact-panel').isVisible()) {
    await page.getByTestId('compact-panel-close').click()
  }
  await expect(page.getByTestId('compact-panel')).toBeHidden()
}

/** Whether this run is on a compact workspace at all. */
export async function isCompact(page: Page): Promise<boolean> {
  return (await page.getAttribute('[data-testid="editor"]', 'data-shell')) === 'compact'
}

/**
 * Whether the pointer on this run is a finger.
 *
 * Read from the root element rather than from the project's name: it is the
 * same fact the app itself acts on, so a test that branches on it is branching
 * on the app's own answer instead of on an assumption about the runner.
 */
export async function isCoarse(page: Page): Promise<boolean> {
  return (await page.evaluate(() => document.documentElement.dataset.coarse)) === 'true'
}

/**
 * Press a point on the slide, in slide coordinates.
 *
 * A press rather than a click: on a compact workspace a press on a zone is
 * what selects it, and the same helper has to work with a finger and with a
 * mouse — which is the whole claim the compact-mouse project exists to check.
 */
export async function pressSlide(page: Page, x: number, y: number): Promise<void> {
  const point = await slidePoint(page, x, y)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(120)
}

/** The ids of the authored slides, in the order the strip lists them. */
export async function slideOrder(page: Page): Promise<string[]> {
  return page
    .getByTestId('filmstrip-item')
    .evaluateAll((items) =>
      items
        .map((item) => (item as HTMLElement).dataset.slideId)
        .filter((id): id is string => Boolean(id)),
    )
}

/** Turn the device: the same window, the other way round. */
export async function rotate(page: Page): Promise<void> {
  const size = page.viewportSize()
  if (!size) throw new Error('Ingen viewport å rotere')
  await page.setViewportSize({ width: size.height, height: size.width })
  await page.waitForTimeout(250)
}

/**
 * Pretend an on-screen keyboard opened.
 *
 * There is no way to raise a real one from a test, and Slaids does not look
 * for one: what it reads is `visualViewport`, which is how a browser says «this
 * much of the page is actually visible». Overriding that one number and firing
 * the event the browser fires is therefore exactly the input the app handles —
 * what it cannot cover is how a physical keyboard animates in, which is what
 * the manual smoke test in `docs/MOBILE_WORKSPACE.md` is for.
 */
export async function openKeyboard(page: Page, share = 0.45): Promise<void> {
  await page.evaluate((covered) => {
    const view = window.visualViewport
    if (!view) throw new Error('Nettleseren har ingen visualViewport')
    Object.defineProperty(view, 'height', {
      configurable: true,
      get: () => Math.round(window.innerHeight * (1 - covered)),
    })
    view.dispatchEvent(new Event('resize'))
  }, share)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.keyboard))
    .toBe('open')
}

/** Put the visible viewport back the way the browser had it. */
export async function closeKeyboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const view = window.visualViewport
    if (!view) return
    Object.defineProperty(view, 'height', {
      configurable: true,
      get: () => window.innerHeight,
    })
    view.dispatchEvent(new Event('resize'))
  })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.keyboard))
    .toBe('closed')
}

/**
 * The area the stage actually has to draw a slide in, padding taken out.
 *
 * Not the element's box: in landscape the panel floats *over* the stage and
 * the stage stands back from it with padding, so the box is the same size
 * either way and only the room inside it changes.
 */
export async function stageRoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="compact-stage"]') as HTMLElement
    const styles = getComputedStyle(element)
    const width =
      element.clientWidth -
      parseFloat(styles.paddingLeft || '0') -
      parseFloat(styles.paddingRight || '0')
    const height =
      element.clientHeight -
      parseFloat(styles.paddingTop || '0') -
      parseFloat(styles.paddingBottom || '0')
    return width * height
  })
}

/** Whether an element is completely inside the part of the page on screen. */
export async function isOnScreen(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const element = document.querySelector(`[data-testid="${id}"]`)
    if (!element) return false
    const box = element.getBoundingClientRect()
    const view = window.visualViewport
    const top = view ? view.offsetTop : 0
    const bottom = top + (view ? view.height : window.innerHeight)
    return box.top >= top - 1 && box.bottom <= bottom + 1 && box.width > 0 && box.height > 0
  }, testId)
}

/**
 * Where the slide area is on screen, as a box to gesture inside.
 *
 * The stage's own element rather than the slide's: a gesture is about the area
 * the finger is in, and the letterbox around a 16:9 page on a phone is part of
 * that area.
 */
export async function stageArea(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('compact-stage').boundingBox()
  if (!box) throw new Error('Ingen slideflate å ta på')
  return box
}

/**
 * Drag one finger across the slide area.
 *
 * Real input, not a synthesised event: `page.mouse` on a run with a mouse and
 * Chromium's own touch pipeline on a run with a finger, so the gesture goes
 * through the browser exactly as a user's would — including the `touch-action`
 * the stylesheet asks for. Which of the two this run uses is read from the app's
 * own answer about the pointer, never from the project's name.
 */
export async function dragAcrossSlide(
  page: Page,
  delta: { dx: number; dy: number },
  from?: { x: number; y: number },
): Promise<void> {
  const box = await stageArea(page)
  const start = from ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const steps = [0.25, 0.5, 0.75, 1]

  if (await isCoarse(page)) {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: start.x, y: start.y, id: 1 }],
    })
    for (const step of steps) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x + delta.dx * step, y: start.y + delta.dy * step, id: 1 }],
      })
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  } else {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (const step of steps) {
      await page.mouse.move(start.x + delta.dx * step, start.y + delta.dy * step)
    }
    await page.mouse.up()
  }
  await page.waitForTimeout(150)
}

/**
 * One page along the deck, as a flick across the slide area.
 *
 * `1` is the next page and `-1` the previous one, and the hand travels the
 * *other* way: dragging the page to the left brings the next one in from the
 * right, the way every carousel on a phone behaves.
 */
export async function swipeSlide(page: Page, direction: 1 | -1): Promise<void> {
  const box = await stageArea(page)
  const travel = Math.min(240, box.width * 0.5)
  await dragAcrossSlide(page, { dx: -travel * direction, dy: 0 })
}

/**
 * Press and hold a point of the slide, in slide coordinates.
 *
 * The browser's own input again, and held past the recogniser's threshold with
 * a margin: what is under test is a gesture a hand performs, so a test that
 * dispatched a synthetic event would prove the handler runs without proving
 * the browser ever lets it.
 */
export async function longPressSlide(
  page: Page,
  x: number,
  y: number,
  hold = 800,
): Promise<void> {
  const point = await slidePoint(page, x, y)
  if (await isCoarse(page)) {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x, y: point.y, id: 1 }],
    })
    await page.waitForTimeout(hold)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  } else {
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.waitForTimeout(hold)
    await page.mouse.up()
  }
  await page.waitForTimeout(150)
}

/**
 * Hold a finger down, move it, and only then let go.
 *
 * The movement is what separates a long press from everything else, so this is
 * how a test asks whether travel really does cancel one.
 */
export async function longPressWithDrift(
  page: Page,
  x: number,
  y: number,
  drift: { dx: number; dy: number },
  hold = 800,
): Promise<void> {
  const point = await slidePoint(page, x, y)
  if (await isCoarse(page)) {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x, y: point.y, id: 1 }],
    })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + drift.dx, y: point.y + drift.dy, id: 1 }],
    })
    await page.waitForTimeout(hold)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  } else {
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + drift.dx, point.y + drift.dy)
    await page.waitForTimeout(hold)
    await page.mouse.up()
  }
  await page.waitForTimeout(150)
}

/**
 * Two fingers spreading apart on the slide area.
 *
 * Chromium's own touch pipeline again, so what the app sees is a genuine pair
 * of pointer events — which is the only way to find out whether the browser
 * took the gesture for its own page zoom instead.
 */
export async function pinchSlide(
  page: Page,
  { from, to }: { from: number; to: number },
  centre?: { x: number; y: number },
): Promise<void> {
  const box = await stageArea(page)
  const at = centre ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const session = await page.context().newCDPSession(page)
  const points = (spread: number) => [
    { x: at.x - spread / 2, y: at.y, id: 1 },
    { x: at.x + spread / 2, y: at.y, id: 2 },
  ]
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points(from),
  })
  for (let step = 1; step <= 6; step += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(from + ((to - from) * step) / 6),
    })
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
  await page.waitForTimeout(150)
}

/** How far the stage is magnified beyond the view it is based on. */
export async function stageZoom(page: Page): Promise<number> {
  return Number(await page.getAttribute('[data-testid="stage-slide"]', 'data-zoom'))
}

/** Which authored slide the stage is showing. */
export async function shownSlideId(page: Page): Promise<string> {
  return (await page.getAttribute('[data-testid="compact-stage"]', 'data-slide-id')) ?? ''
}

/** The slide coordinate currently drawn at a point on screen. */
export async function slidePointAt(
  page: Page,
  client: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  return page.evaluate((point) => {
    const element = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
    const rect = element.getBoundingClientRect()
    const scale = Number(element.dataset.scale)
    return { x: (point.x - rect.left) / scale, y: (point.y - rect.top) / scale }
  }, client)
}

/** Whether the browser is holding a selection of text right now. */
export async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString().trim() ?? '')
}
