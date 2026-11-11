/**
 * Temaets to utseendevalg: om bokser kaster skygge, og hvordan et kort med
 * tittel tegner den – i ett med innholdet, som en fane bak det, eller svevende
 * over det. Et bytte kan gi tekst for lite plass; da tegnes sonen mindre, likt
 * i editoren og i presentasjon, og byttet avvises aldri.
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
  await expect(lookChoice(page, look)).toBeChecked()
  await closeTheme(page)
}

/** Radioknappen for ett kortutseende i temadialogen. */
function lookChoice(page: Page, look: TitledCardStyle) {
  return page.getByTestId(`theme-titled-card-${look}`).getByRole('radio')
}

/** En slide med to kolonner og et kort med tittel i den venstre. */
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
  /** Hvor langt tittelen går forbi headeren, i headerens egne piksler. */
  titleOverflow: number
  headerShadow: string
  bodyShadow: string
  cardShadow: string
  bodyTopRadius: string
}

/**
 * Kortets header og innhold i slide-enheter, målt *inne i* sonens tegning –
 * delt på sonens egen skala i tillegg til stagens, så tallene er de layouten
 * ble laget med.
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

/** Hvor mye mindre enn normalt sonens korttittel er satt, for seg selv. */
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

/** Luften mellom tittelens tekst og headerens kanter, til venstre og høyre. */
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

/**
 * De forminskede feltenes merker, og kortets header og innhold, i skjermpiksler
 * – så et merke kan sammenlignes med feltet det står rundt.
 */
async function marks(page: Page, nodeId: string) {
  return zone(page, nodeId).evaluate((element) => {
    const box = (node: Element) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    return {
      marks: [...element.querySelectorAll('.zone-fit__mark')].map(box),
      header: box(element.querySelector('.card-header') as HTMLElement),
      body: box(element.querySelector('.card-body') as HTMLElement),
    }
  })
}

type Box = { left: number; top: number; width: number; height: number }

function sameBox(a: Box, b: Box): boolean {
  return (['left', 'top', 'width', 'height'] as const).every((key) => Math.abs(a[key] - b[key]) <= 1)
}

async function headerHeight(page: Page, nodeId: string): Promise<number> {
  return zone(page, nodeId)
    .locator('.card-header')
    .evaluate((element) => (element as HTMLElement).offsetHeight)
}

