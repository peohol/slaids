/**
 * Pictures as a content type of their own.
 *
 * A picture in a zone fills it edge to edge and is cropped, never letterboxed,
 * so the two things worth checking in a browser are the crop itself — which is
 * the layout engine's, not ours — and the caption, whose shape depends on which
 * edge it hangs from.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  dismissImageModal,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

/**
 * A file far wider than any zone, so `cover` has to hide something. The bands
 * make which part is on screen visible to a human reading a failure screenshot.
 */
const WIDE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200">` +
  `<rect width="200" height="200" fill="#c04040"/>` +
  `<rect x="200" width="200" height="200" fill="#40a060"/>` +
  `<rect x="400" width="200" height="200" fill="#4070d0"/>` +
  `<rect x="600" width="200" height="200" fill="#d0b040"/>` +
  `</svg>`

/** The picture panel on the stage. Thumbnails draw the same markup. */
function panel(page: Page) {
  return stage(page).locator('.image-panel')
}

async function fillZoneWithPicture(page: Page): Promise<void> {
  // Choosing a picture for an empty zone is choosing a file: the upload dialog
  // opens by itself, over the empty panel it will fill.
  await page.getByTestId('empty-zone-image').click()
  await expect(panel(page)).toBeVisible()
  await expect(page.getByTestId('image-modal')).toBeVisible()
  await page.getByTestId('image-input').setInputFiles({
    name: 'bånd.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(WIDE_SVG),
  })
  await expect(page.getByTestId('image-modal')).toBeHidden()
  await expect(stage(page).locator('img.image-panel__img')).toBeVisible()
}

/**
 * Add a caption and write in it.
 *
 * A new caption takes the caret by itself, which is the whole point of it — but
 * the editor mounts a frame or two after the click that created it, and a
 * keystroke sent the instant the box appears lands nowhere. The lost letter is
 * the first one, so the assertion fails on «ildetekst» and reads like the
 * typing broke rather than the waiting. Waiting for the field to actually hold
 * the focus is what makes this deterministic; a human cannot type inside two
 * frames, so there is nothing here for the app to fix.
 */
async function captionWith(
  page: Page,
  position: 'top' | 'middle' | 'bottom',
  text: string,
): Promise<void> {
  await page.getByTestId(`caption-position-${position}`).click()
  await expect(stage(page).locator('.image-caption .tiptap')).toBeFocused()
  await page.keyboard.type(text)
  await expect(stage(page).locator('.image-caption')).toContainText(text)
}

