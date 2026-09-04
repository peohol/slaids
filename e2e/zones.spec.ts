import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  G,
  addContentToZone,
  clickSlide,
  clickZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  expectGap,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#4d6680"/></svg>`

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
    await clickZone(page, right)
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
    await clickZone(page, zones[0])
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
    await clickZone(page, before[1])
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

  test('never replaces container content by re-picking the active type', async ({ page }) => {
    await createPresentation(page, 'Beholdertype')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).click()
    await page.keyboard.type('Tekst som ikke skal forsvinne')

    await enterZoneMode(page)
    await clickZone(page, zones[0])

    // The already-active type is a no-op, not a reset.
    await page.getByTestId('container-payload-richdoc').click()
    await expect(page.getByTestId('confirm-dialog')).toBeHidden()
    await expect(stage(page)).toContainText('Tekst som ikke skal forsvinne')

    // Filling the zone with a picture instead is a real replacement, and the
    // text it displaces lands in the sandbox rather than being thrown away.
    await page.getByTestId('inspector-action-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'figur.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(stage(page).locator('img.asset-image')).toBeVisible()
    await expect(stage(page)).not.toContainText('Tekst som ikke skal forsvinne')
    await page.getByTestId('open-sandbox').click()
    await expect(
      page.getByTestId('sandbox-window').getByText('Tekst som ikke skal forsvinne'),
    ).toHaveCount(1)
  })

  test('divides a container into subfields with its own dividers', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Beholder med subfelt')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Første felt')

    await enterZoneMode(page)
    await clickZone(page, zones[0])
    await page.getByTestId('subfield-count').fill('3')
    await expect(stage(page).locator('.subfield')).toHaveCount(3)
    await expect(stage(page).locator('.subfield-divider')).toHaveCount(2)

    // The divider follows the text the background dictates, not a card palette.
    const divider = await stage(page)
      .locator('.subfield-divider')
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(divider).toBe('rgba(255, 255, 255, 0.28)')

    await enterContentMode(page)
    const fields = stage(page).locator('.subfield .tiptap')
    await fields.nth(2).click()
    await page.keyboard.type('Tredje felt')

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(stage(page)).toContainText('Første felt')
    await expect(stage(page)).toContainText('Tredje felt')
    expect(guard.errors).toEqual([])
  })

  test('lays subfields side by side, in the ratio the inspector asks for', async ({ page }) => {
    // The editor half of the subfield layout an agent reaches through
    // `adjust_subfields`: same commands, same guard, and here measured on the
    // real DOM rather than the estimator.
    const guard = watchForErrors(page)
    await createPresentation(page, 'Subfeltretning')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')

    await enterZoneMode(page)
    await clickZone(page, zones[0])
    await page.getByTestId('subfield-count').fill('2')
    await expect(stage(page).locator('.subfield')).toHaveCount(2)

    // Stacked by default: one column, two rows.
    const stacked = await subfieldBoxes(page)
    expect(Math.abs(stacked[0].x - stacked[1].x)).toBeLessThan(1)
    expect(stacked[1].y).toBeGreaterThan(stacked[0].y + stacked[0].height - 1)

    await page.getByTestId('subfield-axis-x').click()
    const columns = await subfieldBoxes(page)
    expect(Math.abs(columns[0].y - columns[1].y)).toBeLessThan(1)
    expect(columns[1].x).toBeGreaterThan(columns[0].x + columns[0].width - 1)
    expect(Math.abs(columns[0].width - columns[1].width)).toBeLessThan(1)

    // Three to one, measured rather than asserted from the stored number.
    await page.getByTestId('subfield-weight-0').fill('3')
    await expect
      .poll(async () => {
        const boxes = await subfieldBoxes(page)
        return Math.round((boxes[0].width / boxes[1].width) * 10) / 10
      })
      .toBe(3)

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    const reloaded = await subfieldBoxes(page)
    expect(Math.abs(reloaded[0].y - reloaded[1].y)).toBeLessThan(1)
    expect(reloaded[0].width / reloaded[1].width).toBeGreaterThan(2.8)
    expect(guard.errors).toEqual([])
  })

  test('follows the zone being edited in content mode', async ({ page }) => {
    await createPresentation(page, 'Sonepanel')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await addContentToZone(page, zones[1].id, 'untitled-card')

    // Select the right zone in zone mode, then edit the left one.
    await enterZoneMode(page)
    await clickZone(page, zones[1])
    await enterContentMode(page)
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).first().click()

    // The panel is about the zone the caret is in, not the one selected before.
    await expect(page.getByTestId('inspector')).toContainText(
      `${Math.round(zones[0].w)} × ${Math.round(zones[0].h)} px`,
    )
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
    await clickZone(page, zones[0])
    await page.getByTestId('inspector-action-sandbox').click()
    await expect(page.getByTestId('sandbox-window')).toBeVisible()
    await expect(page.getByTestId('sandbox-item')).toHaveCount(1)
    await expect(page.getByTestId('sandbox-window').getByText('Innhold som skal reddes')).toHaveCount(1)
  })
})

/** Every subfield's box on the stage, in viewport pixels, in document order. */
async function subfieldBoxes(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }[]> {
  return stage(page)
    .locator('.subfield')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }),
    )
}
