import { expect, test, type Page } from './fixtures'
import {
  addContentToZone,
  addPage,
  chooseSlideAction,
  closeReferenceModal,
  createPresentation,
  motionSettled,
  openSlideMenu,
  stage,
  watchForErrors,
  zoneRects,
} from './helpers'

/** Adds `count` untitled slides after the current one. */
async function addSlides(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
  }
}

/** Siterer én referanse på gjeldende slide, som gir én avledet side. */
async function addReference(page: Page, title: string): Promise<void> {
  const zones = await zoneRects(page)
  await addContentToZone(page, zones[0].id, 'untitled-card')
  await stage(page).locator('.subfield .tiptap').first().click()
  await page.keyboard.type('Påstand med kilde')
  await page.getByTestId('insert-reference').click()
  await page.getByTestId('reference-title').fill(title)
  await page.getByTestId('save-reference').click()
  await closeReferenceModal(page)
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

test('«Ny slide» is the strip\'s button, says where the page goes, and the other kinds are in the menu beside it', async ({
  page,
}) => {
  await createPresentation(page, 'Tre dører')
  const add = page.getByTestId('add-slide')
  await expect(add).toHaveText('Ny slide')
  // Where the page lands is said before the press: after the slide on screen.
  const placement = page.getByTestId('new-page-placement')
  await expect(placement).toHaveText('Kommer etter slide 2')
  await page.getByTestId('filmstrip-thumb').first().click()
  await expect(placement).toHaveText('Kommer etter forsiden')

  // The menu beside it holds the two other kinds, under the same names and
  // icons as everywhere else a page is added.
  const more = page.getByTestId('add-page-menu')
  await expect(more).toHaveAccessibleName('Ny inndeling eller miniapp')
  await more.click()
  const menu = page.getByTestId('context-menu')
  await expect(menu.getByRole('menuitem')).toHaveText(['Ny inndeling', 'Ny miniapp'])
  await expect(menu.locator('.context-menu__icon svg')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  // And the dialog repeats the place, so it is still known after the press.
  await add.click()
  await expect(page.getByTestId('new-slide-modal')).toContainText('Kommer etter forsiden.')
  await page.getByTestId('new-slide-without-title').click()
  await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')

  await addPage(page, 'section')
  await expect(page.getByTestId('new-section-modal')).toContainText('Kommer etter slide 2.')
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
  // The room opens over 180 ms; where the button sits is a question about the
  // opened gap, not about a frame on the way there.
  await motionSettled(page.getByTestId('filmstrip'))
  const buttonBox = await boxOf(button)
  const upper = await boxOf(items.nth(1))
  const lower = await boxOf(items.nth(2))
  expect(Math.abs(buttonBox.x + buttonBox.width / 2 - (upper.x + upper.width / 2))).toBeLessThan(1.5)
  expect(buttonBox.y).toBeGreaterThan(upper.y + upper.height)
  expect(buttonBox.y + buttonBox.height).toBeLessThan(lower.y)

  await button.click()
  const menu = page.getByTestId('context-menu')
  await expect(menu.getByRole('menuitem')).toHaveText(['Ny slide', 'Ny inndeling', 'Ny miniapp'])
  await expect(menu.locator('.context-menu__icon svg')).toHaveCount(3)

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
  await chooseSlideAction(page, 2, 'delete-slide')
  await page.getByTestId('confirm-accept').click()
  await expect(items).toHaveCount(3)
  await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')
  await expect(items.nth(1)).toHaveClass(/filmstrip__item--active/)
})

/*
 * The same place without a pointer resting anywhere: a finger or the keyboard
 * asks the slide's own menu, and the page goes right after that slide —
 * whichever slide is on screen.
 */
test('a page put in from a slide\'s menu goes right after that slide', async ({ page }) => {
  await createPresentation(page, 'Etter denne')
  await addSlides(page, 2)
  await expect(page.getByTestId('statusbar')).toContainText('Slide 4 av 4')

  await openSlideMenu(page, 1)
  await page.getByTestId('menu-slide-insert-after').click()
  await page.keyboard.press('ArrowRight')
  const submenu = page.getByTestId('menu-slide-insert-after-content')
  await expect(submenu.getByRole('menuitem')).toHaveText(['Ny slide', 'Ny inndeling', 'Ny miniapp'])
  await submenu.getByTestId('insert-after-section').click()
  await expect(page.getByTestId('new-section-modal')).toContainText('Kommer etter slide 2.')
  await page.getByTestId('section-title-input').fill('Midt i')
  await page.getByTestId('create-section').click()
  await expect(page.getByTestId('filmstrip-item')).toHaveCount(5)
  await expect(page.getByTestId('statusbar')).toContainText('Inndeling 3 av 5')
})

/*
 * De avledede sidene på slutten genereres og redigeres ikke, men plassen foran
 * den første av dem er likevel plassen etter siste slide: det samme
 * mellomrommet tilbys der, og den nye siden havner foran alle avledede.
 */
test('mellomrommet foran de avledede sidene setter inn en ny side etter siste slide', async ({ page }) => {
  await createPresentation(page, 'Før referansene')
  await addReference(page, 'En kilde')
  const derived = page.getByTestId('filmstrip-derived')
  await expect(derived).toHaveCount(1)
  await page.getByTestId('filmstrip-thumb').first().click()

  const gap = derived.locator('xpath=preceding-sibling::*[@data-testid="filmstrip-insert"]')
  await gap.hover()
  await expect(gap).toHaveAttribute('data-open', '')
  await page.getByTestId('filmstrip-insert-button').click()
  await page.getByTestId('insert-slide').click()
  await expect(page.getByTestId('new-slide-modal')).toContainText('Kommer etter slide 2.')
  await page.getByTestId('new-slide-without-title').click()

  await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)
  await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')
  await expect(derived.locator('.filmstrip__number')).toHaveText('4')
})
