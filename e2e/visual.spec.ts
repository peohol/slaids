import { expect, test } from '@playwright/test'
import {
  addContentToZone,
  clickSlide,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  zoneRects,
} from './helpers'

/**
 * Visual regression.
 *
 * Pixel baselines are only meaningful in a fixed environment (same OS, same
 * fonts), so this suite is opt-in. Run it with `SLAIDS_VISUAL=1 npm run e2e`
 * and refresh baselines with `SLAIDS_VISUAL=1 npm run e2e -- --update-snapshots`.
 */
test.describe('visual regression', () => {
  test.skip(!process.env.SLAIDS_VISUAL, 'Set SLAIDS_VISUAL=1 to run visual regression.')

  test('representative slide states', async ({ page }) => {
    await createPresentation(page, 'Visuell')
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Visuell regresjon')

    await enterZoneMode(page)
    await splitSelected(page, [2, 3], 'x')
    const afterFirst = await zoneRects(page)
    await clickSlide(page, afterFirst[1].x + 40, afterFirst[1].y + 40)
    await splitSelected(page, [1, 2], 'y')

    await expect(stage(page)).toHaveScreenshot('zone-mode.png', { maxDiffPixelRatio: 0.02 })

    const [left, topRight, bottomRight] = await zoneRects(page)
    await enterContentMode(page)
    await addContentToZone(page, left.id, 'titled-card')
    await addContentToZone(page, topRight.id, 'container')
    await addContentToZone(page, bottomRight.id, 'untitled-card')
    await stage(page).locator(`.slide-zone[data-node-id="${left.id}"] .card-header .tiptap`).click()
    await page.keyboard.type('Venstre kort')

    await expect(stage(page)).toHaveScreenshot('content-mode.png', { maxDiffPixelRatio: 0.02 })

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toBeVisible()
    await expect(page.getByTestId('present-view')).toHaveScreenshot('present-mode.png', {
      maxDiffPixelRatio: 0.02,
    })
  })
})
