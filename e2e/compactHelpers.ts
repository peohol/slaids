/**
 * The compact workspace, from a test's point of view.
 *
 * Everything here is about *where* a control is on a small screen, never about
 * what it does: the buttons are the same buttons, in the panel the shell puts
 * them in. A helper that reached past the panel to click something the user
 * cannot see would prove nothing.
 */

import { expect, type Page } from './fixtures'

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
  const point = await page.evaluate(
    ([sx, sy]) => {
      const element = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
      const rect = element.getBoundingClientRect()
      const scale = Number(element.dataset.scale)
      return { x: rect.left + sx * scale, y: rect.top + sy * scale }
    },
    [x, y],
  )
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
