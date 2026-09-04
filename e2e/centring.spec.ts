/**
 * Centred content is centred.
 *
 * Two things used to make it merely nearly centred, and both are invisible in
 * the document: the last block kept the bottom margin that separates it from
 * the block after it, and inserting a picture left an empty paragraph behind
 * it. A field aligns its whole flow, margins and blank lines included, so both
 * pushed the content up and left more air below it than above.
 *
 * Measured as "space above the flow" against "space below the flow", in the
 * editor and in the static renderer alike — the two have to agree, because the
 * static renderer is what presentation mode draws and what the offscreen fit
 * measurement reads.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  stage,
  waitForSaved,
  worstOverflow,
  zoneRects,
} from './helpers'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#4d6680"/></svg>`

/** The air above and below everything the first field holds. */
async function air(page: Page): Promise<{ above: number; below: number; blocks: number }> {
  return page.evaluate(() => {
    const field = document.querySelector(
      '[data-testid="stage-slide"] .subfield',
    ) as HTMLElement
    const flow = field.querySelector('.rich-doc') as HTMLElement
    // Out-of-flow chrome (ProseMirror's gap cursor) is not content. A picture
    // is positioned, but it is in the flow, so only absolute and fixed go.
    const blocks = [...flow.children].filter((child) => {
      const position = getComputedStyle(child as HTMLElement).position
      return position !== 'absolute' && position !== 'fixed'
    }) as HTMLElement[]
    const outer = field.getBoundingClientRect()
    const first = blocks[0].getBoundingClientRect()
    const last = blocks[blocks.length - 1].getBoundingClientRect()
    return {
      above: first.top - outer.top,
      below: outer.bottom - last.bottom,
      blocks: blocks.length,
    }
  })
}

test.describe('vertical centring', () => {
  test('leaves the same air above and below plain text', async ({ page }) => {
    await createPresentation(page, 'Midtstilt tekst')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.keyboard.type('Arkeologiske funn tyder på at cannabis har blitt dyrket i årtusener.')
    await page.getByTestId('valign-middle').click()
    await page.waitForTimeout(200)

    const editing = await air(page)
    // The margin below the last block is a distance to the block after it, and
    // there is no block after it. Half of it used to end up under the text.
    expect(Math.abs(editing.above - editing.below)).toBeLessThan(1)

    await enterZoneMode(page)
    const presented = await air(page)
    expect(Math.abs(presented.above - presented.below)).toBeLessThan(1)
    expect(Math.abs(presented.above - editing.above)).toBeLessThan(1)
  })

  test('leaves no blank line under a picture, and puts one there to write on', async ({
    page,
  }) => {
    await createPresentation(page, 'Midtstilt bilde')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.getByTestId('valign-middle').click()

    await page.getByTestId('open-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'midt.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(stage(page).locator('.rd-image-wrapper img')).toBeVisible()
    await page.waitForTimeout(200)

    // While the field is being edited there is a line under the picture: a
    // picture is an atom, so without it there is nowhere to put the caret.
    const editing = await air(page)
    expect(editing.blocks).toBe(2)

    // The moment the field is left, the line is gone — and the slide never had
    // it, so the picture sits in the middle of the room it was given.
    await enterZoneMode(page)
    const presented = await air(page)
    expect(presented.blocks).toBe(1)
    expect(Math.abs(presented.above - presented.below)).toBeLessThan(1)

    // And it stays gone: the document never carried the line in the first place.
    await enterContentMode(page)
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await enterZoneMode(page)
    expect((await air(page)).blocks).toBe(1)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })
})
