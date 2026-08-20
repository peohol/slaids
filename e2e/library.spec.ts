import { expect, test } from '@playwright/test'
import { createPresentation, watchForErrors } from './helpers'

test.describe('presentation library', () => {
  test('creates, opens and lists a presentation', async ({ page }) => {
    const guard = watchForErrors(page)
    await page.goto('/')
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
    await expect(page.getByTestId('presentation-card')).toHaveCount(0)

    await page.getByTestId('new-presentation').click()
    await expect(page.getByTestId('new-presentation-modal')).toBeVisible()
    await expect(page.getByTestId('create-presentation')).toBeDisabled()
    await page.getByTestId('presentation-title-input').fill('Første presentasjon')
    await page.getByTestId('create-presentation').click()

    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('presentation-title')).toHaveText('Første presentasjon')

    await page.getByTestId('back-to-library').click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    expect(guard.errors).toEqual([])
  })

  test('renames, duplicates and deletes', async ({ page }) => {
    await createPresentation(page, 'Original')
    await page.getByTestId('back-to-library').click()

    await page.getByTestId('rename-presentation').click()
    await page.getByTestId('rename-input').fill('Nytt navn')
    await page.getByTestId('rename-confirm').click()
    await expect(page.getByText('Nytt navn')).toBeVisible()

    await page.getByTestId('duplicate-presentation').click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(2)
    await expect(page.getByText('Nytt navn (kopi)')).toBeVisible()

    await page.getByTestId('delete-presentation').first().click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
  })

  test('remembers the open presentation across a reload', async ({ page }) => {
    await createPresentation(page, 'Husk meg')
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('presentation-title')).toHaveText('Husk meg')
  })

  test('organises presentations in folders', async ({ page }) => {
    await createPresentation(page, 'I mappe')
    await page.getByTestId('back-to-library').click()

    page.once('dialog', (dialog) => void dialog.accept('Kundemøter'))
    await page.getByTestId('new-folder').click()
    const folder = page.getByTestId('folder-item')
    await expect(folder).toHaveText(/Kundemøter \(0\)/)

    await page.getByTestId('folder-select').selectOption({ label: 'Kundemøter' })
    await expect(folder).toHaveText(/Kundemøter \(1\)/)

    await folder.click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)

    // Deleting the folder keeps the presentation, just without a folder.
    await page.getByLabel('Slett mappen Kundemøter').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    await expect(page.getByTestId('folder-item')).toHaveCount(0)
  })

  test('exports a presentation to a .slaids file', async ({ page }) => {
    await createPresentation(page, 'Eksport')
    await page.getByTestId('back-to-library').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('export-presentation').click()
    const file = await download
    expect(file.suggestedFilename()).toBe('eksport.slaids')
  })
})
