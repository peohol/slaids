/**
 * The right-click menu in zone mode.
 *
 * What a menu offers is unit-tested against the domain commands it asks; what
 * is checked here is what only a browser can say: that the menu is about the
 * zone under the pointer, that choosing from it changes the slide and never
 * the mode, that the keyboard reaches it, and that it stays on screen.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  G,
  clickZone,
  createPresentation,
  enterZoneMode,
  slidePoint,
  splitSelected,
  watchForErrors,
  zoneRects,
  type ZoneRect,
} from './helpers'

const menu = (page: Page) => page.getByTestId('context-menu')

async function rightClickAt(page: Page, x: number, y: number): Promise<void> {
  const point = await slidePoint(page, x, y)
  await page.mouse.click(point.x, point.y, { button: 'right' })
}

async function rightClickZone(page: Page, zone: ZoneRect): Promise<void> {
  await rightClickAt(page, zone.x + zone.w / 2, zone.y + zone.h / 2)
}

/** The zones once the slide shows `count` of them: a choice lands on the next render, not at once. */
async function zonesOnceThere(page: Page, count: number): Promise<ZoneRect[]> {
  await expect.poll(async () => (await zoneRects(page)).length).toBe(count)
  return zoneRects(page)
}

async function expectZoneMode(page: Page): Promise<void> {
  await expect(page.getByTestId('mode-zone')).toHaveClass(/btn--active/)
  await expect(page.getByTestId('zone-overlay')).toBeVisible()
}

test.describe('context menu in zone mode', () => {
  test('splits the zone under the pointer, and stays in zone mode', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)

    const [main] = await zoneRects(page)
    await rightClickZone(page, main)
    await expect(menu(page)).toBeVisible()
    await expect(menu(page)).toContainText('Tom sone')

    await page.getByTestId('menu-split').click()
    await page.getByTestId('menu-split-x').click()
    await expect(menu(page)).toBeHidden()

    const zones = await zonesOnceThere(page, 2)
    expect(zones[0].w).toBeCloseTo(zones[1].w, 0)
    await expectZoneMode(page)
    expect(guard.errors).toEqual([])
  })

  test('acts on the zone under the pointer, not the one selected before', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const [left, right] = await zoneRects(page)
    await clickZone(page, left)
    await rightClickZone(page, right)
    await page.getByTestId('menu-duplicate').click()

    const zones = await zonesOnceThere(page, 3)
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(3)
    // The copy sits right after the zone it was made from, and is selected.
    expect(zones[0].id).toBe(left.id)
    expect(zones[1].id).toBe(right.id)
    await expect(page.locator(`[data-node-outline="${zones[2].id}"]`)).toHaveClass(/zone-outline--selected/)
    await expectZoneMode(page)
  })

  test('sets a split’s ratio from the gap between its zones', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const [left, right] = await zoneRects(page)
    await rightClickAt(page, left.x + left.w + G / 2, left.y + left.h / 2)
    await expect(menu(page)).toContainText('Delt sone')
    await expect(page.getByTestId('menu-equalize')).toHaveAttribute('data-disabled', '')

    await page.getByTestId('menu-ratios').click()
    await page.getByTestId('menu-ratio-1-2').click()

    await expect
      .poll(async () => {
        const [a, b] = await zoneRects(page)
        return b.w / a.w
      })
      .toBeCloseTo(2, 1)
    const [a, b] = await zoneRects(page)
    expect(a.w + b.w).toBeCloseTo(left.w + right.w, 0)
  })

  test('asks before deleting a zone', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const [, right] = await zoneRects(page)
    await rightClickZone(page, right)
    await page.getByTestId('menu-delete').click()
    const dialog = page.getByTestId('confirm-dialog')
    await expect(dialog).toBeVisible()
    // The question has the focus, not the slide behind it.
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    expect(await zoneRects(page)).toHaveLength(2)
    await page.getByTestId('confirm-accept').click()
    await zonesOnceThere(page, 1)
  })

  test('opens from the keyboard on the selected zone and closes without leaving zone mode', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    const [left] = await zoneRects(page)
    await clickZone(page, left)

    await page.keyboard.press('Shift+F10')
    await expect(menu(page)).toBeVisible()
    await expect(menu(page)).toContainText('Tom sone')
    await expect(page.getByTestId('menu-add-content')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('menu-paste')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu(page)).toBeHidden()
    await expectZoneMode(page)
  })

  test('stays inside the window when opened in its corner', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    const [main] = await zoneRects(page)
    await rightClickAt(page, main.x + main.w - 4, main.y + main.h - 4)

    const box = await menu(page).boundingBox()
    const viewport = page.viewportSize()
    if (!box || !viewport) throw new Error('the menu has no box')
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  })
})
