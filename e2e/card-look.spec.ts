/**
 * The theme's two looks: whether boxes cast shadows, and how a card with a
 * title draws it — joined to its body, as a tab behind it, or floating above
 * it. Switching style may leave text too little room; the zone is then drawn
 * smaller, the same in the editor and in presentation, and never refused.
 */

import { expect, test, type Page } from './fixtures'
import { CARD_RADIUS, type TitledCardStyle } from '../src/domain/constants'
import {
  G,
  addContentToZone,
  caretInto,
  chooseFromToolbarMenu,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

async function openTheme(page: Page): Promise<void> {
  await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
  await expect(page.getByTestId('theme-modal')).toBeVisible()
}

async function closeTheme(page: Page): Promise<void> {
  await page.getByTestId('theme-modal').getByRole('button', { name: 'Ferdig' }).click()
  await expect(page.getByTestId('theme-modal')).toBeHidden()
}

async function chooseLook(page: Page, look: TitledCardStyle): Promise<void> {
  await openTheme(page)
  await page.getByTestId(`theme-titled-card-${look}`).click()
  await expect(page.getByTestId(`theme-titled-card-${look}`)).toHaveAttribute('aria-checked', 'true')
  await closeTheme(page)
}

/** A slide of two columns with a titled card in the left one. */
async function titledCardDeck(page: Page, name: string, title: string, body = 'Innhold'): Promise<string> {
  await createPresentation(page, name)
  await enterZoneMode(page)
  await splitSelected(page, [1, 1], 'x')
  await enterContentMode(page)
  const [left] = await zoneRects(page)
  await addContentToZone(page, left.id, 'titled-card')
  await caretInto(zone(page, left.id).locator('.card-header .tiptap'))
  await page.keyboard.insertText(title)
  await caretInto(zone(page, left.id).locator('.tiptap').last())
  await page.keyboard.insertText(body)
  await page.waitForTimeout(300)
  return left.id
}

function zone(page: Page, nodeId: string) {
  return stage(page).locator(`.slide-zone[data-node-id="${nodeId}"]`)
}

interface CardParts {
  header: { left: number; right: number; top: number; bottom: number; width: number }
  body: { left: number; right: number; top: number; width: number }
  /** How far the title runs past its header, in the header's own pixels. */
  titleOverflow: number
  headerShadow: string
  bodyShadow: string
  cardShadow: string
  bodyTopRadius: string
}

/**
 * The card's header and body in slide units, measured *inside* the zone's
 * drawing — divided by the zone's own scale as well as the stage's, so the
 * numbers are the ones the layout was made with.
 */
async function cardParts(page: Page, nodeId: string): Promise<CardParts> {
  return zone(page, nodeId).evaluate((element) => {
    const slide = element.closest('.slide') as HTMLElement
    const fit = element.querySelector('.zone-fit') as HTMLElement
    const scale =
      (slide.getBoundingClientRect().width / 1600) * Number(fit.getAttribute('data-fit-scale') ?? 1)
    const card = element.querySelector('.zone-content--titled') as HTMLElement
    const header = card.querySelector('.card-header') as HTMLElement
    const body = card.querySelector('.card-body') as HTMLElement
    const h = header.getBoundingClientRect()
    const b = body.getBoundingClientRect()
    const unit = (value: number) => value / scale
    return {
      header: {
        left: unit(h.left),
        right: unit(h.right),
        top: unit(h.top),
        bottom: unit(h.bottom),
        width: unit(h.width),
      },
      body: { left: unit(b.left), right: unit(b.right), top: unit(b.top), width: unit(b.width) },
      titleOverflow: header.scrollWidth - header.clientWidth,
      headerShadow: getComputedStyle(header).boxShadow,
      bodyShadow: getComputedStyle(body).boxShadow,
      cardShadow: getComputedStyle(card).boxShadow,
      bodyTopRadius: getComputedStyle(body).borderTopLeftRadius,
    }
  })
}

/** How much smaller than normal the zone's card title is set, on its own. */
async function titleFit(page: Page, nodeId: string): Promise<number> {
  const value = await zone(page, nodeId).locator('.zone-fit').first().getAttribute('data-title-fit')
  return value === null ? 1 : Number(value)
}

async function bodyFontSize(page: Page, nodeId: string): Promise<string> {
  return zone(page, nodeId)
    .locator('.card-body p')
    .first()
    .evaluate((element) => getComputedStyle(element).fontSize)
}

/** The air between the title's text and its header's edges, left and right. */
async function titleAir(page: Page, nodeId: string): Promise<{ left: number; right: number }> {
  return zone(page, nodeId).evaluate((element) => {
    const header = element.querySelector('.card-header') as HTMLElement
    const text = document.createRange()
    text.selectNodeContents(header.querySelector('p') as HTMLElement)
    const glyphs = text.getBoundingClientRect()
    const box = header.getBoundingClientRect()
    return { left: glyphs.left - box.left, right: box.right - glyphs.right }
  })
}

async function fitScale(page: Page, nodeId: string): Promise<number> {
  const value = await zone(page, nodeId).locator('.zone-fit').first().getAttribute('data-fit-scale')
  return value === null ? 1 : Number(value)
}

test.describe('kort med tittel og skygger', () => {
  test('skrur skyggene av og på for hele presentasjonen, og husker det', { tag: '@pr' }, async ({ page }) => {
    const { errors } = watchForErrors(page)
    const card = await titledCardDeck(page, 'Skygger', 'Tittel')
    expect((await cardParts(page, card)).cardShadow).not.toBe('none')

    await openTheme(page)
    const toggle = page.getByTestId('theme-shadows')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await closeTheme(page)
    expect((await cardParts(page, card)).cardShadow).toBe('none')

    // Every look draws its boxes without a shadow when shadows are off …
    await chooseLook(page, 'tab')
    const tab = await cardParts(page, card)
    expect([tab.headerShadow, tab.bodyShadow]).toEqual(['none', 'none'])

    // … and both boxes of a split card cast one when they are on.
    await openTheme(page)
    await page.getByTestId('theme-shadows').click()
    await closeTheme(page)
    const shaded = await cardParts(page, card)
    expect(shaded.headerShadow).not.toBe('none')
    expect(shaded.bodyShadow).not.toBe('none')

    await openTheme(page)
    await page.getByTestId('theme-shadows').click()
    await closeTheme(page)
    await waitForSaved(page)
    await page.reload()
    await expect(stage(page)).toBeVisible()
    const reloaded = await cardParts(page, card)
    expect([reloaded.headerShadow, reloaded.bodyShadow]).toEqual(['none', 'none'])
    await expect(zone(page, card).locator('[data-titled-style="tab"]')).toHaveCount(1)
    expect(errors).toEqual([])
  })

  test('tegner tittelen som en fane bak innholdskortet, like bred som tittelen', async ({ page }) => {
    const card = await titledCardDeck(page, 'Fane', 'Tittel')
    const joined = await cardParts(page, card)
    expect(joined.header.width).toBeCloseTo(joined.body.width, 0)

    await chooseLook(page, 'tab')
    const tab = await cardParts(page, card)
    // As wide as the title, centred like it, and standing up from behind the
    // body: its lower corners run one radius down under the body's top edge.
    expect(tab.titleOverflow).toBeLessThanOrEqual(0)
    expect(tab.header.width).toBeLessThan(tab.body.width / 2)
    expect((tab.header.left + tab.header.right) / 2).toBeCloseTo((tab.body.left + tab.body.right) / 2, 0)
    expect(tab.header.bottom - tab.body.top).toBeCloseTo(CARD_RADIUS, 0)
    expect(tab.bodyTopRadius).toBe(`${CARD_RADIUS}px`)
  })

  test('lar tittelen sveve et gap over innholdskortet', async ({ page }) => {
    const card = await titledCardDeck(page, 'Svevende', 'Tittel')
    await chooseLook(page, 'floating')
    const floating = await cardParts(page, card)
    expect(floating.body.top - floating.header.bottom).toBeCloseTo(G, 0)
    expect(floating.header.width).toBeLessThan(floating.body.width / 2)
    expect(floating.bodyTopRadius).toBe(`${CARD_RADIUS}px`)
  })

  test(
    'forminsker bare tittelen når den er for lang, med lik luft på begge sider, likt i presentasjon',
    { tag: '@pr' },
    async ({ page }) => {
      const { errors } = watchForErrors(page)
      const card = await titledCardDeck(page, 'Lang tittel', 'Tittel')
      const bodyBefore = await bodyFontSize(page, card)
      // A title far longer than any header: typed or pasted, it is all taken.
      const title = zone(page, card).locator('.card-header .tiptap')
      await caretInto(title)
      await page.keyboard.press('End')
      await page.keyboard.insertText(' med en svært lang tittel som ikke får plass på én linje')

      for (const look of ['joined', 'tab', 'floating'] as const) {
        await chooseLook(page, look)
        await expect.poll(() => titleFit(page, card), look).toBeLessThan(1)
        // Only the title: the zone is drawn at normal size and its body text
        // keeps its size.
        expect(await fitScale(page, card), look).toBe(1)
        expect(await bodyFontSize(page, card), look).toBe(bodyBefore)
        // The title fits inside the header's padding, the same air either side.
        const air = await titleAir(page, card)
        expect(Math.abs(air.left - air.right), look).toBeLessThanOrEqual(1.5)
        expect(air.right, look).toBeGreaterThan(0)
      }

      await enterZoneMode(page)
      await expect(zone(page, card).getByTestId('zone-shrunk-marker')).toHaveCount(1)
      const drawn = await titleFit(page, card)

      await page.getByTestId('present').click()
      const presented = page.locator(
        `[data-testid="present-view"] .slide-zone[data-node-id="${card}"] .zone-fit`,
      )
      await expect(presented).toBeVisible()
      await expect
        .poll(async () => Number((await presented.getAttribute('data-title-fit')) ?? 1))
        .toBeCloseTo(drawn, 2)
      await expect(page.locator('[data-testid="present-view"] [data-testid="zone-shrunk-marker"]')).toHaveCount(0)
      expect(errors).toEqual([])
    },
  )

  test('holder luften under en svevende tittel lik når innholdet forminskes', async ({ page }) => {
    const card = await titledCardDeck(page, 'Fullt kort', 'Tittel')
    await chooseLook(page, 'floating')
    const field = zone(page, card).locator('.tiptap').last()
    await caretInto(field)
    await page.keyboard.press('End')
    await page.keyboard.insertText(' Mye tekst som ikke får plass.'.repeat(40))
    await expect.poll(() => fitScale(page, card)).toBeLessThan(1)
    // Measured on screen, in slide units: the zone's own scale does not count.
    const gap = await zone(page, card).evaluate((element) => {
      const slide = element.closest('.slide') as HTMLElement
      const scale = slide.getBoundingClientRect().width / 1600
      const header = element.querySelector('.card-header') as HTMLElement
      const body = element.querySelector('.card-body') as HTMLElement
      return (body.getBoundingClientRect().top - header.getBoundingClientRect().bottom) / scale
    })
    expect(gap).toBeCloseTo(G, 0)
  })
})
