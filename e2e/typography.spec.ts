/**
 * Typing substitutions, in every field a person can type in.
 *
 * The claim is deliberately made in a real browser through real keystrokes.
 * An input rule fires from ProseMirror's `handleTextInput`, and that hook is
 * only reached along the DOM path a keyboard takes — a test that inserts the
 * same characters through `insertContent` exercises a different code path and
 * says nothing about whether typing works. That is exactly how a title field
 * could be reported as covered while nothing had ever been typed into one.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { addContentToZone, createPresentation, stage, zoneRects } from './helpers'

const SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">` +
  `<rect width="200" height="120" fill="#4d6680"/></svg>`

/**
 * Type the three substitutions into a field and read back what it holds.
 *
 * One phrase carrying all three, so a field is either right about every rule
 * or visibly wrong about one of them. It stays short: a title is one line that
 * refuses to overflow, and a phrase that did not fit would be rolled back and
 * fail for a reason that has nothing to do with typography.
 */
const TYPED = 'A - b... c * d'
const WRITTEN = 'A – b… c · d'

async function typeAndRead(page: Page, field: ReturnType<Page['locator']>): Promise<string> {
  await field.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(TYPED)
  await page.waitForTimeout(150)
  return (await field.innerText()).trim()
}

test.describe('autoerstatning', () => {
  test('erstatter mens man skriver i innhold, korttittel og slidetittel', async ({ page }) => {
    await createPresentation(page, 'Autoerstatning')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')

    expect(await typeAndRead(page, stage(page).locator('.subfield .tiptap').first())).toBe(WRITTEN)
    expect(await typeAndRead(page, stage(page).locator('.card-header .tiptap').first())).toBe(
      WRITTEN,
    )
    expect(
      await typeAndRead(page, stage(page).locator('[data-testid="slide-title"] .tiptap')),
    ).toBe(WRITTEN)
  })

  test('erstatter mens man skriver i en seksjons to linjer', async ({ page }) => {
    await createPresentation(page, 'Autoerstatning forside')
    await page.getByTestId('filmstrip-item').nth(0).getByTestId('filmstrip-thumb').click()
    await expect(stage(page).getByTestId('section-page')).toBeVisible()

    expect(
      await typeAndRead(page, stage(page).locator('[data-section-line="title"] .tiptap')),
    ).toBe(WRITTEN)
    expect(
      await typeAndRead(page, stage(page).locator('[data-section-line="subtitle"] .tiptap')),
    ).toBe(WRITTEN)
  })

  test('erstatter mens man skriver i en bildetekst', async ({ page }) => {
    await createPresentation(page, 'Autoerstatning bildetekst')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()

    await page.getByTestId('empty-zone-image').click()
    await expect(page.getByTestId('image-modal')).toBeVisible()
    await page.getByTestId('image-input').setInputFiles({
      name: 'flate.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(page.getByTestId('image-modal')).toBeHidden()
    await page.getByTestId('caption-position-bottom').click()
    await expect(stage(page).locator('.image-caption .tiptap')).toBeFocused()

    expect(await typeAndRead(page, stage(page).locator('.image-caption .tiptap'))).toBe(WRITTEN)
  })
})
