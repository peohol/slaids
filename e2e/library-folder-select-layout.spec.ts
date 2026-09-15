import { expect, test } from './fixtures'
import { createPresentation } from './helpers'

test('folder picker stays inside a narrow card and fades only clipped names', async ({ page }) => {
  // Stay just above the compact breakpoint while making the desktop card as
  // narrow as it gets. This is the width where the old fixed 200 px select
  // could protrude through the card's right edge.
  await page.setViewportSize({ width: 1025, height: 900 })
  await createPresentation(page, 'Mappekort')
  await page.getByTestId('back-to-library').click()

  page.once('dialog', (dialog) => void dialog.accept('Kort'))
  await page.getByTestId('new-folder').click()
  await page.getByTestId('folder-select').selectOption({ label: 'Kort' })

  const card = page.getByTestId('presentation-card').first()
  const picker = card.getByTestId('folder-select-shell')
  const fade = picker.locator('.folder-select__fade')
  await expect(picker).toHaveAttribute('data-overflow', 'false')
  expect(await fade.evaluate((element) => getComputedStyle(element).opacity)).toBe('0')

  const longName = 'Mappe med et svært langt navn som må forkortes visuelt i kortet'
  page.once('dialog', (dialog) => void dialog.accept(longName))
  await page.getByTestId('new-folder').click()
  await page.getByTestId('folder-select').selectOption({ label: longName })

  await expect(picker).toHaveAttribute('data-overflow', 'true')
  expect(await fade.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')

  const cardBox = await card.boundingBox()
  const pickerBox = await picker.boundingBox()
  const chevronBox = await picker.locator('.folder-select__chevron').boundingBox()
  if (!cardBox || !pickerBox || !chevronBox) throw new Error('Kunne ikke måle mappefeltet.')

  // The control remains inside the card and its footer padding instead of
  // being clipped by the card's overflow boundary.
  expect(pickerBox.x).toBeGreaterThanOrEqual(cardBox.x + 9)
  expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width - 9)

  // The custom chevron has the same breathing room above, below and to the
  // right, which also moves it in from the browser select's old edge position.
  const top = chevronBox.y - pickerBox.y
  const bottom = pickerBox.y + pickerBox.height - (chevronBox.y + chevronBox.height)
  const right = pickerBox.x + pickerBox.width - (chevronBox.x + chevronBox.width)
  expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1)
  expect(Math.abs(right - top)).toBeLessThanOrEqual(1)
})
