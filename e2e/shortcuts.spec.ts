import { expect, test } from './fixtures'
import { createPresentation, splitSelected, watchForErrors, zoneRects } from './helpers'

test.describe('keyboard shortcuts', () => {
  test('Ctrl+E toggles zone mode and F5 starts the presentation', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Hurtigtaster')
    await expect(page.getByTestId('zone-overlay')).toBeHidden()

    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('zone-overlay')).toBeVisible()
    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('zone-overlay')).toBeHidden()

    await page.keyboard.press('F5')
    await expect(page.getByTestId('present-view')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    expect(guard.errors).toEqual([])
  })

  test('Ctrl+Z undoes a structural change from the keyboard', async ({ page }) => {
    await createPresentation(page, 'Angre med tast')
    await page.keyboard.press('Control+e')
    await splitSelected(page, [1, 1], 'x')
    expect(await zoneRects(page)).toHaveLength(2)

    await page.keyboard.press('Control+z')
    expect(await zoneRects(page)).toHaveLength(1)
    await page.keyboard.press('Control+Shift+z')
    expect(await zoneRects(page)).toHaveLength(2)
  })

  test('shows the shortcut reference', async ({ page }) => {
    await createPresentation(page, 'Referanse for taster')
    await page.getByTestId('show-shortcuts').click()
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible()
    await expect(page.getByTestId('shortcuts-modal')).toContainText('Ctrl + E')
    await expect(page.getByTestId('shortcuts-modal')).toContainText('Soneredigering')
  })
})
