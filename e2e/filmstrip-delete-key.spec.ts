import { expect, test, type Page } from './fixtures'
import { createPresentation, setUserSetting, stage, toast, watchForErrors } from './helpers'

/** Legger til `count` slides uten tittel etter den gjeldende. */
async function addSlides(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
  }
}

/** Slide-id-ene i stripen, i rekkefølge. */
async function stripOrder(page: Page): Promise<string[]> {
  return page.getByTestId('filmstrip-item').evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).dataset.slideId as string),
  )
}

async function turnOnFewerDialogs(page: Page): Promise<void> {
  await page.goto('/')
  await setUserSetting(page, 'Færre popuper', true)
}

test('Delete og Backspace på en valgt slide i stripen sletter den, og kan angres', async ({ page }) => {
  const guard = watchForErrors(page)
  await createPresentation(page, 'Slett med tasten')
  await addSlides(page, 2)
  const items = page.getByTestId('filmstrip-item')
  await expect(items).toHaveCount(4)
  const before = await stripOrder(page)

  // Et klikk på miniatyren og så Delete spør, som «Slett …» i menyen gjør.
  await items.nth(2).getByTestId('filmstrip-thumb').click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('confirm-dialog')).toContainText('Slette slide 3?')
  await page.getByTestId('confirm-accept').click()
  await expect(items).toHaveCount(3)
  expect(await stripOrder(page)).toEqual(before.filter((id) => id !== before[2]))
  // Den valgte sliden har tastaturet etterpå, også når en dialog var i veien.
  await expect(items.nth(1).getByTestId('filmstrip-thumb')).toBeFocused()

  // Angre gir sliden tilbake på samme plass.
  await page.keyboard.press('Control+z')
  await expect(items).toHaveCount(4)
  expect(await stripOrder(page)).toEqual(before)

  // Et klikk på nummerraden velger også sliden, og Backspace – slettetasten på
  // en Mac – virker likt. Avbryter man, skjer ingenting.
  await items.nth(1).locator('.filmstrip__number').click()
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('confirm-dialog')).toContainText('Slette slide 2?')
  await page.getByRole('button', { name: 'Avbryt' }).click()
  await expect(page.getByTestId('confirm-dialog')).toBeHidden()
  await expect(items).toHaveCount(4)

  expect(guard.errors).toEqual([])
})

test('tastene sletter ikke slides mens det skrives', async ({ page }) => {
  await createPresentation(page, 'Skriv uten å slette')
  await page.getByTestId('add-slide').click()
  await page.getByTestId('new-slide-with-title').click()
  const items = page.getByTestId('filmstrip-item')
  await expect(items).toHaveCount(3)

  await items.nth(2).getByTestId('filmstrip-thumb').click()
  const title = stage(page).getByTestId('slide-title').locator('[contenteditable="true"]')
  await title.click()
  await page.keyboard.type('Hei')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  await expect(title).toHaveText('He')
  await expect(page.getByTestId('confirm-dialog')).toBeHidden()
  await expect(items).toHaveCount(3)
})

test('med færre popuper slettes sliden med en gang, og tastaturet går videre til neste', async ({
  page,
}) => {
  await turnOnFewerDialogs(page)
  await createPresentation(page, 'Slett flere')
  // Med færre popuper legger «Ny slide» inn sliden uten å spørre.
  await page.getByTestId('add-slide').click()
  await page.getByTestId('add-slide').click()
  const items = page.getByTestId('filmstrip-item')
  await expect(items).toHaveCount(4)
  const before = await stripOrder(page)

  await items.nth(3).getByTestId('filmstrip-thumb').click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('confirm-dialog')).toBeHidden()
  await expect(items).toHaveCount(3)
  // Sliden som nå er valgt, har tastaturet, så neste trykk sletter den.
  await expect(items.nth(2).getByTestId('filmstrip-thumb')).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(items).toHaveCount(2)
  expect(await stripOrder(page)).toEqual(before.slice(0, 2))
})

test('en side som ikke kan slettes, blir stående, og grunnen vises', async ({ page }) => {
  await turnOnFewerDialogs(page)
  await createPresentation(page, 'Forsiden blir')
  const items = page.getByTestId('filmstrip-item')
  await expect(items).toHaveCount(2)

  // Forsiden kan ikke gå så lenge det ville etterlatt en vanlig slide først.
  await items.nth(0).getByTestId('filmstrip-thumb').click()
  await page.keyboard.press('Delete')
  await expect(toast(page, 'inndeling')).toBeVisible()
  await expect(items).toHaveCount(2)
})
