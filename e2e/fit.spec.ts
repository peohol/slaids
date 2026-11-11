import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  enterZoneMode,
  fillZoneToCapacity,
  renderedBodyFont,
  splitSelected,
  stage,
  titleTextOverflow,
  toast,
  watchForErrors,
  worstOverflow,
  zoneRects,
  chooseFromToolbarMenu,
  chooseKindInInspector,
} from './helpers'

test.describe('content fit', () => {
  test('takes a slide title too long for one line, and sets it smaller', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Tittelgrense')
    const title = stage(page).getByTestId('slide-title')
    const editor = title.locator('.tiptap')
    await editor.click()
    const long = 'Dette er en overskrift som helt sikkert er altfor lang '.repeat(3)
    await page.keyboard.insertText(long)

    // Every word is kept, set smaller, marked — and nothing clipped or refused.
    await expect.poll(() => editor.evaluate((element) => element.textContent ?? '')).toBe(long)
    await expect(title).toHaveAttribute('data-title-fit', /^0\.\d+$/)
    await expect(stage(page).getByTestId('zone-shrunk-marker')).toHaveCount(1)
    expect(await titleTextOverflow(page)).toBeLessThanOrEqual(1)
    await expect(page.getByTestId('toast')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('takes body text that would overflow its zone, and draws it smaller', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Innholdsgrense')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')
    await page.getByTestId('mode-content').click()

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const zone = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"]`)
    const field = zone.locator('.subfield .tiptap')
    await field.click()
    // insertText lands in one transaction, which is what a paste looks like.
    const sentence = 'Dette er en setning som fyller opp sonen ganske raskt. '.repeat(12)
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.insertText(sentence)
    }

    // Every word is kept …
    await expect
      .poll(() => field.evaluate((element) => element.textContent ?? ''))
      .toBe(sentence.repeat(6))
    // … and drawn smaller, with nothing clipped and nothing refused.
    await expect.poll(() => zone.locator('.zone-fit').getAttribute('data-fit-scale')).not.toBeNull()
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
    await expect(page.getByTestId('toast')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('takes a global font change that no longer fits, and draws the zone smaller', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Fontgrense')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id)
    const zone = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"]`)
    await expect(zone.locator('.zone-fit')).not.toHaveAttribute('data-fit-scale')

    // Monospace is wider than the default proportional font in every font
    // configuration, so this is the same text in a font it no longer fits.
    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
    await page.getByTestId('theme-body-font').selectOption({ label: 'Consolas' })

    await expect.poll(() => renderedBodyFont(page)).toContain('Consolas')
    await expect(zone.locator('.zone-fit')).toHaveAttribute('data-fit-scale', /^0\.\d+$/)
    await expect(zone.getByTestId('zone-shrunk-marker')).toHaveCount(1)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
    await expect(toast(page, 'Denne fonten')).toHaveCount(0)
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

    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
    await page.getByTestId('theme-body-font').selectOption({ label: 'Consolas' })
    await expect
      .poll(() => renderedBodyFont(page))
      .toContain('Consolas')
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('takes a subfield split that no longer fits, and draws the zone smaller', async ({ page }) => {
    await createPresentation(page, 'Subfeltgrense')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id)
    const zone = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"]`)

    await enterZoneMode(page)
    const count = page.getByTestId('subfield-count')
    await count.fill('2')
    await expect(zone.locator('.subfield')).toHaveCount(2)
    await expect(zone.locator('.zone-fit')).toHaveAttribute('data-fit-scale', /^0\.\d+$/)
    await expect(zone.getByTestId('zone-shrunk-marker')).toHaveCount(1)
    await expect(toast(page, 'subfeltene deler sonen')).toHaveCount(0)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('takes a content-kind conversion that no longer fits, and draws the zone smaller', async ({ page }) => {
    await createPresentation(page, 'Konvertering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await fillZoneToCapacity(page, zones[0].id)
    const zone = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"]`)

    await enterZoneMode(page)
    // A titled card spends the header height and the card padding on chrome.
    await chooseKindInInspector(page, 'titled-card')
    await expect(zone.locator('[data-content-kind]').first()).toHaveAttribute('data-content-kind', 'titled-card')
    await expect(zone.locator('.zone-fit')).toHaveAttribute('data-fit-scale', /^0\.\d+$/)
    await expect(zone.getByTestId('zone-shrunk-marker')).toHaveCount(1)
    await expect(toast(page, 'innholdstypen')).toHaveCount(0)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('never paints content outside its zone', async ({ page }) => {
    await createPresentation(page, 'Klipping')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')

    // The clip is on the content box rather than on the zone element, so a
    // card can cast a shadow into the gap. That only preserves containment if
    // the box that clips is exactly the zone's box — assert both halves.
    const containment = await page.evaluate(() => {
      const zone = document.querySelector('[data-testid="stage-slide"] .slide-zone') as HTMLElement
      const content = zone.querySelector('.zone-content') as HTMLElement
      const outer = zone.getBoundingClientRect()
      const inner = content.getBoundingClientRect()
      return {
        clips: getComputedStyle(content).overflow,
        drift: Math.max(
          Math.abs(inner.left - outer.left),
          Math.abs(inner.top - outer.top),
          Math.abs(inner.right - outer.right),
          Math.abs(inner.bottom - outer.bottom),
        ),
      }
    })
    expect(containment.clips).toBe('hidden')
    expect(containment.drift).toBeLessThanOrEqual(0.5)
  })
})
