/**
 * How a card is painted: its shadow, and the seam between a coloured header and
 * the card beneath it.
 *
 * Both are things the DOM cannot answer — a computed style says what was asked
 * for, not what the screen ended up with — so these read the pixels.
 */

import { expect, test } from './fixtures'
import { addContentToZone, createPresentation, stage, zoneRects } from './helpers'
import { decodePng, lightestBleed } from './png'

// The artefact this file is about lives in the antialiasing of a scaled,
// rounded edge, so it needs the sub-pixel grid a retina screen has.
test.use({ deviceScaleFactor: 2 })

test.describe('card chrome', () => {
  test('leaves no pale fringe along a coloured header', async ({ page }) => {
    await createPresentation(page, 'Kant')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')
    await stage(page).locator('.card-header .tiptap').click()
    await page.keyboard.type('Tittel')
    // Take the caret out of the header so no selection is painted into the seam.
    await stage(page).click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(300)

    const header = await stage(page).locator('.card-header').first().boundingBox()
    if (!header) throw new Error('no card header')
    // The seam: a strip spanning the slide above the card, the card's top edge
    // and its rounded top-left corner.
    const shot = await page.screenshot({
      clip: { x: header.x - 6, y: header.y - 6, width: Math.min(220, header.width), height: 26 },
    })
    const bitmap = decodePng(shot)
    const slide = bitmap.at(1, 1)
    const headerColour = bitmap.at(Math.round(bitmap.width / 2), bitmap.height - 2)

    // A white card painted behind the header used to bleed through the
    // antialiased corner and along the top edge, which the slide is drawn at a
    // fractional scale so it lands on. Nothing is painted behind the header
    // now, so the only two colours meeting here are the header and the slide.
    expect(lightestBleed(bitmap, slide, headerColour)).toBeLessThanOrEqual(3)
  })

  test('casts its shadow into the gap', async ({ page }) => {
    await createPresentation(page, 'Skygge')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')

    // An outer shadow, not an inset one: an inset light edge is drawn *over* a
    // titled card's header and reads as a hairline around the colour panel.
    const shadow = await stage(page)
      .locator('.zone-content--card')
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

    // And it is really there on screen: the slide right next to the card is
    // darker than the slide a little further out. The strip starts one pixel
    // clear of the card — the card's own edge lands mid-pixel at this scale —
    // and stops short of the slide's edge, so both samples are slide
    // background: one with the shadow falling on it, one without.
    const card = await stage(page).locator('.zone-content--card').first().boundingBox()
    const slide = await stage(page).boundingBox()
    if (!card || !slide) throw new Error('no card')
    const from = card.x + card.width + 1
    const width = Math.min(10, slide.x + slide.width - 1 - from)
    expect(width).toBeGreaterThan(4)
    const shot = await page.screenshot({
      clip: { x: from, y: card.y + card.height / 2, width, height: 4 },
    })
    const bitmap = decodePng(shot)
    const sum = (pixel: readonly number[]): number => pixel[0] + pixel[1] + pixel[2]
    const beside = sum(bitmap.at(0, 2))
    const away = sum(bitmap.at(bitmap.width - 1, 2))
    expect(beside).toBeLessThan(away - 20)
  })
})
