import { expect, test } from '@playwright/test'
import {
  addContentToZone,
  createPresentation,
  enterZoneMode,
  splitSelected,
  stage,
  watchForErrors,
  zoneRects,
} from './helpers'

test.describe('content fit', () => {
  test('rejects a slide title that does not fit on one line', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Tittelgrense')
    const editor = stage(page).locator('[data-testid="slide-title"] .tiptap')
    await editor.click()
    await page.keyboard.insertText('Dette er en overskrift som helt sikkert er altfor lang '.repeat(3))

    await expect(page.getByTestId('toast')).toBeVisible()
    const overflow = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="slide-title"]') as HTMLElement
      return element.scrollWidth - element.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
    expect(guard.errors).toEqual([])
  })

  test('rejects body text that would overflow its zone', async ({ page }) => {
    await createPresentation(page, 'Innholdsgrense')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')
    await page.getByTestId('mode-content').click()

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .subfield .tiptap`)
    await field.click()
    // insertText lands in one transaction, which is what a paste looks like.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.insertText('Dette er en setning som fyller opp sonen ganske raskt. '.repeat(12))
    }

    await expect(page.getByTestId('toast')).toBeVisible()
    const overflow = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
      let worst = 0
      for (const element of stage.querySelectorAll<HTMLElement>('[data-fit-scroll]')) {
        worst = Math.max(worst, element.scrollHeight - element.clientHeight)
      }
      return worst
    })
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('never paints content outside its zone', async ({ page }) => {
    await createPresentation(page, 'Klipping')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const clipped = await page.evaluate(() => {
      const zone = document.querySelector(
        '[data-testid="stage-slide"] .slide-zone',
      ) as HTMLElement
      return getComputedStyle(zone).overflow
    })
    expect(clipped).toBe('hidden')
  })
})
