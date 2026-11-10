import { expect, test } from './fixtures'
import {
  addContentToZone,
  backToLibrary,
  chooseFromToolbarMenu,
  choosePresentationAction,
  chooseSlideAction,
  clickZone,
  createPresentation,
  enterZoneMode,
  stage,
  zoneRects,
} from './helpers'

test('færre popuper for angrebare handlinger, med bekreftelse for permanent sletting', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Brukerinnstillinger' }).click()
  const option = page.getByRole('checkbox', { name: 'Færre popuper' })
  await expect(option).not.toBeChecked()
  await option.check()
  await expect(option).toBeChecked()
  await page.getByRole('button', { name: 'Lukk', exact: true }).click()

  await createPresentation(page, 'Færre popuper')
  await page.getByTestId('add-slide').click()
  await expect(page.getByTestId('new-slide-modal')).toBeHidden()
  await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')
  await expect(stage(page).getByTestId('slide-title')).toBeVisible()

  const [root] = await zoneRects(page)
  await addContentToZone(page, root.id, 'titled-card')
  await enterZoneMode(page)
  await page.getByTestId('zone-action-split').click()
  await expect(page.getByTestId('split-modal')).toBeHidden()
  const [left, right] = await zoneRects(page)
  expect(left.w).toBeCloseTo(right.w)
  expect(left.x).toBeLessThan(right.x)
  await clickZone(page, left)
  await page.getByTestId('zone-action-clear').click()
  await expect(page.getByTestId('confirm-dialog')).toBeHidden()
  await expect(stage(page).locator('[data-content-kind]')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(stage(page).locator('[data-content-kind]')).toHaveCount(1)
  await page.getByTestId('zone-action-delete').click()
  await expect(page.getByTestId('confirm-dialog')).toBeHidden()
  expect(await zoneRects(page)).toHaveLength(1)
  await expect(stage(page).locator('[data-content-kind]')).toHaveCount(0)
  await chooseFromToolbarMenu(page, 'tools', 'open-sandbox')
  await expect(page.getByTestId('sandbox-window')).toBeVisible()
  await expect(page.getByTestId('sandbox-item')).toHaveCount(0)

  await chooseSlideAction(page, 2, 'delete-slide')
  await expect(page.getByTestId('confirm-dialog')).toBeHidden()
  await expect(page.getByTestId('filmstrip-item')).toHaveCount(2)

  await backToLibrary(page)
  await choosePresentationAction(page, 'delete-presentation')
  await page.getByTestId('confirm-accept').click()
  await page.getByTestId('trash-view').click()
  await page.getByTestId('purge-presentation').click()
  await expect(page.getByRole('dialog', { name: 'Slette presentasjonen for godt?' })).toBeVisible()
})
