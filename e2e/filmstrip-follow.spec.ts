import { expect, test, type Page } from './fixtures'
import { createPresentation, stage } from './helpers'

/**
 * How far the shown page's thumbnail sits from the middle of the strip, in CSS
 * pixels, and how far the strip can still scroll each way.
 */
async function stripState(page: Page): Promise<{ offset: number; top: number; rest: number }> {
  return page.getByTestId('filmstrip-list').evaluate((list) => {
    const active = list.querySelector('.filmstrip__item--active')
    if (!active) throw new Error('no active filmstrip entry')
    const listBox = list.getBoundingClientRect()
    const itemBox = active.getBoundingClientRect()
    const middle = listBox.top + list.clientTop + list.clientHeight / 2
    return {
      offset: itemBox.top + itemBox.height / 2 - middle,
      top: list.scrollTop,
      rest: list.scrollHeight - list.clientHeight - list.scrollTop,
    }
  })
}

/** Waits for the strip to settle with the shown page in its middle. */
async function expectCentred(page: Page): Promise<void> {
  await expect.poll(async () => Math.abs((await stripState(page)).offset)).toBeLessThan(2)
}

test('the filmstrip keeps the shown slide in its middle without fighting a manual scroll', async ({
  page,
}) => {
  await createPresentation(page, 'Stripa følger med')
  for (let i = 0; i < 8; i += 1) {
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
  }
  await expect(page.getByTestId('statusbar')).toContainText('Slide 10 av 10')

  // At the bottom of the deck the strip cannot centre the last slide; it stops
  // at its end instead.
  await expect.poll(async () => (await stripState(page)).rest).toBeLessThan(1)

  // Paging up with the arrows brings each page to the middle of the strip.
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowUp')
  await expect(page.getByTestId('statusbar')).toContainText('Slide 6 av 10')
  await expectCentred(page)

  // So does the wheel over the stage.
  await stage(page).hover()
  await page.mouse.wheel(0, -120)
  await expect(page.getByTestId('statusbar')).toContainText('Slide 5 av 10')
  await expectCentred(page)

  // Scrolling the strip by hand is left alone.
  await page.getByTestId('filmstrip').hover()
  await page.mouse.wheel(0, 2000)
  await expect.poll(async () => (await stripState(page)).rest).toBeLessThan(1)
  await page.waitForTimeout(400)
  expect((await stripState(page)).rest).toBeLessThan(1)

  // …until the user moves on, which brings the shown page back to the middle.
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('statusbar')).toContainText('Slide 6 av 10')
  await expectCentred(page)

  // A click on another thumbnail centres that one.
  await page.getByTestId('filmstrip-thumb').nth(4).click()
  await expect(page.getByTestId('statusbar')).toContainText('Slide 5 av 10')
  await expectCentred(page)

  // At the top of the deck the strip stops at its start.
  await page.getByTestId('filmstrip-thumb').first().click()
  await expect(page.getByTestId('statusbar')).toContainText('Forside 1 av 10')
  await expect.poll(async () => (await stripState(page)).top).toBeLessThan(1)
})
