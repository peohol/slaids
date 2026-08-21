import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

test.describe('presentation mode', () => {
  test('navigates slides with the keyboard and exits with Escape', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Visning')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toBeVisible()
    await expect(page.getByTestId('present-counter')).toHaveText('3 / 3')

    await page.keyboard.press('Home')
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 3')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('present-counter')).toHaveText('2 / 3')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 3')
    await page.keyboard.press('End')
    await expect(page.getByTestId('present-counter')).toHaveText('3 / 3')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    expect(guard.errors).toEqual([])
  })

  test('renders the same content as the editor', async ({ page }) => {
    await createPresentation(page, 'Samme innhold')
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Tittel i visning')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Innhold i visning')
    await waitForSaved(page)

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toContainText('Tittel i visning')
    await expect(page.getByTestId('present-view')).toContainText('Innhold i visning')
  })

  test('appends a derived reference slide when a reference is cited', async ({ page }) => {
    await createPresentation(page, 'Referanser')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Påstand med kilde')

    await page.getByTestId('insert-reference').click()
    await expect(page.getByTestId('reference-modal')).toBeVisible()
    await page.getByTestId('reference-title').fill('En viktig kilde')
    await page.getByTestId('save-reference').click()
    await page.getByRole('button', { name: 'Lukk' }).click()

    await expect(stage(page).locator('.rd-citation')).toHaveCount(1)

    // The derived slide is visible in the editor too, as a read-only entry.
    await expect(page.getByTestId('filmstrip-derived')).toHaveCount(1)
    await page.getByTestId('filmstrip-derived').getByRole('button').first().click()
    await expect(page.getByTestId('stage-note')).toBeVisible()
    await expect(page.getByTestId('stage-slide')).toContainText('En viktig kilde')
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-readonly', '')

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 2')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('present-view')).toContainText('Referanser')
    await expect(page.getByTestId('present-view')).toContainText('En viktig kilde')
  })

  test('leaves the derived slide when an authored slide is selected again', async ({ page }) => {
    await createPresentation(page, 'Tilbake til egen slide')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Påstand med kilde')

    await page.getByTestId('insert-reference').click()
    await page.getByTestId('reference-title').fill('Kilde')
    await page.getByTestId('save-reference').click()
    await page.getByRole('button', { name: 'Lukk' }).click()

    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(2)

    await page.getByTestId('filmstrip-derived').getByRole('button').first().click()
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-readonly', '')

    // Away to the first slide, then back to the one the derived view was opened
    // from: it must stay closed rather than reappear.
    await page.getByTestId('filmstrip-item').nth(0).getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('stage-slide')).not.toHaveAttribute('data-readonly', '')
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('stage-slide')).not.toHaveAttribute('data-readonly', '')
    await expect(page.getByTestId('stage-note')).toBeHidden()
  })

  test('follows a link in a slide without advancing the deck', async ({ page }) => {
    await createPresentation(page, 'Lenker i visning')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Kilden ligger her')
    await page.keyboard.press('Control+a')
    page.once('dialog', (dialog) => dialog.accept('https://example.invalid/kilde'))
    await page.getByTestId('format-link').click()
    await expect(stage(page).locator('.rd-link, a')).toHaveCount(1)

    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    await page.getByTestId('present').click()
    await page.keyboard.press('Home')
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 2')

    const link = page.getByTestId('present-view').locator('a').first()
    await expect(link).toBeVisible()
    const popup = page.context().waitForEvent('page').catch(() => null)
    await link.click()
    // The click belonged to the link, not to the deck.
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 2')
    const opened = await popup
    if (opened) await opened.close()

    // A click on the slide itself still advances.
    await page.getByTestId('present-view').click({ position: { x: 5, y: 5 } })
    await expect(page.getByTestId('present-counter')).toHaveText('2 / 2')
  })

  test('shows several sources cited together as one citation', async ({ page }) => {
    // The merge rewrites the whole document from inside a command, which is
    // exactly where a nested dispatch leaves ProseMirror holding a transaction
    // built on a state that no longer exists. That surfaces as a page error and
    // nothing else, so the guard is the test.
    const guard = watchForErrors(page)
    await createPresentation(page, 'Sammenslåtte kilder')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Påstand med flere kilder')

    await page.getByTestId('open-references').click()
    for (const title of ['Kilde A', 'Kilde B', 'Kilde C']) {
      await page.getByTestId('reference-title').fill(title)
      await page.getByTestId('save-reference').click()
      await page.waitForTimeout(120)
    }
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk' }).click()

    // Three references, one pill, one compressed label.
    await expect(stage(page).locator('.rd-citation')).toHaveCount(1)
    await expect(stage(page).locator('.rd-citation')).toHaveText('1–3')
    expect(guard.errors).toEqual([])
  })

  test('opens the reference list from a citation', async ({ page }) => {
    await createPresentation(page, 'Klikkbar kilde')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Påstand')

    await page.getByTestId('open-references').click()
    await page.getByTestId('reference-title').fill('Kilden bak påstanden')
    await page.getByTestId('save-reference').click()
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk' }).click()
    await expect(page.getByTestId('reference-modal')).toBeHidden()

    await stage(page).locator('.rd-citation').first().click()
    await expect(page.getByTestId('reference-modal')).toBeVisible()
    // A single citation lands on its own reference.
    await expect(page.getByTestId('reference-row').filter({ hasText: 'Kilden bak påstanden' })).toHaveAttribute(
      'data-focused',
      '',
    )
  })

  test('removes the derived slide when the last citation goes away', async ({ page }) => {
    await createPresentation(page, 'Uten kilder')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Påstand')

    await page.getByTestId('insert-reference').click()
    await page.getByTestId('reference-title').fill('Kilde som skal bort')
    await page.getByTestId('save-reference').click()
    await expect(page.getByTestId('reference-row')).toHaveCount(1)
    await page.getByTestId('delete-reference').click()
    await page.getByTestId('confirm-accept').click()
    await page.getByRole('button', { name: 'Lukk' }).click()

    await expect(stage(page).locator('.rd-citation')).toHaveCount(0)
    await expect(page.getByTestId('filmstrip-derived')).toHaveCount(0)
  })
})
