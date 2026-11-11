import { expect, test } from './fixtures'
import { addContentToZone, createPresentation, stage, zoneRects } from './helpers'

test('scrolling reaches generated reference pages from the editor', async ({ page }) => {
  await createPresentation(page, 'Referanser med scroll')
  const zones = await zoneRects(page)
  await addContentToZone(page, zones[0].id, 'untitled-card')
  await stage(page).locator('.subfield .tiptap').first().click()
  await page.keyboard.type('Påstand med kilde')

  await page.getByTestId('insert-reference').click()
  await expect(page.getByTestId('reference-modal')).toBeVisible()
  await page.getByTestId('reference-title').fill('En viktig kilde')
  await page.getByTestId('save-reference').click()
  await page.getByRole('button', { name: 'Lukk' }).click()
  await expect(page.getByTestId('filmstrip-derived')).toHaveCount(1)

  // The current authored slide is the last authored page in a new deck. A
  // downward wheel step must therefore continue into the generated references,
  // rather than stopping at the end of `presentation.slides`.
  await page.getByTestId('stage-viewport').hover()
  await page.mouse.wheel(0, 120)
  await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-readonly', '')
  await expect(page.getByTestId('stage-slide')).toContainText('En viktig kilde')

  // The generated page participates in the same ordering in reverse as well.
  // The wheel recogniser deliberately cools down between two separate steps.
  await page.waitForTimeout(400)
  await page.getByTestId('stage-viewport').hover()
  await page.mouse.wheel(0, -120)
  await expect(page.getByTestId('stage-slide')).not.toHaveAttribute('data-readonly', '')
})
