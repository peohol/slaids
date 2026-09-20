/**
 * Alignment: where text sits on its line, and where content sits in its field.
 *
 * Both are stored on the document rather than applied as styling at render
 * time, so the editor, the slide and the offscreen measurement agree.
 */

import { expect, test } from './fixtures'
import { inkMargins } from './png'
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

    // A picture is narrower than the column, and a block nobody has aligned is
    // centred — the same default the words around it start from.
    const start = await margins()
    expect(start.left).toBeGreaterThan(0)
    expect(Math.abs(start.left - start.right)).toBeLessThanOrEqual(1)

    await wrapper.click()
    await page.getByTestId('align-left').click()
    await expect.poll(async () => (await margins()).left).toBe(0)
    expect((await margins()).right).toBeGreaterThan(0)

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

    // The caret is in the second paragraph; only that one moves, and the one
    // left alone keeps the default every new paragraph starts from.
    await page.getByTestId('align-right').click()
    const alignments = () =>
      field.locator('p').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).textAlign))
    expect(await alignments()).toEqual(['center', 'right'])

    // A selection across both aligns both.
    await field.click()
    await page.keyboard.press('Control+a')
    await page.getByTestId('align-left').click()
    expect(await alignments()).toEqual(['left', 'left'])
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

    // Explicitly, because the top is no longer where a field starts out.
    await align('top')
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

  test('starts a new field centred on both axes', async ({ page }) => {
    await createPresentation(page, 'Standard i innhold')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield').first()
    await field.locator('.tiptap').click()
    await page.keyboard.type('Uten at noen har valgt noe')

    /*
     * Where the one line of text sits in the field it was given. Centred on
     * both axes means the space left over is shared equally above and below it,
     * and equally to the left and right — measured rather than read off a style,
     * because that is the claim: a field nobody has aligned looks aligned.
     */
    const slack = async (): Promise<{ x: number; y: number }> =>
      page.evaluate(() => {
        const outer = (
          document.querySelector('[data-testid="stage-slide"] .subfield') as HTMLElement
        ).getBoundingClientRect()
        const line = document.createRange()
        line.selectNodeContents(
          document.querySelector('[data-testid="stage-slide"] .subfield p') as HTMLElement,
        )
        const text = line.getBoundingClientRect()
        return {
          x: text.left - outer.left - (outer.right - text.right),
          y: text.top - outer.top - (outer.bottom - text.bottom),
        }
      })

    const editing = await slack()
    expect(Math.abs(editing.x)).toBeLessThan(2)
    expect(Math.abs(editing.y)).toBeLessThan(2)

    // And the static renderer — presentation mode, the filmstrip, the offscreen
    // fit measurement — puts it in the same place.
    await enterZoneMode(page)
    const presented = await slack()
    expect(Math.abs(presented.x - editing.x)).toBeLessThan(1)
    expect(Math.abs(presented.y - editing.y)).toBeLessThan(1)
  })

  test('carries a list’s markers along when the list is centred', async ({ page }) => {
    await createPresentation(page, 'Midtstilt liste')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.keyboard.type('- Kort')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Et merkbart lengre punkt i den samme lista')
    await expect(stage(page).locator('.subfield li')).toHaveCount(2)

    /**
     * The empty space to either side of each item's ink, across the full width
     * of the list.
     *
     * Measured off the pixels, because the bug this pins down is about a
     * *marker*: a bullet is painted by a pseudo-element, so there is no node to
     * measure at all. It is painted outside its item too, out in the list's
     * own padding — so the crop is the list's width and one item's worth of
     * rows, and cropping to the item would crop the bug out of the picture.
     * The ink is then the bullet and the words together, and that pair is what
     * has to sit in the middle.
     */
    const list = stage(page).locator('.subfield :is(ul, .rd-ul)')
    const margins = async (): Promise<{ left: number; right: number }[]> => {
      const bands = await list.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return [...element.children].map((item) => {
          const rect = item.getBoundingClientRect()
          return {
            x: box.left + scrollX,
            y: rect.top + scrollY,
            width: box.width,
            height: rect.height,
          }
        })
      })
      return Promise.all(
        bands.map(async (clip) => inkMargins(await page.screenshot({ clip }))),
      )
    }

    const centred = await margins()
    for (const item of centred) {
      expect(item.left).toBeGreaterThan(0)
      // Antialiasing and a glyph's own side bearing, not a difference in where
      // the line was placed.
      expect(Math.abs(item.left - item.right)).toBeLessThanOrEqual(4)
    }
    // Each line finds its own middle: a block shifted as a whole would move the
    // short item and the long one by the same amount.
    expect(centred[0].left).toBeGreaterThan(centred[1].left + 10)

    // The static renderer — presentation mode, the filmstrip, the offscreen fit
    // measurement — puts them in the same places.
    await enterZoneMode(page)
    const presented = await margins()
    for (const [index, item] of presented.entries()) {
      expect(Math.abs(item.left - centred[index].left)).toBeLessThanOrEqual(4)
    }

    // And left-aligned the words go back flush against the column, which is
    // what says the centring was the alignment's doing rather than something
    // done to every list. There the marker hangs outside the column the way a
    // bullet always has, so it is the words that end up flush.
    await enterContentMode(page)
    await field.click()
    await page.keyboard.press('Control+a')
    await page.getByTestId('align-left').click()
    await expect.poll(async () => (await margins()).map((item) => item.left > 20)).toEqual([
      false,
      false,
    ])
  })

  test('shows a placeholder where the text it stands in for will be', async ({ page }) => {
    await createPresentation(page, 'Plassholder')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    /*
     * A title is centred, so its placeholder has to be — it used to sit at the
     * far left and jump to the middle at the first keystroke.
     *
     * Where the ink is, is the whole question — the same `inkMargins` the
     * centred list above is measured with.
     */
    const ink = async (selector: string) =>
      inkMargins(await stage(page).locator(selector).screenshot())

    const empty = await ink('[data-testid="slide-title"]')
    expect(empty.left).toBeGreaterThan(10)
    expect(Math.abs(empty.left - empty.right)).toBeLessThanOrEqual(4)

    // And the text that replaces it lands in the same place, which is the
    // point of a placeholder standing where the words will.
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Slidetittel')
    const typed = await ink('[data-testid="slide-title"]')
    expect(Math.abs(typed.left - empty.left)).toBeLessThanOrEqual(4)
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
