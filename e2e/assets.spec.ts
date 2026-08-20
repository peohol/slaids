import { expect, test } from '@playwright/test'
import {
  addContentToZone,
  createPresentation,
  enterZoneMode,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#4d6680"/><circle cx="50" cy="30" r="20" fill="#d9ccbf"/></svg>`

test.describe('assets', () => {
  test('uploads an SVG into a zone and keeps it after a reload', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Figurer')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-image').click()
    await expect(page.getByTestId('image-modal')).toBeVisible()

    await page.getByTestId('image-input').setInputFiles({
      name: 'figur.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })

    await expect(page.getByTestId('image-modal')).toBeHidden()
    const image = stage(page).locator('img.asset-image')
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', /^blob:/)

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(stage(page).locator('img.asset-image')).toBeVisible()
    expect(guard.errors).toEqual([])
  })

  test('inserts an image inline in a card body', async ({ page }) => {
    await createPresentation(page, 'Inline bilde')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()

    await page.getByTestId('open-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'inline.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })

    await expect(stage(page).locator('.rd-image-wrapper img')).toBeVisible()
  })

  test('exports and re-imports a presentation with its assets', async ({ page }) => {
    await createPresentation(page, 'Med figur')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'figur.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(stage(page).locator('img.asset-image')).toBeVisible()
    await waitForSaved(page)

    await page.getByTestId('back-to-library').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('export-presentation').click()
    const file = await download
    const path = await file.path()

    await page.getByTestId('import-input').setInputFiles(path)
    await expect(page.getByTestId('presentation-card')).toHaveCount(2)

    await page.getByTestId('open-presentation').first().click()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(stage(page).locator('img.asset-image')).toBeVisible()
  })
})
