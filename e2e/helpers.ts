import { expect, type Page } from '@playwright/test'

export const SLIDE_WIDTH = 1600
export const SLIDE_HEIGHT = 900
export const G = 24

export interface ZoneRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** Collects console errors and page errors so a test can assert the app is clean. */
export function watchForErrors(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return { errors }
}

/** The slide stage. Scope stage assertions to this — filmstrip thumbnails render the same markup. */
export function stage(page: Page) {
  return page.getByTestId('stage-slide')
}

export async function createPresentation(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByTestId('new-presentation').click()
  await page.getByTestId('presentation-title-input').fill(title)
  await page.getByTestId('create-presentation').click()
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('stage-slide')).toBeVisible()
}

/** Convert a point in slide coordinates into viewport coordinates. */
export async function slidePoint(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([sx, sy]) => {
      const element = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
      const rect = element.getBoundingClientRect()
      const scale = Number(element.dataset.scale)
      return { x: rect.left + sx * scale, y: rect.top + sy * scale }
    },
    [x, y],
  )
}

export async function clickSlide(page: Page, x: number, y: number): Promise<void> {
  const point = await slidePoint(page, x, y)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(120)
}

/** All leaf-zone rects on the stage, in slide coordinates, measured from the DOM. */
export async function zoneRects(page: Page): Promise<ZoneRect[]> {
  const rects = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
    const stage = element.getBoundingClientRect()
    const scale = Number(element.dataset.scale)
    return [...element.querySelectorAll('.slide-zone')].map((zone) => {
      const rect = zone.getBoundingClientRect()
      return {
        id: (zone as HTMLElement).dataset.nodeId as string,
        x: (rect.left - stage.left) / scale,
        y: (rect.top - stage.top) / scale,
        w: rect.width / scale,
        h: rect.height / scale,
      }
    })
  })
  return rects.sort((a, b) => a.x - b.x || a.y - b.y)
}

export async function titleRect(page: Page): Promise<ZoneRect> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
    const stage = element.getBoundingClientRect()
    const scale = Number(element.dataset.scale)
    const rect = (
      element.querySelector('[data-testid="slide-title"]') as HTMLElement
    ).getBoundingClientRect()
    return {
      id: 'title',
      x: (rect.left - stage.left) / scale,
      y: (rect.top - stage.top) / scale,
      w: rect.width / scale,
      h: rect.height / scale,
    }
  })
}

/** Split the currently selected zone through the split dialog. */
export async function splitSelected(
  page: Page,
  weights: number[],
  axis?: 'x' | 'y',
): Promise<void> {
  await page.getByTestId('inspector-action-split').click()
  await expect(page.getByTestId('split-modal')).toBeVisible()
  if (axis) await page.getByTestId(`split-axis-${axis}`).click()
  // The weight inputs only exist once the child count matches.
  await page.getByTestId('split-count').fill(String(weights.length))
  await expect(page.getByTestId(`split-weight-${weights.length - 1}`)).toBeVisible()
  for (let i = 0; i < weights.length; i += 1) {
    await page.getByTestId(`split-weight-${i}`).fill(String(weights[i]))
  }
  await page.getByTestId('split-apply').click()
  await expect(page.getByTestId('split-modal')).toBeHidden()
  await page.waitForTimeout(150)
}

export async function enterZoneMode(page: Page): Promise<void> {
  await page.getByTestId('mode-zone').click()
  await expect(page.getByTestId('zone-overlay')).toBeVisible()
}

export async function enterContentMode(page: Page): Promise<void> {
  await page.getByTestId('mode-content').click()
  await expect(page.getByTestId('zone-overlay')).toBeHidden()
}

export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', {
    timeout: 10_000,
  })
}

/** Adds content of the given kind to a specific zone via the empty-zone buttons. */
export async function addContentToZone(
  page: Page,
  nodeId: string,
  kind: 'container' | 'untitled-card' | 'titled-card',
): Promise<void> {
  await stage(page)
    .locator(`.slide-zone[data-node-id="${nodeId}"] [data-testid="empty-zone-${kind}"]`)
    .click()
  await page.waitForTimeout(200)
}

export function expectGap(actual: number, message: string): void {
  expect(actual, message).toBeGreaterThan(G - 0.2)
  expect(actual, message).toBeLessThan(G + 0.2)
}
