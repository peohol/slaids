import { expect, test } from './fixtures'
import { addContentToZone, backToLibrary, chooseFromToolbarMenu, createPresentation, stage, zoneRects } from './helpers'

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

test('bruker forfatter og år i eksisterende titler, referanseslides og visning', { tag: '@pr' }, async ({ page }) => {
  await createPresentation(page, 'Henvisningsformat')
  const title = stage(page).getByTestId('slide-title')
  const author = Array.from({ length: 12 }, () => 'Forfatter med langt navn').join(' ')
  const label = `${author}, 2024`
  await title.locator('.tiptap').click()
  await page.keyboard.type('Påstand')
  await chooseFromToolbarMenu(page, 'presentation', 'open-references')
  const references = page.getByTestId('reference-modal')
  await references.getByTestId('reference-title').fill('En viktig kilde')
  await references.getByLabel('Forfatter(e)').fill(author)
  await references.getByLabel('År').fill('2024')
  await references.getByTestId('save-reference').click()
  await references.getByRole('button', { name: 'Lukk' }).click()
  await expect(title.locator('.rd-citation')).toHaveText('1')

  await backToLibrary(page)
  await page.getByRole('button', { name: 'Brukerinnstillinger' }).click()
  const settings = page.getByTestId('user-settings-modal')
  const format = settings.getByRole('combobox', { name: 'Henvisninger på slides' })
  await expect(format).toHaveValue('numbered')
  await format.selectOption('author-year')
  await expect(format).toHaveValue('author-year')
  await settings.getByRole('button', { name: 'Lukk' }).click()
  await page.getByTestId('open-presentation').filter({ hasText: 'Henvisningsformat' }).click()
  await page.reload()

  await expect(title.locator('.rd-citation')).toHaveText(label)
  await expect(stage(page).locator('.zone-fit[data-fit-scale] .slide-title')).toHaveCount(1)
  await expect.poll(() => title.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThan(2)
  await page.getByTestId('present').click()
  const player = page.getByTestId('present-view')
  await expect(player.locator('.rd-citation')).toHaveText(label)
  await expect(player.locator('.zone-fit[data-fit-scale] .slide-title')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await expect(player).toContainText(`${label} — En viktig kilde`)
})
