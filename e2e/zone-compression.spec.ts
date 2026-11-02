/**
 * Compressing zones into negative space, with the pointer.
 *
 * The arithmetic is tested in `zoneGesture.test.ts`; this is the part only a
 * browser can show: which handle a press lands on, that Shift is read at the
 * press, that the live layout follows the hand, and that one drag is one
 * undo step that brings back sizes and structure alike.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  createPresentation,
  enterZoneMode,
  slidePoint,
  splitSelected,
  stage,
  watchForErrors,
  zoneRects,
  type ZoneRect,
} from './helpers'

/** The leaves on the slide, `n` for air and `c` for anything else, left to right / top to bottom. */
async function leafShape(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="stage-slide"] .slide-zone')]
      .filter((zone) => (zone as HTMLElement).getBoundingClientRect().width > 1)
      .map((zone) => (zone.querySelector('[data-content-kind="negative-space"]') ? 'n' : 'c'))
      .join(''),
  )
}

/** Content zones only, measured from the DOM. */
async function contentRects(page: Page): Promise<ZoneRect[]> {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="stage-slide"] .slide-zone')]
      .filter((zone) => !zone.querySelector('[data-content-kind="negative-space"]'))
      .map((zone) => (zone as HTMLElement).dataset.nodeId),
  )
  return (await zoneRects(page)).filter((zone) => ids.includes(zone.id))
}

async function scaleOf(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number((document.querySelector('[data-testid="stage-slide"]') as HTMLElement).dataset.scale),
  )
}

/** Press `locator`'s middle, move by design-space `dx`/`dy`, optionally holding Shift. */
async function dragFrom(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
  { shift = false, release = true }: { shift?: boolean; release?: boolean } = {},
): Promise<void> {
  const scale = await scaleOf(page)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.move(x, y)
  await page.mouse.down()
  if (shift) await page.keyboard.up('Shift')
  await page.mouse.move(x + dx * scale, y + dy * scale, { steps: 10 })
  if (release) {
    await page.mouse.up()
    await page.waitForTimeout(250)
  }
}

async function handleBox(page: Page, index: number) {
  const box = await page.getByTestId('ratio-handle').nth(index).boundingBox()
  if (!box) throw new Error('no handle')
  return box
}

async function gripBox(page: Page, axis: 'x' | 'y', side: 'start' | 'end') {
  const box = await page.locator(`[data-testid="edge-grip"][data-axis="${axis}"][data-side="${side}"]`).boundingBox()
  if (!box) throw new Error('no grip')
  return box
}

/** Select a zone by clicking in it. */
async function select(page: Page, zone: ZoneRect): Promise<void> {
  const point = await slidePoint(page, zone.x + zone.w / 2, zone.y + zone.h / 2)
  await page.mouse.click(point.x, point.y)
}

test.describe('compressing zones into air', () => {
  test(
    'a divider dragged across its row compresses the whole row, and undo brings it back',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await createPresentation(page, 'Komprimering')
      await enterZoneMode(page)
      await splitSelected(page, [1, 2, 1], 'x')
      const before = await contentRects(page)

      // Down is smaller in a row: the divider pressed and pulled down.
      await dragFrom(page, await handleBox(page, 0), 0, 240)
      expect(await leafShape(page)).toBe('ncccn')
      const after = await contentRects(page)
      // Centred, smaller, and in the same proportions.
      const row = (rects: ZoneRect[]) => rects[2].x + rects[2].w - rects[0].x
      expect(row(after)).toBeLessThan(row(before))
      expect(after[0].x - before[0].x).toBeCloseTo(before[2].x + before[2].w - (after[2].x + after[2].w), 0)
      expect(after[1].w / after[0].w).toBeCloseTo(2, 1)

      // A second compression from the other divider reuses the same air.
      await dragFrom(page, await handleBox(page, 2), 0, 100)
      expect(await leafShape(page)).toBe('ncccn')

      await page.getByTestId('undo').click()
      await page.getByTestId('undo').click()
      expect(await leafShape(page)).toBe('ccc')
      for (const [index, zone] of (await contentRects(page)).entries()) {
        expect(zone.w).toBeCloseTo(before[index].w, 0)
      }
      await page.getByTestId('redo').click()
      expect(await leafShape(page)).toBe('ncccn')
      expect(guard.errors).toEqual([])
    },
  )

  test('an outer edge compresses from its own side, and Shift from both', async ({ page }) => {
    await createPresentation(page, 'Ytterkant')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'y')
    const [top] = await zoneRects(page)
    await select(page, top)

    // The top zone's left edge, across its column: air beside it alone.
    await dragFrom(page, await gripBox(page, 'x', 'start'), 200, 0)
    expect(await leafShape(page)).toBe('ncc')
    await page.getByTestId('undo').click()
    expect(await leafShape(page)).toBe('cc')

    await select(page, top)
    await dragFrom(page, await gripBox(page, 'x', 'start'), 150, 0, { shift: true })
    expect(await leafShape(page)).toBe('ncnc')
    const [compressed] = await contentRects(page)
    expect(compressed.x - top.x).toBeCloseTo(top.x + top.w - (compressed.x + compressed.w), 0)
  })

  test('the air comes and goes while the pointer is down, and Escape leaves everything as it was', async ({
    page,
  }) => {
    await createPresentation(page, 'Reversering')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')
    const before = await contentRects(page)
    const handle = await handleBox(page, 1)
    const scale = await scaleOf(page)
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 200 * scale, { steps: 8 })
    expect(await leafShape(page)).toBe('ncccn')
    await expect(stage(page).getByTestId('drag-block')).toBeVisible()
    // Back to the start: the air has no room and is not drawn.
    await page.mouse.move(x, y, { steps: 8 })
    expect(await leafShape(page)).toBe('ccc')
    await page.mouse.move(x, y + 120 * scale, { steps: 8 })
    expect(await leafShape(page)).toBe('ncccn')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await leafShape(page)).toBe('ccc')
    for (const [index, zone] of (await contentRects(page)).entries()) {
      expect(zone.x).toBeCloseTo(before[index].x, 1)
      expect(zone.w).toBeCloseTo(before[index].w, 1)
    }
    // Nothing was recorded: one undo takes back the split itself.
    await page.getByTestId('undo').click()
    expect(await leafShape(page)).toBe('c')
  })

  test('Shift on a divider rescales the two halves and keeps each one’s insides', async ({ page }) => {
    await createPresentation(page, 'Shift-skille')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3, 4, 3, 2], 'x')
    const before = await contentRects(page)
    await dragFrom(page, await handleBox(page, 2), -80, 0, { shift: true })
    const after = await contentRects(page)
    expect(after[2].x + after[2].w).toBeLessThan(before[2].x + before[2].w - 30)
    expect(after[1].w / after[0].w).toBeCloseTo(before[1].w / before[0].w, 1)
    expect(after[2].w / after[0].w).toBeCloseTo(before[2].w / before[0].w, 1)
    expect(after[4].w / after[3].w).toBeCloseTo(before[4].w / before[3].w, 1)
  })
})
