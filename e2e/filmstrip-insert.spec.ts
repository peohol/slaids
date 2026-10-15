import { expect, test, type Page } from './fixtures'
import { createPresentation, watchForErrors } from './helpers'

/** Adds `count` untitled slides after the current one. */
async function addSlides(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
  }
}

/** The gap above the strip entry at `index`. */
function gapAbove(page: Page, index: number) {
  return page.getByTestId('filmstrip-insert').nth(index - 1)
}

async function boxOf(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('not laid out')
  return box
}

test('the three new-page buttons are icons on one row, named by their tooltips', async ({
  page,
}) => {
  await createPresentation(page, 'Tre dører')
  const buttons = [
    page.getByTestId('add-slide'),
    page.getByTestId('add-section'),
    page.getByTestId('add-interactive'),
  ]
  const names = ['Ny slide', 'Ny inndeling', 'Ny miniapp']
  const tops: number[] = []
  for (const [index, button] of buttons.entries()) {
    await expect(button).toHaveAccessibleName(names[index])
    await expect(button).toHaveText('')
    await expect(button.locator('svg')).toHaveCount(1)
    tops.push((await boxOf(button)).y)
  }
  expect(new Set(tops).size).toBe(1)

  // No longer the coloured doors they were: all three are drawn alike.
  const backgrounds = await Promise.all(
    buttons.map((button) => button.evaluate((element) => getComputedStyle(element).backgroundColor)),
  )
  expect(new Set(backgrounds).size).toBe(1)
})

test('resting the pointer between two slides opens a place to put a new page there', async ({
  page,
}) => {
  const guard = watchForErrors(page)
  await createPresentation(page, 'Mellom to')
  // A new deck is its front page and one slide; this makes it four.
  await addSlides(page, 2)
  await expect(page.getByTestId('statusbar')).toContainText('Slide 4 av 4')
  const items = page.getByTestId('filmstrip-item')

  // Between slide 2 and 3: the gap lights up at once…
  const gap = gapAbove(page, 2)
  // `hover` waits for the strip to stop scrolling to the new slide first.
  await gap.hover()
  const lowerBefore = await boxOf(items.nth(2))
  await expect
    .poll(() => gap.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe('rgba(0, 0, 0, 0)')
  await expect(gap).not.toHaveAttribute('data-open')

  // …and opens once the pointer has rested there: the slide below moves down,
  // and the button sits in the middle of the room it made.
  await expect(gap).toHaveAttribute('data-open', '')
  await expect.poll(async () => (await boxOf(items.nth(2))).y).toBeGreaterThan(lowerBefore.y + 20)
  const button = page.getByTestId('filmstrip-insert-button')
  await expect(button).toBeVisible()
  const buttonBox = await boxOf(button)
  const upper = await boxOf(items.nth(1))
  const lower = await boxOf(items.nth(2))
  expect(Math.abs(buttonBox.x + buttonBox.width / 2 - (upper.x + upper.width / 2))).toBeLessThan(1.5)
  expect(buttonBox.y).toBeGreaterThan(upper.y + upper.height)
  expect(buttonBox.y + buttonBox.height).toBeLessThan(lower.y)

  await button.click()
  const menu = page.getByTestId('filmstrip-insert-menu')
  await expect(menu.getByRole('button')).toHaveText(['Ny slide', 'Ny inndeling', 'Ny miniapp'])
  await expect(menu.locator('svg')).toHaveCount(3)

  // A new section, put exactly there.
  await page.getByTestId('insert-section').click()
  await page.getByTestId('section-title-input').fill('Del to')
  await page.getByTestId('create-section').click()
  await expect(items).toHaveCount(5)
  await expect(page.getByTestId('statusbar')).toContainText('Inndeling 3 av 5')
  await expect(items.nth(2).locator('.filmstrip__badge')).toHaveText('Inndeling')
  await expect(items.nth(2)).toHaveClass(/filmstrip__item--active/)

  // Leaving the gap closes it again.
  await page.mouse.move(0, 0)
  await expect(page.locator('.filmstrip-insert[data-open]')).toHaveCount(0)
  expect(guard.errors).toEqual([])
})

test('a pointer only passing between two slides opens nothing', async ({ page }) => {
  await createPresentation(page, 'Forbi')
  await addSlides(page, 1)
  const gap = gapAbove(page, 1)
  await gap.hover()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(500)
  await expect(gap).not.toHaveAttribute('data-open')
})

test('a slide added from the gap goes between the two, not after the current slide', async ({
  page,
}) => {
  await createPresentation(page, 'Ny slide mellom')
  await addSlides(page, 2)
  // The current slide is the last one; the new one still goes where it was asked for.
  await gapAbove(page, 1).hover()
  await page.getByTestId('filmstrip-insert-button').click()
  await page.getByTestId('insert-slide').click()
  await page.getByTestId('new-slide-without-title').click()
  await expect(page.getByTestId('filmstrip-item')).toHaveCount(5)
  await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 5')
})

test('deleting the current slide goes to the one before it, not to the front page', async ({
  page,
}) => {
  await createPresentation(page, 'Slett og bli')
  await addSlides(page, 2)
  const items = page.getByTestId('filmstrip-item')
  await items.nth(2).getByTestId('filmstrip-thumb').click()
  await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 4')

  // The active slide is the third, so the one before it — not the front page —
  // is where the editor lands.
  await items.nth(2).getByTestId('delete-slide').click()
  await page.getByTestId('confirm-accept').click()
  await expect(items).toHaveCount(3)
  await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')
  await expect(items.nth(1)).toHaveClass(/filmstrip__item--active/)
})
