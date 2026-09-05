import { expect, test } from './fixtures'
import { addContentToZone, createPresentation, stage, watchForErrors, zoneRects } from './helpers'

/**
 * The Ω symbol picker, wherever text is edited.
 *
 * The one claim worth making in a real browser rather than headlessly is that
 * the popover actually reaches the caret in a genuinely contenteditable field
 * — a body subfield, a slide title, and a section's pill, which used to be the
 * one field the toolbar deliberately lost the editor for.
 */

test.describe('special characters', () => {
  test('inserts a character into a body field and leaves the caret after it', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Spesialtegn i innhold')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await field.pressSequentially('alta')
    // Caret between "al" and "ta".
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')

    await page.getByTestId('format-symbol').click()
    await expect(page.getByTestId('symbol-picker')).toBeVisible()
    await page.getByTestId('symbol-cell-→').click()
    await expect(field).toHaveText('al→ta')

    // The popover stays open — several symbols rarely come one at a time.
    await expect(page.getByTestId('symbol-picker')).toBeVisible()
    await page.getByTestId('symbol-cell-←').click()
    await expect(field).toHaveText('al→←ta')
    expect(guard.errors).toEqual([])
  })

  test('switches groups and shows the hovered character’s name', async ({ page }) => {
    await createPresentation(page, 'Spesialtegn grupper')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()

    await page.getByTestId('format-symbol').click()
    await page.getByTestId('symbol-group-greek').click()
    const omega = page.getByTestId('symbol-cell-Ω')
    await expect(omega).toBeVisible()
    await omega.hover()
    await expect(page.getByTestId('symbol-picker')).toContainText('Stor omega')
  })

  test('inserts a character into a slide title', async ({ page }) => {
    await createPresentation(page, 'Spesialtegn i tittel')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    const title = stage(page).locator('[data-testid="slide-title"] .tiptap')
    await title.click()
    await title.pressSequentially('Kapittel')

    await page.getByTestId('format-symbol').click()
    // '§' lives in "Typografi", not the default "Piler" group.
    await page.getByTestId('symbol-group-typography').click()
    await page.getByTestId('symbol-cell-§').click()
    await expect(title).toHaveText('Kapittel§')
  })

  test('inserts a character into a section pill, where no formatting toolbar applies', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Spesialtegn i seksjon')
    // The front page is a section slide from the moment a deck is created,
    // already carrying the deck's own name as its heading.
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
    const title = stage(page).locator('[data-section-line="title"] .tiptap')
    await title.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await title.pressSequentially('Del')

    await expect(page.getByTestId('text-toolbar')).toContainText('alltid')
    await page.getByTestId('format-symbol').click()
    // '§' lives in "Typografi", not the default "Piler" group.
    await page.getByTestId('symbol-group-typography').click()
    await page.getByTestId('symbol-cell-§').click()
    await expect(title).toHaveText('Del§')
    expect(guard.errors).toEqual([])
  })
})
