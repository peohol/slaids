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

  test('lets a card cast its shadow into the gap', async ({ page }) => {
    await createPresentation(page, 'Skygge')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')

    // An outer shadow, not an inset one: an inset light edge is drawn *over* a
    // titled card's header and reads as a hairline around the colour panel.
    const shadow = await page
      .locator('[data-testid="stage-slide"] .zone-content--card')
      .first()
      .evaluate((element) => getComputedStyle(element).boxShadow)
    expect(shadow).not.toBe('none')
    expect(shadow).not.toContain('inset')

    // And nothing between the card and the slide clips it away. The slide
    // itself does clip — a shadow may fall in the gap, never off the slide.
    const clipped = await page.evaluate(() => {
      const card = document.querySelector(
        '[data-testid="stage-slide"] .zone-content--card',
      ) as HTMLElement
      const slide = card.closest('.slide') as HTMLElement
      for (let node = card.parentElement; node && node !== slide; node = node.parentElement) {
        if (getComputedStyle(node).overflow !== 'visible') return node.className
      }
      return getComputedStyle(slide).overflow === 'hidden' ? null : 'slide does not clip'
    })
    expect(clipped).toBeNull()
  })
})
