/**
 * One slide, three modes.
 *
 * Content mode, zone mode and presentation mode draw the same document through
 * the same frame; everything that separates them is chrome around the zones,
 * not paint across them. Drift here is never merely cosmetic: the static
 * renderer is also what the offscreen fit measurement reads, so a slide that
 * looks different once presented is a slide that was measured against
 * something its author never saw.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  watchForErrors,
  zoneRects,
} from './helpers'

/** Where each block of text sits and how it is painted, in slide coordinates. */
async function blocks(page: Page, root: string) {
  return page.evaluate((rootSelector) => {
    const slide = document.querySelector(rootSelector) as HTMLElement
    const base = slide.getBoundingClientRect()
    const scale = base.width / 1600
    // Opacity multiplies down the tree, so the only honest reading of "is this
    // dimmed" is the product of every ancestor's.
    const effectiveOpacity = (element: HTMLElement): number => {
      let opacity = 1
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        opacity *= Number.parseFloat(getComputedStyle(node).opacity)
      }
      return Number(opacity.toFixed(3))
    }
    return [...slide.querySelectorAll<HTMLElement>('.rich-doc p, .rich-doc h1, .rich-doc .rd-p, .rich-doc .rd-heading')]
      .map((element) => {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          text: (element.textContent ?? '').trim(),
          x: Number(((box.left - base.left) / scale).toFixed(1)),
          y: Number(((box.top - base.top) / scale).toFixed(1)),
          width: Number((box.width / scale).toFixed(1)),
          height: Number((box.height / scale).toFixed(1)),
          font: `${style.fontSize}/${style.lineHeight} ${style.fontWeight} ${style.fontFamily}`,
          color: style.color,
          background: style.backgroundColor,
          opacity: effectiveOpacity(element),
        }
      })
  }, root)
}

const IN_EDITOR = '[data-testid="stage-slide"] .slide'
const PRESENTED = '.present__slide .slide'

test.describe('rendering modes', () => {
  test('draws the same slide in content mode, zone mode and presentation', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Modusene')

    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Tittel over det hele')

    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)

    // A card and a container, so both bodies the frame knows are covered, and
    // both alignments that have to move content within its field.
    const [left, right] = await zoneRects(page)
    await addContentToZone(page, left.id, 'titled-card')
    await addContentToZone(page, right.id, 'container')

    await stage(page).locator('.card-header .tiptap').click()
    await page.keyboard.type('Korttittel')

    const fields = stage(page).locator('.subfield .tiptap')
    await fields.nth(0).click()
    await page.getByTestId('format-heading').click()
    await page.keyboard.type('Overskrift')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Midtstilt i kortet')
    await page.getByTestId('valign-middle').click()

    await fields.nth(1).click()
    await page.keyboard.type('Bunnstilt i beholderen')
    await page.getByTestId('valign-bottom').click()
    await page.waitForTimeout(200)

    const editing = await blocks(page, IN_EDITOR)
    expect(editing.length).toBeGreaterThan(3)
    // Nothing is dimmed while the text is being edited — the baseline the other
    // two modes have to match.
    for (const block of editing) expect(block.opacity).toBe(1)

    await enterZoneMode(page)
    expect(await blocks(page, IN_EDITOR)).toEqual(editing)

    await enterContentMode(page)
    await page.keyboard.press('F5')
    await expect(page.getByTestId('present-view')).toBeVisible()
    expect(await blocks(page, PRESENTED)).toEqual(editing)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    expect(guard.errors).toEqual([])
  })
})
