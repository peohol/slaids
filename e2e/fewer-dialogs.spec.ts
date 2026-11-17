import { expect, test } from './fixtures'
import {
  addContentToZone,
  backToLibrary,
  chooseFromToolbarMenu,
  choosePresentationAction,
  chooseSlideAction,
  clickZone,
  createPresentation,
  drawnSmaller,
  enterZoneMode,
  setUserSetting,
  stage,
  zoneRects,
} from './helpers'

test('færre popuper for angrebare handlinger, med bekreftelse for permanent sletting', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Brukerinnstillinger' }).click()
  const option = page.getByRole('checkbox', { name: 'Færre popuper' })
  await expect(option).not.toBeChecked()
  await option.click()
  // Lagret når avkrysningen er tilgjengelig igjen; først da gjelder valget.
  await expect(option).toBeEnabled()
  await expect(option).toBeChecked()
  await page.getByTestId('user-settings-modal').getByRole('button', { name: 'Lukk', exact: true }).click()

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

test('hurtigdeling beholder tekst i sliden når første barn krever forminskning', async ({ page }) => {
  await page.goto('/')
  await setUserSetting(page, 'Færre popuper', true)

  await createPresentation(page, 'Behold tekst ved hurtigdeling')
  const [root] = await zoneRects(page)
  await addContentToZone(page, root.id, 'container')
  const text = 'Dette er en setning med noen helt vanlige ord i seg. '.repeat(18).trim()
  const field = stage(page).locator('.tiptap').last()
  await field.fill(text)
  await expect(field).toHaveText(text)
  await expect.poll(() => drawnSmaller(field)).toBe(false)

  await enterZoneMode(page)
  await page.getByTestId('zone-action-split').click()
  await expect(page.getByTestId('split-modal')).toBeHidden()
  const [left, right] = await zoneRects(page)
  expect(left.x).toBeLessThan(right.x)
  expect(left.w).toBeCloseTo(right.w)
  const keptField = stage(page).locator(`.slide-zone[data-node-id="${left.id}"] .rich-doc`).last()
  await expect(keptField).toHaveText(text)
  await expect.poll(() => drawnSmaller(keptField)).toBe(true)
  await chooseFromToolbarMenu(page, 'tools', 'open-sandbox')
  await expect(page.getByTestId('sandbox-item')).toHaveCount(0)
})
