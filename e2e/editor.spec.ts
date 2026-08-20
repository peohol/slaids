import { expect, test } from '@playwright/test'
import {
  addContentToZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

test.describe('slides and content', () => {
  test('adds, duplicates, reorders and deletes slides', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Slides')
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(1)

    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(2)

    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)
    await expect(page.getByTestId('slide-title')).toHaveCount(0)

    await page.getByTestId('duplicate-slide').first().click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(4)

    await page.getByTestId('delete-slide').first().click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)
    expect(guard.errors).toEqual([])
  })

  test('switches between slides from the filmstrip', async ({ page }) => {
    await createPresentation(page, 'Navigasjon')
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Første slide')

    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Andre slide')
    await expect(stage(page)).toContainText('Andre slide')

    await page.getByTestId('filmstrip-thumb').first().click()
    await expect(stage(page)).toContainText('Første slide')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 1 av 2')

    await page.getByTestId('filmstrip-thumb').nth(1).click()
    await expect(stage(page)).toContainText('Andre slide')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 2')
  })

  test('toggles the title zone and restores the main area', async ({ page }) => {
    await createPresentation(page, 'Overskrift')
    await expect(page.getByTestId('slide-title')).toBeVisible()
    const withTitle = (await zoneRects(page))[0]

    // An empty title zone is removed without a prompt.
    await page.getByTestId('toggle-title').click()
    await expect(page.getByTestId('slide-title')).toHaveCount(0)
    const withoutTitle = (await zoneRects(page))[0]
    expect(withoutTitle.h).toBeGreaterThan(withTitle.h)
    expect(withoutTitle.y).toBeCloseTo(24, 0)

    await page.getByTestId('toggle-title').click()
    await expect(page.getByTestId('slide-title')).toBeVisible()
    const again = (await zoneRects(page))[0]
    expect(again.h).toBeCloseTo(withTitle.h, 0)
  })

  test('confirms before removing a title that has text, and restores it', async ({ page }) => {
    await createPresentation(page, 'Overskriftstekst')
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Tekst som ikke skal forsvinne')

    await page.getByTestId('toggle-title').click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('slide-title')).toHaveCount(0)

    await page.getByTestId('toggle-title').click()
    await expect(stage(page)).toContainText('Tekst som ikke skal forsvinne')
  })

  test('writes a slide title and body text that survive a reload', async ({ page }) => {
    await createPresentation(page, 'Tekst')
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('En tittel som lagres')

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')
    await stage(page).locator('.card-header .tiptap').click()
    await page.keyboard.type('Korttittel')
    await stage(page).locator('.card-body .subfield .tiptap').first().click()
    await page.keyboard.type('Brødtekst i kortet.')

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('stage-slide')).toContainText('En tittel som lagres')
    await expect(page.getByTestId('stage-slide')).toContainText('Korttittel')
    await expect(page.getByTestId('stage-slide')).toContainText('Brødtekst i kortet.')
  })

  test('applies bold formatting through the text toolbar', async ({ page }) => {
    await createPresentation(page, 'Formatering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.keyboard.type('Fet tekst')
    await page.keyboard.press('Control+a')
    await page.getByTestId('format-bold').click()
    await expect(field.locator('strong')).toHaveText('Fet tekst')

    await page.getByTestId('format-bullet').click()
    await expect(field.locator('ul li')).toHaveCount(1)
  })

  test('converts a container into a titled card, keeping the text', async ({ page }) => {
    await createPresentation(page, 'Konvertering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await stage(page).locator('.zone-content--container .tiptap').click()
    await page.keyboard.type('Tekst som skal overleve')

    await enterZoneMode(page)
    await page.getByTestId('inspector-kind-titled-card').click()
    await enterContentMode(page)
    await expect(page.getByTestId('stage-slide')).toContainText('Tekst som skal overleve')
    await expect(page.locator('[data-testid="stage-slide"] .zone-content--titled')).toBeVisible()
  })

  test('undoes and redoes a structural change', async ({ page }) => {
    await createPresentation(page, 'Angre')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-split').click()
    await page.getByTestId('split-apply').click()
    expect(await zoneRects(page)).toHaveLength(2)

    await page.getByTestId('undo').click()
    expect(await zoneRects(page)).toHaveLength(1)

    await page.getByTestId('redo').click()
    expect(await zoneRects(page)).toHaveLength(2)
  })

  test('changes the presentation theme globally', async ({ page }) => {
    await createPresentation(page, 'Tema')
    await page.getByTestId('open-theme').click()
    await expect(page.getByTestId('theme-modal')).toBeVisible()
    // hsl(0, 25%, 20%) from the fixed palette
    await page.locator('[data-testid="theme-modal"] [data-color="#402626"]').first().click()
    await page.getByRole('button', { name: 'Ferdig' }).click()

    const background = await page.evaluate(
      () => getComputedStyle(document.querySelector('.slide') as HTMLElement).backgroundColor,
    )
    expect(background).toBe('rgb(64, 38, 38)')
  })
})
