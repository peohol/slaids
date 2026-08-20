import { expect, test } from '@playwright/test'
import {
  addContentToZone,
  createPresentation,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

test.describe('presentation mode', () => {
  test('navigates slides with the keyboard and exits with Escape', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Visning')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toBeVisible()
    await expect(page.getByTestId('present-counter')).toHaveText('3 / 3')

    await page.keyboard.press('Home')
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 3')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('present-counter')).toHaveText('2 / 3')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 3')
    await page.keyboard.press('End')
    await expect(page.getByTestId('present-counter')).toHaveText('3 / 3')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    expect(guard.errors).toEqual([])
  })

  test('renders the same content as the editor', async ({ page }) => {
    await createPresentation(page, 'Samme innhold')
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Tittel i visning')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Innhold i visning')
    await waitForSaved(page)

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toContainText('Tittel i visning')
    await expect(page.getByTestId('present-view')).toContainText('Innhold i visning')
  })

  test('appends a derived reference slide when a reference is cited', async ({ page }) => {
    await createPresentation(page, 'Referanser')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Påstand med kilde')

    await page.getByTestId('insert-reference').click()
    await expect(page.getByTestId('reference-modal')).toBeVisible()
    await page.getByTestId('reference-title').fill('En viktig kilde')
    await page.getByTestId('save-reference').click()
    await page.getByRole('button', { name: 'Lukk' }).click()

    await expect(stage(page).locator('.rd-citation')).toHaveCount(1)

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 2')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('present-view')).toContainText('Referanser')
    await expect(page.getByTestId('present-view')).toContainText('En viktig kilde')
  })
})
