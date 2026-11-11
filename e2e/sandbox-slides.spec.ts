import { expect, test } from './fixtures'
import {
  chooseFromToolbarMenu,
  chooseSlideAction,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  openSlideMenu,
  splitSelected,
  stage,
  waitForSaved,
  zoneRects,
} from './helpers'

test('parkerer en hel slide og setter den tilbake med samme soner', async ({ page }) => {
  await createPresentation(page, 'Parkerte slides')
  const title = stage(page).getByTestId('slide-title').locator('[contenteditable]')
  await title.click()
  await page.keyboard.type('Slide som skal tilbake')
  await enterZoneMode(page)
  await splitSelected(page, [1, 2], 'x')
  await enterContentMode(page)
  const zones = (await zoneRects(page)).map(({ id }) => id)
  const slides = page.getByTestId('filmstrip-item')

  const frontMenu = await openSlideMenu(page, 0)
  await expect(frontMenu.getByTestId('move-slide-to-sandbox')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await chooseSlideAction(page, 1, 'move-slide-to-sandbox')
  await expect(slides).toHaveCount(1)
  await expect(page.getByTestId('sandbox-slide').getByRole('button', { name: /Slide som skal tilbake/ })).toBeVisible()
  await waitForSaved(page)
  await page.reload()
  await expect(slides).toHaveCount(1)
  if (!(await page.getByTestId('sandbox-window').isVisible())) {
    await chooseFromToolbarMenu(page, 'tools', 'open-sandbox')
  }
  await page.getByTestId('sandbox-restore-slide').click()
  await expect(slides).toHaveCount(2)
  await expect(title).toHaveText('Slide som skal tilbake')
  expect((await zoneRects(page)).map(({ id }) => id)).toEqual(zones)
  await page.keyboard.press('Control+z')
  await expect(slides).toHaveCount(1)
})
