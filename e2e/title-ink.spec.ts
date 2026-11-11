/**
 * Ingen bokstav i en tittellinje klippes.
 *
 * Slidetittelen og pillene på en inndelingsside er én linje i en boks som er
 * akkurat så høy som linjen. Hvor langt en g eller en Å rekker over og under
 * linjen, bestemmes av skrifttypen, og i flere av katalogens fonter rekker de
 * forbi den. Regelen er derfor ikke en linjehøyde, men at boksen aldri klipper
 * i høyden – i redigeringen og i visningen.
 *
 * Testen trenger en font som faktisk rekker forbi linjen sin, uavhengig av
 * hvilken font som er lokal i testmaskinen: den lokale reserveskriften får
 * oppgitt full linjehøyde over grunnlinjen og ingenting under, så alle
 * nedstrekene havner under linjen. Det som sjekkes, er stripen rett under
 * boksen: med «gggg» i linjen skal den se annerledes ut enn med «oooo» (samme
 * bredde, ingen nedstreker). Klipper boksen, er de to stripene like.
 */

import type { Locator, Page } from '@playwright/test'
import { expect, familiesFrom, localFaceCss, test } from './fixtures'
import { addPage, createPresentation, stage } from './helpers'

/** Lokale ansikter der hele linjen ligger over grunnlinjen. */
async function routeDeepDescenders(page: Page): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    const css = familiesFrom(route.request().url())
      .map(localFaceCss)
      .join('\n')
      .replace(/font-display:swap;/g, 'font-display:swap;ascent-override:125%;descent-override:0%;line-gap-override:0%;')
    await route.fulfill({ status: 200, contentType: 'text/css', body: css })
  })
}

/** Stripen rett under en boks, slik den er tegnet på skjermen. */
async function stripBelow(page: Page, box: Locator): Promise<Buffer> {
  const rect = await box.boundingBox()
  if (!rect) throw new Error('boksen er ikke synlig')
  return page.screenshot({
    clip: { x: rect.x, y: rect.y + rect.height, width: rect.width, height: Math.max(4, rect.height * 0.12) },
    animations: 'disabled',
  })
}

/** Sett tittelen i et felt man skriver i, og vent til den er tegnet. */
async function typeTitle(page: Page, field: Locator, text: string): Promise<void> {
  await field.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await expect(field).toHaveText(text)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** Om nedstrekene i boksen tegnes under den. */
async function descendersShowBelow(page: Page, box: Locator, field: Locator): Promise<boolean> {
  await typeTitle(page, field, 'oooo')
  const without = await stripBelow(page, box)
  await typeTitle(page, field, 'gggg')
  const withDescenders = await stripBelow(page, box)
  return !without.equals(withDescenders)
}

test.describe('tittellinjer klipper ikke bokstaver', () => {
  test.beforeEach(async ({ page }) => {
    await routeDeepDescenders(page)
  })

  test('slidetittelen, i redigeringen og i visningen', { tag: '@pr' }, async ({ page }) => {
    await createPresentation(page, 'Nedstreker')
    const title = stage(page).getByTestId('slide-title')
    const field = title.locator('.tiptap')
    expect(await descendersShowBelow(page, title, field)).toBe(true)

    // Visningen tegner den samme linjen – sammenlignet med en tittel uten nedstreker.
    await typeTitle(page, field, 'oooo')
    await page.getByTestId('present').click()
    const presented = page.getByTestId('present-view').locator('.slide-title')
    await expect(presented).toHaveText('oooo')
    const without = await stripBelow(page, presented)
    await page.keyboard.press('Escape')
    await typeTitle(page, field, 'gggg')
    await page.getByTestId('present').click()
    await expect(presented).toHaveText('gggg')
    expect((await stripBelow(page, presented)).equals(without)).toBe(false)
  })

  test('linjene på en inndelingsside', { tag: '@pr' }, async ({ page }) => {
    await createPresentation(page, 'Nedstreker i pillen')
    await addPage(page, 'section')
    await page.getByTestId('section-title-input').fill('oooo')
    await page.getByTestId('create-section').click()
    const pill = stage(page).locator('[data-section-line="title"]')
    await expect(pill).toBeVisible()
    expect(await descendersShowBelow(page, pill, pill.locator('.tiptap'))).toBe(true)
  })
})