test.describe('pictures', () => {
  test('offers a picture as a content type and fills the zone with it', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Bilde i sone')

    await expect(page.getByTestId('empty-zone-image')).toBeVisible()
    await expect(page.getByTestId('empty-zone-titled-image-card')).toBeVisible()
    await fillZoneWithPicture(page)

    const zones = await zoneRects(page)
    const drawn = await page.evaluate(() => {
      const element = document.querySelector(
        '[data-testid="stage-slide"] .image-panel',
      ) as HTMLElement
      const image = element.querySelector('.image-panel__img') as HTMLElement
      const style = getComputedStyle(image)
      return {
        width: element.offsetWidth,
        height: element.offsetHeight,
        objectFit: style.objectFit,
        objectPosition: style.objectPosition,
        radius: getComputedStyle(element).borderTopLeftRadius,
        shadow: getComputedStyle(element).boxShadow,
        cropped: element.hasAttribute('data-image-cropped'),
      }
    })

    // Edge to edge: the picture is the zone, not a figure inside it.
    expect(Math.round(drawn.width)).toBe(Math.round(zones[0].w))
    expect(Math.round(drawn.height)).toBe(Math.round(zones[0].h))
    // Cropped rather than letterboxed, and centred until somebody drags it.
    expect(drawn.objectFit).toBe('cover')
    expect(drawn.objectPosition).toBe('50% 50%')
    expect(drawn.cropped).toBe(true)
    // A card filled to the brim with picture: rounded, and it casts a shadow.
    expect(drawn.radius).not.toBe('0px')
    expect(drawn.shadow).not.toBe('none')
    expect(guard.errors).toEqual([])
  })

  test('lets its shadow fall into the gap, but never off the slide', async ({ page }) => {
    await createPresentation(page, 'Bildeskygge')
    await fillZoneWithPicture(page)

    // A picture fills its frame exactly, so the box that casts the shadow is
    // the picture — and nothing between the two may clip it away. The slide
    // itself does clip: a shadow may fall into the gap, never off the slide.
    const clipped = await page.evaluate(() => {
      const picture = document.querySelector(
        '[data-testid="stage-slide"] .image-panel',
      ) as HTMLElement
      const slide = picture.closest('.slide') as HTMLElement
      for (let node = picture.parentElement; node && node !== slide; node = node.parentElement) {
        if (getComputedStyle(node).overflow !== 'visible') return node.className
      }
      return getComputedStyle(slide).overflow === 'hidden' ? null : 'slide does not clip'
    })
    expect(clipped).toBeNull()
  })

  test('drags the crop, and snaps back to the middle', async ({ page }) => {
    await createPresentation(page, 'Utsnitt')
    await fillZoneWithPicture(page)

    const position = async (): Promise<string> =>
      page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector('[data-testid="stage-slide"] .image-panel__img') as HTMLElement,
          ).objectPosition,
      )

    const box = await panel(page).boundingBox()
    if (!box) throw new Error('fant ikke bildepanelet')
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

    await page.mouse.move(centre.x, centre.y)
    // Hovering a cropped picture shows what the frame is hiding.
    await expect(stage(page).locator('.image-panel__ghost')).toHaveCSS('opacity', '0.32')

    await page.mouse.down()
    await page.mouse.move(centre.x - 220, centre.y, { steps: 10 })
    await page.mouse.up()
    await expect.poll(position).not.toBe('50% 50%')

    // Nudged back towards the middle, it lands exactly on it.
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    await page.mouse.move(centre.x + 219, centre.y, { steps: 10 })
    await page.mouse.up()
    await expect.poll(position).toBe('50% 50%')
  })

  test('hangs a caption from the top, the middle or the floor', async ({ page }) => {
    await createPresentation(page, 'Bildetekst')
    await fillZoneWithPicture(page)

    await captionWith(page, 'bottom', 'Fire bånd')

    const shape = async (): Promise<{ radius: string; top: number; bottom: number }> =>
      page.evaluate(() => {
        const caption = document.querySelector(
          '[data-testid="stage-slide"] .image-caption',
        ) as HTMLElement
        const layer = caption.parentElement as HTMLElement
        const a = caption.getBoundingClientRect()
        const b = layer.getBoundingClientRect()
        return {
          radius: getComputedStyle(caption).borderRadius,
          top: Math.round(a.top - b.top),
          bottom: Math.round(b.bottom - a.bottom),
        }
      })

    // On the floor: flush with the bottom edge, only the top corners rounded.
    let laid = await shape()
    expect(laid.bottom).toBe(0)
    expect(laid.top).toBeGreaterThan(0)
    expect(laid.radius).toMatch(/^\d+px \d+px 0px 0px$/)

    await page.getByTestId('caption-position-top').click()
    laid = await shape()
    expect(laid.top).toBe(0)
    expect(laid.radius).toMatch(/^0px 0px \d+px \d+px$/)

    await page.getByTestId('caption-position-middle').click()
    laid = await shape()
    expect(laid.top).toBeGreaterThan(0)
    expect(laid.bottom).toBeGreaterThan(0)
    expect(laid.radius).toMatch(/^\d+px$/)

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(stage(page).locator('.image-caption')).toContainText('Fire bånd')
  })

  test('throws away a caption that is left empty', async ({ page }) => {
    await createPresentation(page, 'Tom bildetekst')
    await fillZoneWithPicture(page)

    await page.getByTestId('caption-position-bottom').click()
    await expect(stage(page).locator('.image-caption')).toBeVisible()

    // Nothing typed, and the caret goes elsewhere: there is no such thing as an
    // empty caption, only a box drawn over a picture for no reason.
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await expect(stage(page).locator('.image-caption')).toHaveCount(0)
  })

  test('asks before the inspector removes a caption with words in it, as the menu does', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Fjern bildetekst')
    await fillZoneWithPicture(page)
    await captionWith(page, 'bottom', 'Fire bånd')
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()

    const remove = page.getByTestId('caption-remove')
    await expect(remove).toHaveText('Fjern bildeteksten …')
    await remove.click()
    const dialog = page.getByTestId('confirm-dialog')
    await expect(dialog).toContainText('Fire bånd')
    await dialog.getByRole('button', { name: 'Avbryt' }).click()
    await expect(stage(page).locator('.image-caption')).toContainText('Fire bånd')

    await remove.click()
    await page.getByTestId('confirm-accept').click()
    await expect(stage(page).locator('.image-caption')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('will not send a file into a caption, which has nowhere to put it', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Bilde i bildetekst')
    await fillZoneWithPicture(page)

    await captionWith(page, 'bottom', 'En bildetekst')

    // The caret is in the caption, which is one line of text: its schema has no
    // picture node and its editor no insert command. Offering the field anyway
    // stored the file and *then* threw.
    await page.getByTestId('open-image').click()
    await expect(page.getByTestId('image-modal')).toBeVisible()
    await expect(page.getByTestId('image-placement-inline')).toBeDisabled()
    await expect(page.getByTestId('image-placement-zone')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.getByTestId('image-input').setInputFiles({
      name: 'ny.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(WIDE_SVG.replace('#c04040', '#101010')),
    })
    await expect(page.getByTestId('image-modal')).toBeHidden()

    // The file went where the only room for it was: the zone. The caption is
    // still text, and nothing was thrown on the way.
    await expect(stage(page).locator('img.image-panel__img')).toBeVisible()
    await expect(stage(page).locator('.image-caption')).toContainText('En bildetekst')
    await expect(stage(page).locator('.image-caption figure')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('selects the zone it belongs to when a picture is pressed', async ({ page }) => {
    await createPresentation(page, 'Valg av bildesone')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await stage(page)
      .locator(`.slide-zone[data-node-id="${zones[1].id}"] [data-testid="empty-zone-image"]`)
      .click()
    // The dialog the new panel opens is not what this test is about.
    await dismissImageModal(page)
    await expect(page.getByTestId('caption-panel')).toBeVisible()

    // A picture has no text field to focus, so without a press of its own the
    // inspector would keep showing whichever zone was selected last.
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).first().click()
    await expect(page.getByTestId('caption-panel')).toHaveCount(0)

    await panel(page).click()
    await expect(page.getByTestId('caption-panel')).toBeVisible()
  })

  test('puts a title panel over a picture, with the caption below it', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Kort med bilde')
    await page.getByTestId('empty-zone-titled-image-card').click()
    // A titled picture card is a picture too, so it asks for its file at once.
    await expect(page.getByTestId('image-modal')).toBeVisible()
    await dismissImageModal(page)
    await expect(stage(page).locator('.card-header')).toBeVisible()

    await stage(page).locator('.card-header .tiptap').click()
    await page.keyboard.type('Med tittel')
    await expect(stage(page).locator('.card-header')).toContainText('Med tittel')

    // The header is already along the top edge, so the ceiling is not on offer.
    await expect(page.getByTestId('caption-position-top')).toHaveCount(0)
    await expect(page.getByTestId('caption-position-middle')).toBeVisible()
    await expect(page.getByTestId('caption-position-bottom')).toBeVisible()

    // The picture fills the body completely: no padding, no white beneath it.
    const gaps = await page.evaluate(() => {
      const body = document.querySelector(
        '[data-testid="stage-slide"] .card-body--image',
      ) as HTMLElement
      const image = body.querySelector('.image-panel') as HTMLElement
      const a = body.getBoundingClientRect()
      const b = image.getBoundingClientRect()
      return { left: b.left - a.left, top: b.top - a.top, width: a.width - b.width }
    })
    expect(Math.round(gaps.left)).toBe(0)
    expect(Math.round(gaps.top)).toBe(0)
    expect(Math.round(gaps.width)).toBe(0)
    expect(guard.errors).toEqual([])
  })
})
