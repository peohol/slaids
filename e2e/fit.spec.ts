import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  enterZoneMode,
  fillZoneToCapacity,
  renderedBodyFont,
  splitSelected,
  stage,
  toast,
  watchForErrors,
  worstOverflow,
  zoneRects,
} from './helpers'

test.describe('content fit', () => {
  test('rejects a slide title that does not fit on one line', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Tittelgrense')
    const editor = stage(page).locator('[data-testid="slide-title"] .tiptap')
    await editor.click()
    await page.keyboard.insertText('Dette er en overskrift som helt sikkert er altfor lang '.repeat(3))

    await expect(page.getByTestId('toast')).toBeVisible()
    const overflow = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="slide-title"]') as HTMLElement
      return element.scrollWidth - element.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
    expect(guard.errors).toEqual([])
  })

  test('rejects body text that would overflow its zone', async ({ page }) => {
    await createPresentation(page, 'Innholdsgrense')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')
    await page.getByTestId('mode-content').click()

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .subfield .tiptap`)
    await field.click()
    // insertText lands in one transaction, which is what a paste looks like.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.insertText('Dette er en setning som fyller opp sonen ganske raskt. '.repeat(12))
    }

    await expect(page.getByTestId('toast')).toBeVisible()
    const overflow = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
      let worst = 0
      for (const element of stage.querySelectorAll<HTMLElement>('[data-fit-scroll]')) {
        worst = Math.max(worst, element.scrollHeight - element.clientHeight)
      }
      return worst
    })
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('refuses a global font change that would hide existing text', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Fontgrense')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)

    // Monospace is wider than the default proportional font in every font
    // configuration, so this is the same text in a font it no longer fits.
    const before = await renderedBodyFont(page)
    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-body-font').selectOption({ label: 'Consolas' })

    await expect(toast(page, 'Denne fonten')).toBeVisible()
    // The select is a controlled input, but React does not re-render when the
    // command is refused, so the DOM value is not evidence either way. What the
    // slide is actually rendered with is.
    expect(await renderedBodyFont(page)).toBe(before)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
    expect(guard.errors).toEqual([])
  })

  test('accepts a global font change the content still fits', async ({ page }) => {
    await createPresentation(page, 'Fontplass')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .subfield .tiptap`)
    await field.click()
    await page.keyboard.insertText('Kort tekst.')
    await page.waitForTimeout(200)

    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-body-font').selectOption({ label: 'Consolas' })
    await expect
      .poll(() => renderedBodyFont(page))
      .toContain('Consolas')
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('refuses a subfield split that would hide existing text', async ({ page }) => {
    await createPresentation(page, 'Subfeltgrense')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id)

    await enterZoneMode(page)
    const count = page.getByTestId('subfield-count')
    await count.fill('2')
    await expect(toast(page, 'subfeltene deler sonen')).toBeVisible()
    await expect(stage(page).locator('.slide-zone .subfield')).toHaveCount(1)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('refuses a content-kind conversion that would hide existing text', async ({ page }) => {
    await createPresentation(page, 'Konvertering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await fillZoneToCapacity(page, zones[0].id)

    await enterZoneMode(page)
    // A titled card spends the header height and the card padding on chrome.
    await page.getByTestId('inspector-kind-titled-card').click()
    await expect(toast(page, 'innholdstypen')).toBeVisible()
    await expect(
      stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] [data-content-kind]`),
    ).toHaveAttribute('data-content-kind', 'container')
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('never paints content outside its zone', async ({ page }) => {
    await createPresentation(page, 'Klipping')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const clipped = await page.evaluate(() => {
      const zone = document.querySelector(
        '[data-testid="stage-slide"] .slide-zone',
      ) as HTMLElement
      return getComputedStyle(zone).overflow
    })
    expect(clipped).toBe('hidden')
  })
})
