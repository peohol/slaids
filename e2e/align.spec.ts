/**
 * Alignment: where text sits on its line, and where content sits in its field.
 *
 * Both are stored on the document rather than applied as styling at render
 * time, so the editor, the slide and the offscreen measurement agree.
 */

import { expect, test } from './fixtures'
import { addContentToZone, createPresentation, stage, zoneRects } from './helpers'

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

    const atTop = await topOffset()
    await page.getByTestId('valign-bottom').click()
    await page.waitForTimeout(150)
    const atBottom = await topOffset()
    expect(atBottom).toBeGreaterThan(atTop + 50)

    await page.getByTestId('valign-middle').click()
    await page.waitForTimeout(150)
    const atMiddle = await topOffset()
    expect(atMiddle).toBeGreaterThan(atTop + 10)
    expect(atMiddle).toBeLessThan(atBottom - 10)
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
