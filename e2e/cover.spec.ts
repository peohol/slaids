import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  stage,
  toast,
  waitForSaved,
  watchForErrors,
  worstOverflow,
  zoneRects,
} from './helpers'

/**
 * The cover.
 *
 * Two claims are worth making in a real browser, and neither can be made
 * anywhere else. The first is that it is genuinely the first page and genuinely
 * cannot be got rid of. The second is the one this feature exists for: a
 * heading nobody picked a colour for takes the cover's, *live* — so changing
 * the colour on the cover has to repaint a heading on a slide the author is not
 * even looking at, without any edit to that slide.
 */

/** Pick a pill colour on the cover, from the inspector's own palette. */
async function coverColor(page: Page, hex: string): Promise<void> {
  await page
    .getByTestId('inspector')
    .getByTestId('palette')
    .locator(`[data-color="${hex}"]`)
    .click()
}

async function backToFirstSlide(page: Page): Promise<void> {
  await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
  await expect(coverStage(page)).toHaveCount(0)
}

/**
 * The cover on the stage.
 *
 * Scoped deliberately: the filmstrip draws the very same component, which is
 * the point of it — a thumbnail can never misrepresent the page.
 */
function coverStage(page: Page) {
  return stage(page).getByTestId('cover-page')
}

/** The background a heading pill is actually painted with right now. */
async function headingPillColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const heading = document.querySelector(
      '[data-testid="stage-slide"] .rd-heading',
    ) as HTMLElement
    return getComputedStyle(heading).backgroundColor
  })
}

test.describe('forsiden', () => {
  test('ligger først, kan velges, og kan verken flyttes eller slettes', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Med forside')

    const cover = page.getByTestId('filmstrip-cover')
    await expect(cover).toHaveCount(1)
    // Første element i stripen, før den første sliden.
    const order = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-testid="filmstrip"] [data-testid]'),
      )
        .map((element) => element.getAttribute('data-testid'))
        .filter((id) => id === 'filmstrip-cover' || id === 'filmstrip-item'),
    )
    expect(order[0]).toBe('filmstrip-cover')

    // Ingen håndtak å dra i, og ingen søppelbøtte.
    await expect(cover.getByRole('button', { name: 'Flytt slide' })).toHaveCount(0)
    await expect(cover.locator('[data-testid="delete-slide"]')).toHaveCount(0)
    await expect(cover.locator('[data-testid="duplicate-slide"]')).toHaveCount(0)

    expect(guard.errors).toEqual([])
  })

  test('viser dekkets navn, og tar imot tittel og undertittel', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Kvartalsrapport')

    await page.getByTestId('filmstrip-cover-thumb').click()
    await expect(coverStage(page)).toBeVisible()
    // Navnet forfatteren allerede har skrevet er den åpenbare første tittelen.
    await expect(coverStage(page)).toContainText('Kvartalsrapport')

    const subtitle = stage(page).locator('[data-cover-line="subtitle"] .tiptap')
    await subtitle.click()
    await page.keyboard.type('Tall og tiltak')
    await expect(coverStage(page)).toContainText('Tall og tiltak')

    // Soner finnes ikke her, så soneverktøyene er ikke tilgjengelige.
    await expect(page.getByTestId('mode-zone')).toBeDisabled()

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await page.getByTestId('filmstrip-cover-thumb').click()
    await expect(coverStage(page)).toContainText('Tall og tiltak')

    expect(guard.errors).toEqual([])
  })

  test('klipper aldri en linje – for lang tekst rulles tilbake', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Lang forside')

    await page.getByTestId('filmstrip-cover-thumb').click()
    const title = stage(page).locator('[data-cover-line="title"] .tiptap')
    await title.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')

    // Én linje, som en tittelsone: teksten som ikke får plass skal aldri
    // committes, og pillen skal aldri ende opp med noe skjult i seg.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.insertText('En veldig lang forsidetittel ')
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(400)

    await expect(toast(page, 'Tittelen får ikke plass på forsiden.')).toHaveCount(1)
    expect(await worstOverflow(page)).toBeLessThan(1)

    expect(guard.errors).toEqual([])
  })

  test('gir fargen sin til overskrifter som ikke har valgt en egen', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Farger')

    // En overskrift på den første sliden. Ingen farge er valgt for den.
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('En overskrift')
    await page.getByTestId('format-heading').click()
    await expect(stage(page).locator('.rd-heading')).toHaveCount(1)
    const before = await headingPillColor(page)

    // Fargen settes på forsiden — ikke på overskriften.
    await page.getByTestId('filmstrip-cover-thumb').click()
    await expect(coverStage(page)).toBeVisible()
    await coverColor(page, '#4d4d80')

    // Tilbake til sliden: overskriften har fulgt etter, uten at noen har
    // redigert den.
    await backToFirstSlide(page)
    const followed = await headingPillColor(page)
    expect(followed).not.toBe(before)
    expect(followed).toBe('rgb(77, 77, 128)')

    // En overskrift som *får* en egen farge slutter å følge forsiden.
    await stage(page).locator('.rd-heading').first().click()
    await page.getByTestId('heading-color').click()
    await page.locator('.popover [data-color="#804d4d"]').click()
    await page.keyboard.press('Escape')
    await expect(headingPillColor(page)).resolves.toBe('rgb(128, 77, 77)')

    await page.getByTestId('filmstrip-cover-thumb').click()
    await coverColor(page, '#4d8066')
    await backToFirstSlide(page)
    // Uendret: en farge som er valgt, er valgt.
    await expect(headingPillColor(page)).resolves.toBe('rgb(128, 77, 77)')

    // …og «Standard» gir den tilbake til forsiden.
    await stage(page).locator('.rd-heading').first().click()
    await page.getByTestId('heading-color').click()
    await page.getByTestId('palette-inherited').click()
    await page.keyboard.press('Escape')
    await expect(headingPillColor(page)).resolves.toBe('rgb(77, 128, 102)')

    expect(guard.errors).toEqual([])
  })
})
