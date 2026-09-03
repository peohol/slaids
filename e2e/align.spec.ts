/**
 * Alignment: where text sits on its line, and where content sits in its field.
 *
 * Both are stored on the document rather than applied as styling at render
 * time, so the editor, the slide and the offscreen measurement agree.
 */

import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  stage,
  waitForSaved,
  watchForErrors,
  worstOverflow,
  zoneRects,
} from './helpers'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#4d6680"/><circle cx="50" cy="30" r="20" fill="#d9ccbf"/></svg>`

test.describe('alignment', () => {
  test('centres slide titles and card titles by default', async ({ page }) => {
    await createPresentation(page, 'Standardjustering')
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Midtstilt tittel')

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')
    await stage(page).locator('.card-header .tiptap').click()
    await page.keyboard.type('Korttittel')

    // `text-align: center` on a box only as wide as its own text centres
    // nothing, so what is asserted is where the text actually sits: the
    // editor's wrapper has to fill the header for the rule to mean anything.
    const offsets = async (): Promise<number[]> =>
      Promise.all(
        ['[data-testid="slide-title"]', '.card-header'].map((host) =>
          stage(page)
            .locator(`${host} p`)
            .first()
            .evaluate((element, hostSelector) => {
              const box = element.getBoundingClientRect()
              const around = (element.closest(hostSelector) as HTMLElement).getBoundingClientRect()
              return Math.abs((box.left + box.right) / 2 - (around.left + around.right) / 2)
            }, host),
        ),
      )
    for (const offset of await offsets()) expect(offset).toBeLessThan(2)

    // And the static renderer agrees, which is what the offscreen fit
    // measurement sees.
    await page.getByTestId('mode-zone').click()
    for (const offset of await offsets()) expect(offset).toBeLessThan(2)
  })

  test('aligns a picture that sits among the text', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Bildejustering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Tekst over bildet.')
    await page.getByTestId('open-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'bilde.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    const wrapper = stage(page).locator('.rd-image-wrapper').first()
    await expect(wrapper).toBeVisible()

    /** Distance from the column's left and right edge to the picture. */
    const margins = async (): Promise<{ left: number; right: number }> =>
      page.evaluate(() => {
        const element = document.querySelector(
          '[data-testid="stage-slide"] .rd-image-wrapper',
        ) as HTMLElement
        const box = element.getBoundingClientRect()
        const column = (element.parentElement as HTMLElement).getBoundingClientRect()
        // `Math.abs` before rounding: a hair of sub-pixel drift the wrong way
        // rounds to `-0`, which is a needlessly surprising thing to assert on.
        return {
          left: Math.round(Math.abs(box.left - column.left)),
          right: Math.round(Math.abs(column.right - box.right)),
        }
      })

    // A picture is narrower than the column, so it starts at the left edge.
    const start = await margins()
    expect(start.left).toBe(0)
    expect(start.right).toBeGreaterThan(0)

    await wrapper.click()
    await page.getByTestId('align-center').click()
    await expect.poll(async () => (await margins()).left).toBeGreaterThan(0)
    const centred = await margins()
    expect(Math.abs(centred.left - centred.right)).toBeLessThanOrEqual(1)

    await wrapper.click()
    await page.getByTestId('align-right').click()
    await expect.poll(async () => (await margins()).right).toBe(0)
    expect((await margins()).left).toBeGreaterThan(0)

    // Moving a picture sideways cannot make it stop fitting.
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)

    // The static renderer puts it in the same place, and it survives a reload.
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(stage(page).locator('.rd-image-wrapper')).toBeVisible()
    expect((await margins()).right).toBe(0)
    expect(guard.errors).toEqual([])
  })

  test('aligns one paragraph at a time, and a selection all at once', async ({ page }) => {
    await createPresentation(page, 'Avsnittsjustering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.keyboard.type('Første avsnitt')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Andre avsnitt')

    // The caret is in the second paragraph; only that one moves.
    await page.getByTestId('align-right').click()
    const alignments = () =>
      field.locator('p').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).textAlign))
    expect(await alignments()).toEqual(['start', 'right'])

    // A selection across both aligns both.
    await field.click()
    await page.keyboard.press('Control+a')
    await page.getByTestId('align-center').click()
    expect(await alignments()).toEqual(['center', 'center'])
  })

  test('moves content within the height its field is given', async ({ page }) => {
    await createPresentation(page, 'Vertikaljustering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield').first()
    await field.locator('.tiptap').click()
    await page.keyboard.type('Litt tekst')

    const topOffset = async (): Promise<number> => {
      const box = await field.locator('p').first().boundingBox()
      const outer = await field.boundingBox()
      if (!box || !outer) throw new Error('missing geometry')
      return box.y - outer.y
    }

    /*
     * Where the text sits while it is edited, and where the static renderer
     * puts it. The two have to be the same number: the static renderer is what
     * presentation mode draws, what a shared deck serves and what the offscreen
     * fit measurement reads — and a centred field used to look centred in the
     * editor and jump straight back to the top the moment it was presented.
     */
    const placements = async (): Promise<{ editing: number; presented: number }> => {
      const editing = await topOffset()
      await enterZoneMode(page)
      const presented = await topOffset()
      await enterContentMode(page)
      return { editing, presented }
    }

    const align = async (value: 'top' | 'middle' | 'bottom'): Promise<void> => {
      await field.locator('.tiptap').click()
      await page.getByTestId(`valign-${value}`).click()
      await page.waitForTimeout(150)
    }

    const atTop = await placements()
    await align('bottom')
    const atBottom = await placements()
    await align('middle')
    const atMiddle = await placements()

    expect(atBottom.editing).toBeGreaterThan(atTop.editing + 50)
    expect(atMiddle.editing).toBeGreaterThan(atTop.editing + 10)
    expect(atMiddle.editing).toBeLessThan(atBottom.editing - 10)

    for (const [name, placement] of Object.entries({ atTop, atMiddle, atBottom })) {
      expect(Math.abs(placement.presented - placement.editing), name).toBeLessThan(1)
    }

    // Moving text within a box it already fits in cannot make it stop fitting.
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('keeps alignment through a reload', async ({ page }) => {
    await createPresentation(page, 'Justering lagres')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.keyboard.type('Justert tekst')
    await page.getByTestId('align-right').click()
    await page.getByTestId('valign-bottom').click()
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', {
      timeout: 10_000,
    })

    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    const align = await stage(page)
      .locator('.subfield p')
      .first()
      .evaluate((element) => getComputedStyle(element).textAlign)
    expect(align).toBe('right')
    await expect(stage(page).locator('.subfield').first()).toHaveAttribute('data-align', 'bottom')
  })
})