async function titleFontSize(page: Page, nodeId: string): Promise<string> {
  return zone(page, nodeId)
    .locator('.card-header p')
    .first()
    .evaluate((element) => getComputedStyle(element).fontSize)
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

    // Alle utseender tegner boksene uten skygge når skygger er av …
    await chooseLook(page, 'tab')
    const tab = await cardParts(page, card)
    expect([tab.headerShadow, tab.bodyShadow]).toEqual(['none', 'none'])

    // … og begge boksene i et delt kort kaster skygge når de er på.
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
    // Like bred som tittelen, midtstilt som den, og stående opp bak innholdet:
    // de nedre hjørnene går én radius ned under innholdets overkant.
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
      // En tittel langt lengre enn noen header: skrevet eller limt inn tas alt imot.
      const title = zone(page, card).locator('.card-header .tiptap')
      await caretInto(title)
      await page.keyboard.press('End')
      await page.keyboard.insertText(' med en svært lang tittel som ikke får plass på én linje')

      for (const look of ['joined', 'tab', 'floating'] as const) {
        await chooseLook(page, look)
        await expect.poll(() => titleFit(page, card), look).toBeLessThan(1)
        // Bare tittelen: sonen tegnes i normal størrelse og innholdsteksten
        // beholder sin størrelse.
        expect(await fitScale(page, card), look).toBe(1)
        expect(await bodyFontSize(page, card), look).toBe(bodyBefore)
        // Tittelen får plass innenfor headerens polstring, med lik luft på begge sider.
        const air = await titleAir(page, card)
        expect(Math.abs(air.left - air.right), look).toBeLessThanOrEqual(1.5)
        expect(air.right, look).toBeGreaterThan(0)
      }

      await enterZoneMode(page)
      await expect(zone(page, card).getByTestId('zone-shrunk-marker')).toHaveCount(1)
      // Bare tittelen er merket, ikke hele kortet, med strek og merke.
      const marked = await marks(page, card)
      expect(marked.marks).toHaveLength(1)
      // Den siste løkken endte på svevende tittel, der hele headeren synes.
      expect(sameBox(marked.marks[0], marked.header)).toBe(true)
      await expect(zone(page, card).locator('.zone-shrunk__badge')).toHaveCount(1)
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

  test('lar kortutseendet velges med tastaturet', { tag: '@pr' }, async ({ page }) => {
    const { errors } = watchForErrors(page)
    const card = await titledCardDeck(page, 'Tastatur', 'Tittel')
    await openTheme(page)
    // Fokus på valget som gjelder; gruppen er ett tabulatorstopp.
    await lookChoice(page, 'joined').focus()
    await expect(lookChoice(page, 'joined')).toBeChecked()

    // Piltastene flytter fokus og velger, og sliden følger med med en gang.
    await page.keyboard.press('ArrowRight')
    await expect(lookChoice(page, 'tab')).toBeFocused()
    await expect(lookChoice(page, 'tab')).toBeChecked()
    await expect(zone(page, card).locator('[data-titled-style="tab"]')).toHaveCount(1)

    await page.keyboard.press('ArrowRight')
    await expect(lookChoice(page, 'floating')).toBeChecked()
    await page.keyboard.press('ArrowLeft')
    await expect(lookChoice(page, 'tab')).toBeFocused()
    await expect(lookChoice(page, 'tab')).toBeChecked()
    await expect(lookChoice(page, 'floating')).not.toBeChecked()

    // Tab går videre ut av gruppen i stedet for til neste valg i den.
    await page.keyboard.press('Tab')
    await expect(lookChoice(page, 'floating')).not.toBeFocused()
    await closeTheme(page)
    await expect(zone(page, card).locator('[data-titled-style="tab"]')).toHaveCount(1)
    expect(errors).toEqual([])
  })

  test(
    'forminsker bare innholdet når det er for mye tekst, og merker bare det, likt i presentasjon',
    { tag: '@pr' },
    async ({ page }) => {
      const { errors } = watchForErrors(page)
      const card = await titledCardDeck(page, 'Fullt innhold', 'Tittel')
      const titleBefore = await titleFontSize(page, card)
      const field = zone(page, card).locator('.tiptap').last()
      await caretInto(field)
      await page.keyboard.press('End')
      await page.keyboard.insertText(' Mye tekst som ikke får plass.'.repeat(40))

      for (const look of ['joined', 'tab', 'floating'] as const) {
        await chooseLook(page, look)
        await expect.poll(() => fitScale(page, card), look).toBeLessThan(1)

        // Tittelen er urørt: samme skrift, ingen egen forminsking, og headeren
        // tegnes i sin egen størrelse, ikke skalert sammen med innholdet.
        expect(await titleFit(page, card), look).toBe(1)
        expect(await titleFontSize(page, card), look).toBe(titleBefore)
        const drawnHeader = await zone(page, card)
          .locator('.card-header')
          .evaluate((header) => header.getBoundingClientRect().height)
        const slideScale = await stage(page).evaluate((slide) => slide.getBoundingClientRect().width / 1600)
        expect(drawnHeader / slideScale, look).toBeCloseTo(await headerHeight(page, card), 0)

        // Bare innholdet er merket.
        await enterZoneMode(page)
        const marked = await marks(page, card)
        expect(marked.marks, look).toHaveLength(1)
        expect(sameBox(marked.marks[0], marked.body), look).toBe(true)
        const drawn = await fitScale(page, card)

        // Likt i presentasjon, uten merke.
        await page.getByTestId('present').click()
        const presented = page.locator(
          `[data-testid="present-view"] .slide-zone[data-node-id="${card}"] .zone-fit`,
        )
        await expect(presented).toBeVisible()
        await expect
          .poll(async () => Number((await presented.getAttribute('data-fit-scale')) ?? 1), look)
          .toBeCloseTo(drawn, 2)
        await expect(presented).not.toHaveAttribute('data-title-fit')
        await expect(page.locator('[data-testid="present-view"] [data-testid="zone-shrunk-marker"]')).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('present-view')).toBeHidden()
        await enterContentMode(page)
      }
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
    // Målt på skjermen, i slide-enheter: sonens egen skala teller ikke.
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
