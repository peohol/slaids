import { expect, test } from '@playwright/test'
import {
  G,
  addContentToZone,
  clickSlide,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  expectGap,
  splitSelected,
  stage,
  watchForErrors,
  zoneRects,
} from './helpers'

test.describe('zone editing', () => {
  test('splits the main zone and keeps exactly one gap', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Soner')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3], 'x')

    const zones = await zoneRects(page)
    expect(zones).toHaveLength(2)
    expectGap(zones[1].x - (zones[0].x + zones[0].w), 'gap between siblings')
    expect(zones[1].w / zones[0].w).toBeCloseTo(1.5, 2)
    expect(guard.errors).toEqual([])
  })

  test('nests a split without introducing extra gap', async ({ page }) => {
    await createPresentation(page, 'Nesting')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3], 'x')

    const [left, right] = await zoneRects(page)
    await clickSlide(page, right.x + 40, right.y + 40)
    await splitSelected(page, [1, 2], 'y')

    const zones = await zoneRects(page)
    expect(zones).toHaveLength(3)
    const [l, topRight, bottomRight] = zones
    expectGap(topRight.x - (l.x + l.w), 'left to top-right')
    expectGap(bottomRight.x - (l.x + l.w), 'left to bottom-right')
    expectGap(bottomRight.y - (topRight.y + topRight.h), 'top-right to bottom-right')
    expect(bottomRight.h / topRight.h).toBeCloseTo(2, 1)
    expect(left.w).toBeCloseTo(l.w, 1)
  })

  test('selects the parent zone when clicking in the gap', async ({ page }) => {
    await createPresentation(page, 'Gap')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const zones = await zoneRects(page)
    await clickSlide(page, zones[0].x + 20, zones[0].y + 20)
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 1')

    const gapCentre = zones[0].x + zones[0].w + G / 2
    await clickSlide(page, gapCentre, zones[0].y + 200)
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot')
  })

  test('navigates the hierarchy with the arrow keys', async ({ page }) => {
    await createPresentation(page, 'Navigasjon')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')

    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 1')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 2')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 3')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 1')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 3')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot')
  })

  test('refuses a split that would make a zone too small', async ({ page }) => {
    await createPresentation(page, 'For liten')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-split').click()
    await page.getByTestId('split-weight-0').fill('1')
    await page.getByTestId('split-weight-1').fill('60')
    await expect(page.getByTestId('split-invalid')).toBeVisible()
    await expect(page.getByTestId('split-apply')).toBeDisabled()

    await page.getByTestId('split-weight-1').fill('abc')
    await expect(page.getByTestId('split-apply')).toBeDisabled()

    await page.getByTestId('split-weight-1').fill('2')
    await expect(page.getByTestId('split-apply')).toBeEnabled()
  })

  test('edits an existing split', async ({ page }) => {
    await createPresentation(page, 'Rediger splitting')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    // Selecting the parent again via the breadcrumb, then re-editing the split.
    await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
    await page.getByTestId('inspector-action-split').click()
    await expect(page.getByTestId('split-modal')).toBeVisible()
    await page.getByTestId('split-count').fill('3')
    await page.getByTestId('split-apply').click()

    const zones = await zoneRects(page)
    expect(zones).toHaveLength(3)
    expectGap(zones[1].x - (zones[0].x + zones[0].w), 'first gap')
    expectGap(zones[2].x - (zones[1].x + zones[1].w), 'second gap')
  })

  test('deletes a zone and lets the sibling take the space', async ({ page }) => {
    await createPresentation(page, 'Slett sone')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const before = await zoneRects(page)
    await clickSlide(page, before[1].x + 40, before[1].y + 40)
    await page.getByTestId('inspector-action-delete').click()
    await page.getByTestId('confirm-accept').click()

    const after = await zoneRects(page)
    expect(after).toHaveLength(1)
    expect(after[0].w).toBeCloseTo(1600 - G * 2, 0)
  })

  test('clears a subtree back to a single empty zone', async ({ page }) => {
    await createPresentation(page, 'Tøm sone')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')
    await expect(await zoneRects(page)).toHaveLength(3)

    await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
    await page.getByTestId('inspector-action-clear').click()
    await page.getByTestId('confirm-accept').click()

    expect(await zoneRects(page)).toHaveLength(1)
  })

  test('adjusts ratios by dragging the handle in the gap', async ({ page }) => {
    await createPresentation(page, 'Dra forhold')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const before = await zoneRects(page)
    const handle = page.getByTestId('ratio-handle').first()
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(250)

    const after = await zoneRects(page)
    expect(after[0].w).toBeGreaterThan(before[0].w + 100)
    expectGap(after[1].x - (after[0].x + after[0].w), 'gap after drag')
  })

  test('moves content to the sandbox and places it back', async ({ page }) => {
    await createPresentation(page, 'Sandkasse')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .subfield .tiptap`).click()
    await page.keyboard.type('Innhold som skal reddes')

    await enterZoneMode(page)
    await clickSlide(page, zones[0].x + 40, zones[0].y + 40)
    await page.getByTestId('inspector-action-sandbox').click()
    await expect(page.getByTestId('sandbox-window')).toBeVisible()
    await expect(page.getByTestId('sandbox-item')).toHaveCount(1)
    await expect(page.getByTestId('sandbox-window').getByText('Innhold som skal reddes')).toHaveCount(1)
  })
})
