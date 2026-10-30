/**
 * Optimising pictures, in a real browser.
 *
 * The unit tests pin the arithmetic and the order of the writes with the pixel
 * work faked; what only a browser can show is the pixel work itself — that the
 * decoder, the canvas and the encoder together turn a large photograph into a
 * small file that still looks like the crop the frame was showing — and that
 * the editor survives the swap: the picture stays put, the store shrinks, and
 * a reload finds the new file.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  createPresentation,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
  chooseFromToolbarMenu,
} from './helpers'

/** A picture far larger than any zone: the case the optimiser exists for. */
const PHOTO_WIDTH = 2400
const PHOTO_HEIGHT = 1800

/**
 * A photograph, or near enough: a gradient under a few thousand coloured
 * blotches, with a little noise on every pixel the way a sensor leaves it, so
 * the pixels are neither flat nor few-coloured and the optimiser classifies
 * them as a photo. Drawn in the page, because the page has the encoder — a
 * hand-written PNG of this size would be the test, not the fixture.
 */
async function photograph(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([width, height]) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      const sky = context.createLinearGradient(0, 0, 0, height)
      sky.addColorStop(0, '#1b3a6b')
      sky.addColorStop(1, '#f2c14e')
      context.fillStyle = sky
      context.fillRect(0, 0, width, height)
      let seed = 7
      const random = (): number => {
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647
      }
      for (let i = 0; i < 4000; i += 1) {
        context.fillStyle = `hsl(${random() * 360} 60% ${30 + random() * 50}%)`
        context.beginPath()
        context.arc(random() * width, random() * height, 2 + random() * 30, 0, Math.PI * 2)
        context.fill()
      }
      const pixels = context.getImageData(0, 0, width, height)
      for (let i = 0; i < pixels.data.length; i += 4) {
        const grain = Math.floor(random() * 9) - 4
        pixels.data[i] = Math.max(0, Math.min(255, pixels.data[i] + grain))
        pixels.data[i + 1] = Math.max(0, Math.min(255, pixels.data[i + 1] + grain))
        pixels.data[i + 2] = Math.max(0, Math.min(255, pixels.data[i + 2] + grain))
      }
      context.putImageData(pixels, 0, 0)
      return canvas.toDataURL('image/png')
    },
    [PHOTO_WIDTH, PHOTO_HEIGHT],
  )
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

interface StoredFile {
  id: string
  size: number
  width: number
  height: number
  mimeType: string
}

