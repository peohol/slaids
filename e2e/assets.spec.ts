import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  worstOverflow,
  zoneRects,
} from './helpers'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#4d6680"/><circle cx="50" cy="30" r="20" fill="#d9ccbf"/></svg>`

test.describe('assets', () => {
  test('uploads an SVG into a zone and keeps it after a reload', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Figurer')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-image').click()
    await expect(page.getByTestId('image-modal')).toBeVisible()

    await page.getByTestId('image-input').setInputFiles({
      name: 'figur.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })

    await expect(page.getByTestId('image-modal')).toBeHidden()
    const image = stage(page).locator('img.image-panel__img')
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', /^blob:/)

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(stage(page).locator('img.image-panel__img')).toBeVisible()
    expect(guard.errors).toEqual([])
  })

  test('inserts an image inline in a card body', async ({ page }) => {
    await createPresentation(page, 'Inline bilde')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()

    await page.getByTestId('open-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'inline.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })

    await expect(stage(page).locator('.rd-image-wrapper img')).toBeVisible()
  })

  test('fits a picture into a short field instead of refusing it', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Bilde i lavt felt')
    await enterZoneMode(page)
    // Half a slide, less the title zone: short enough that a picture sized for
    // a full-height zone would be rolled back, and tall enough that one scaled
    // to the room left is still worth inserting.
    await splitSelected(page, [1, 1], 'y')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')

    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.keyboard.type('Tekst som skal bli stående.')

    await page.getByTestId('open-image').click()
    await expect(page.getByTestId('image-placement-inline')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('image-input').setInputFiles({
      name: 'lite.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })

    // Both the picture and the text it was inserted next to survive: a picture
    // sized for a full-height zone would have been rolled back for overflow.
    await expect(stage(page).locator('.rd-image-wrapper img')).toBeVisible()
    await expect(stage(page)).toContainText('Tekst som skal bli stående.')
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
    expect(guard.errors).toEqual([])
  })

  test('resizes a picture by dragging, keeping its proportions', async ({ page }) => {
    await createPresentation(page, 'Dra bildet')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.getByTestId('open-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'dra.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })

    const wrapper = stage(page).locator('.rd-image-wrapper').first()
    await expect(wrapper).toBeVisible()
    const shape = async (): Promise<{ share: number; aspect: number }> =>
      page.evaluate(() => {
        const element = document.querySelector(
          '[data-testid="stage-slide"] .rd-image-wrapper',
        ) as HTMLElement
        const column = element.parentElement as HTMLElement
        const box = element.getBoundingClientRect()
        return {
          share: box.width / column.getBoundingClientRect().width,
          aspect: box.width / box.height,
        }
      })

    const before = await shape()
    await wrapper.hover()
    const handle = page.getByTestId('image-resize-handle').first()
    const box = await handle.boundingBox()
    if (!box) throw new Error('no resize handle')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()

    await expect
      .poll(async () => (await shape()).share, { message: 'dragging narrows the picture' })
      .toBeLessThan(before.share - 0.05)
    // The picture is never distorted: only the width is dragged, the height
    // follows from the stored aspect ratio.
    expect((await shape()).aspect).toBeCloseTo(before.aspect, 1)
  })

  test('never lets a dragged picture grow past the zone', async ({ page }) => {
    await createPresentation(page, 'Bildet stopper')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'y')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('En linje tekst.')
    await page.getByTestId('open-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'stopp.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })

    const wrapper = stage(page).locator('.rd-image-wrapper').first()
    await expect(wrapper).toBeVisible()
    await wrapper.hover()
    const handle = page.getByTestId('image-resize-handle').first()
    const box = await handle.boundingBox()
    if (!box) throw new Error('no resize handle')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 1200, box.y + box.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    await expect(stage(page).locator('.rd-image-wrapper img')).toBeVisible()
    await expect(stage(page)).toContainText('En linje tekst.')
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('exports and re-imports a presentation with its assets', async ({ page }) => {
    await createPresentation(page, 'Med figur')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'figur.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(stage(page).locator('img.image-panel__img')).toBeVisible()
    await waitForSaved(page)

    await page.getByTestId('back-to-library').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('export-presentation').click()
    const file = await download
    const path = await file.path()

    await page.getByTestId('import-input').setInputFiles(path)
    await expect(page.getByTestId('presentation-card')).toHaveCount(2)

    await page.getByTestId('open-presentation').first().click()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(stage(page).locator('img.image-panel__img')).toBeVisible()
  })
})
