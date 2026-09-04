import { expect, test, type Page } from './fixtures'
import { G as BASE_G } from '../src/domain/constants'
import {
  G,
  addContentToZone,
  backToLibrary,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  fillZoneToCapacity,
  splitSelected,
  stage,
  toast,
  waitForSaved,
  watchForErrors,
  worstOverflow,
  zoneRects,
} from './helpers'

/** What «Luftig» comes to: one step above the «Normal» a new deck opens in. */
const AIRY_GAP = Math.round(BASE_G * 1.6)

/** The gap between two side-by-side zones, in logical slide pixels. */
async function renderedGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const slide = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
    const scale = slide.getBoundingClientRect().width / 1600
    const zones = [...slide.querySelectorAll('.slide-zone')].map((zone) =>
      zone.getBoundingClientRect(),
    )
    if (zones.length < 2) return 0
    return Math.round((zones[1].left - zones[0].right) / scale)
  })
}

async function renderedBodySize(page: Page): Promise<number> {
  return page.evaluate(() => {
    const paragraph = document.querySelector(
      '[data-testid="stage-slide"] .subfield .tiptap p',
    ) as HTMLElement
    return Number.parseFloat(getComputedStyle(paragraph).fontSize)
  })
}

test.describe('luft and skriftstørrelse', () => {
  test('moves every distance together when the air changes', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Luft')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')

    // A new deck opens at «Normal», which is the base token scaled — `G` here
    // is that gap, read from the domain rather than restated.
    expect(await renderedGap(page)).toBe(G)
    const padding = async (): Promise<number> =>
      page.evaluate(() => {
        const card = document.querySelector('[data-testid="stage-slide"] .zone-content--card')
        return Number.parseFloat(getComputedStyle(card as HTMLElement).padding)
      })
    const beforePadding = await padding()

    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-spacing-1.6').click()
    await page.getByTestId('theme-modal').getByRole('button', { name: 'Ferdig' }).click()

    // One dial, every distance: the slide gap and the card padding move
    // together, so there is still exactly one gap — a wider one.
    await expect.poll(() => renderedGap(page)).toBe(AIRY_GAP)
    expect(await padding()).toBeGreaterThan(beforePadding)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    expect(await renderedGap(page)).toBe(AIRY_GAP)
    expect(guard.errors).toEqual([])
  })

  test('scales the type on the slide', async ({ page }) => {
    await createPresentation(page, 'Skriftstørrelse')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Litt tekst.')

    const before = await renderedBodySize(page)
    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-font-scale-1.3').click()
    await page.getByTestId('theme-modal').getByRole('button', { name: 'Ferdig' }).click()

    await expect.poll(() => renderedBodySize(page)).toBeGreaterThan(before)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('refuses air a full zone cannot afford, and shows the same text after', async ({ page }) => {
    await createPresentation(page, 'For mye luft')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id)
    const gapBefore = await renderedGap(page)

    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-spacing-1.6').click()

    await expect(toast(page, 'får ikke plass')).toBeVisible()
    expect(await renderedGap(page)).toBe(gapBefore)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('refuses type larger than a full zone can afford', async ({ page }) => {
    await createPresentation(page, 'For stor skrift')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id)
    const before = await renderedBodySize(page)

    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-font-scale-1.45').click()

    await expect(toast(page, 'får ikke plass')).toBeVisible()
    expect(await renderedBodySize(page)).toBe(before)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('starts new presentations from the theme saved as the default', async ({ page }) => {
    await createPresentation(page, 'Standardtema')
    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-spacing-1.6').click()
    await page.getByTestId('theme-font-scale-1.3').click()
    await page.getByTestId('theme-as-default').click()
    await expect(toast(page, 'standard for nye presentasjoner')).toBeVisible()
    await page.getByTestId('theme-modal').getByRole('button', { name: 'Ferdig' }).click()

    // Reloading lands back in the deck that was open, so go to the library
    // first — and wait for it, since leaving saves before it lets go.
    await backToLibrary(page)
    await createPresentation(page, 'Ny med standard')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    expect(await renderedGap(page)).toBe(AIRY_GAP)
  })
})