/** What the browser's own store holds, straight from IndexedDB. */
async function storedFiles(page: Page): Promise<StoredFile[]> {
  return page.evaluate(async () => {
    const open = indexedDB.open('slaids')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const rows = await new Promise<
      { id: string; blob: Blob; width: number; height: number; mimeType: string }[]
    >((resolve, reject) => {
      const request = database.transaction('assets').objectStore('assets').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return rows.map((row) => ({
      id: row.id,
      size: row.blob.size,
      width: row.width,
      height: row.height,
      mimeType: row.mimeType,
    }))
  })
}

/** The picture on the stage, as the browser drew it. */
async function drawnPicture(page: Page, index = 0) {
  return page.evaluate((nth) => {
    const images = document.querySelectorAll<HTMLImageElement>(
      '[data-testid="stage-slide"] .image-panel__img',
    )
    const image = images[nth]
    const panel = image.closest('.image-panel') as HTMLElement
    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      objectPosition: getComputedStyle(image).objectPosition,
      cropped: panel.hasAttribute('data-image-cropped'),
      frame: { width: panel.offsetWidth, height: panel.offsetHeight },
    }
  }, index)
}

/** Fill a zone with the photograph through the picker the empty zone shows. */
async function fillZoneWithPhoto(page: Page, zoneId: string, photo: Buffer): Promise<void> {
  await stage(page)
    .locator(`.slide-zone[data-node-id="${zoneId}"] [data-testid="empty-zone-image"]`)
    .click()
  await expect(page.getByTestId('image-modal')).toBeVisible()
  await page.getByTestId('image-input').setInputFiles({
    name: 'ferie.png',
    mimeType: 'image/png',
    buffer: photo,
  })
  await expect(page.getByTestId('image-modal')).toBeHidden()
}

test.describe('optimising pictures', () => {
  test('crops and downscales a large photograph to what its frame shows, and the deck survives it', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Bildeoptimalisering')
    const photo = await photograph(page)

    // Two zones side by side: a frame half a slide wide, nowhere near 2000 px.
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await fillZoneWithPhoto(page, zones[0].id, photo)

    const before = await drawnPicture(page)
    expect(before.naturalWidth).toBe(PHOTO_WIDTH)
    // A 4:3 photograph behind a taller frame: the sides are hidden.
    expect(before.cropped).toBe(true)
    await waitForSaved(page)
    const [original] = await storedFiles(page)
    expect(original.size).toBe(photo.byteLength)

    // The inspector shows the file and offers to shrink it.
    await expect(page.getByTestId('image-file-info')).toContainText(`${PHOTO_WIDTH} × ${PHOTO_HEIGHT} px`)
    await page.getByTestId('optimize-image').click()
    await expect(page.getByTestId('optimize-modal')).toBeVisible()

    // The analysis says what it will do, and what it will cost: nothing has
    // been written yet, and the crop is called what it is.
    const operations = page.getByTestId('optimize-operations')
    await expect(operations).toBeVisible()
    await expect(operations.locator('[data-operation="crop"]')).toBeVisible()
    await expect(operations.locator('[data-operation="downscale"]')).toBeVisible()
    await expect(operations.locator('[data-operation="metadata"]')).toBeVisible()
    await expect(page.getByTestId('optimize-crop-warning')).toBeVisible()
    await expect(page.getByTestId('optimize-undo-note')).toBeVisible()
    expect((await storedFiles(page)).map((file) => file.id)).toEqual([original.id])

    await page.getByTestId('optimize-confirm').click()
    await expect(page.getByTestId('optimize-done')).toBeVisible()
    await page.getByTestId('optimize-close').click()
    await expect(page.getByTestId('optimize-modal')).toBeHidden()

    // The new file is the frame's shape at two pixels per logical pixel, so
    // nothing is hidden any more and the picture sits exactly where it was.
    const after = await drawnPicture(page)
    expect(after.naturalWidth).toBeLessThan(PHOTO_WIDTH)
    expect(after.naturalWidth).toBeLessThanOrEqual(Math.ceil(zones[0].w * 2) + 1)
    expect(after.naturalWidth / after.naturalHeight).toBeCloseTo(zones[0].w / zones[0].h, 1)
    expect(after.cropped).toBe(false)
    expect(after.objectPosition).toBe('50% 50%')

    // One file in the store — the old one is gone — and it is a great deal smaller.
    await waitForSaved(page)
    const files = await storedFiles(page)
    expect(files).toHaveLength(1)
    expect(files[0].id).not.toBe(original.id)
    expect(files[0].width).toBe(after.naturalWidth)
    expect(files[0].size).toBeLessThan(original.size / 2)
    expect(['image/webp', 'image/jpeg', 'image/png']).toContain(files[0].mimeType)

    // The whole-deck dialog now has nothing left to do.
    await chooseFromToolbarMenu(page, 'presentation', 'optimize-images')
    await expect(page.getByTestId('optimize-nothing')).toBeVisible()
    await expect(page.getByTestId('optimize-confirm')).toHaveCount(0)
    await page.getByTestId('optimize-cancel').click()

    // And the deck comes back from the store pointing at the new file.
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    const reloaded = await drawnPicture(page)
    expect(reloaded.naturalWidth).toBe(after.naturalWidth)
    expect(reloaded.cropped).toBe(false)
    expect(guard.errors).toEqual([])
  })

  test('stores one file for two identical uploads, downscales it for both, and forks it for the panel that is cropped', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Delt bilde')
    const photo = await photograph(page)

    // Unequal zones, so the same file is shown at two sizes and two crops.
    await enterZoneMode(page)
    await splitSelected(page, [2, 1], 'x')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await fillZoneWithPhoto(page, zones[0].id, photo)
    await fillZoneWithPhoto(page, zones[1].id, photo)
    await waitForSaved(page)

    // The second upload was the same bytes: one file, shown twice.
    expect(await storedFiles(page)).toHaveLength(1)
    expect((await drawnPicture(page, 1)).naturalWidth).toBe(PHOTO_WIDTH)

    // The whole deck: a file shown in two frames is downscaled to what the
    // wider one needs and cropped for neither — two frames show two different
    // parts of it. Both panels keep their crop, over one smaller file.
    await chooseFromToolbarMenu(page, 'presentation', 'optimize-images')
    await expect(page.getByTestId('optimize-summary')).toBeVisible()
    await expect(page.getByTestId('optimize-counts')).toContainText('skaleres ned')
    await expect(page.getByTestId('optimize-crop-warning')).toHaveCount(0)
    await page.getByTestId('optimize-confirm').click()
    await expect(page.getByTestId('optimize-done')).toBeVisible()
    await page.getByTestId('optimize-close').click()
    await waitForSaved(page)

    const shared = await storedFiles(page)
    expect(shared).toHaveLength(1)
    expect(shared[0].width).toBeLessThan(PHOTO_WIDTH)
    expect(shared[0].width).toBeGreaterThanOrEqual(Math.floor(zones[0].w * 2) - 1)
    const wide = await drawnPicture(page, 0)
    const narrow = await drawnPicture(page, 1)
    expect(wide.naturalWidth).toBe(shared[0].width)
    expect(narrow.naturalWidth).toBe(shared[0].width)
    expect(wide.cropped).toBe(true)
    expect(narrow.cropped).toBe(true)

    // Optimising the narrow panel alone crops for it, and must not touch the
    // wide panel's view of the same file: a fork, with the original kept.
    await stage(page).locator(`.slide-zone[data-node-id="${zones[1].id}"] .image-panel`).click()
    await page.getByTestId('optimize-image').click()
    await expect(page.getByTestId('optimize-fork-note')).toBeVisible()
    await page.getByTestId('optimize-confirm').click()
    await expect(page.getByTestId('optimize-done')).toBeVisible()
    await page.getByTestId('optimize-close').click()
    await waitForSaved(page)

    const forked = await storedFiles(page)
    expect(forked).toHaveLength(2)
    expect(forked.some((file) => file.id === shared[0].id)).toBe(true)
    expect((await drawnPicture(page, 0)).naturalWidth).toBe(shared[0].width)
    expect((await drawnPicture(page, 0)).cropped).toBe(true)
    const cropped = await drawnPicture(page, 1)
    expect(cropped.naturalWidth).toBeLessThan(shared[0].width)
    expect(cropped.cropped).toBe(false)
    expect(guard.errors).toEqual([])
  })
})
