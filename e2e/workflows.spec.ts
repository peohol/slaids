import { expect, test } from './fixtures'
import {
  addContentToZone,
  clickZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

test.describe('sandbox drag and drop', () => {
  test('drags an item from the sandbox into an empty zone', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'DnD')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .subfield .tiptap`).click()
    await page.keyboard.type('Flyttbart innhold')

    await enterZoneMode(page)
    await clickZone(page, zones[0])
    await page.getByTestId('inspector-action-sandbox').click()
    await expect(page.getByTestId('sandbox-item')).toHaveCount(1)

    // Both zones are empty now, so both should light up as valid targets.
    const grip = page.getByTestId('sandbox-grip')
    const gripBox = await grip.boundingBox()
    const targetZone = stage(page).locator(`.slide-zone[data-node-id="${zones[1].id}"]`)
    const targetBox = await targetZone.boundingBox()
    expect(gripBox).not.toBeNull()
    expect(targetBox).not.toBeNull()
    if (!gripBox || !targetBox) return

    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(gripBox.x + 40, gripBox.y + 40, { steps: 5 })
    await expect(page.getByTestId('drag-overlay')).toBeVisible()
    await expect(page.locator('[data-testid="zone-drop-available"]').first()).toBeVisible()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 12,
    })
    await page.mouse.up()
    await page.waitForTimeout(400)

    await expect(page.getByTestId('sandbox-item')).toHaveCount(0)
    await expect(targetZone).toContainText('Flyttbart innhold')
    expect(guard.errors).toEqual([])
  })
})

test.describe('structural clipboard', () => {
  test('copies content from one zone and pastes it into another', async ({ page }) => {
    await createPresentation(page, 'Utklipp')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .subfield .tiptap`).click()
    await page.keyboard.type('Kopiert innhold')

    await enterZoneMode(page)
    await clickZone(page, zones[0])
    await page.keyboard.press('Control+c')
    await clickZone(page, zones[1])
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(300)

    await expect(
      stage(page).locator(`.slide-zone[data-node-id="${zones[1].id}"]`),
    ).toContainText('Kopiert innhold')
    await expect(
      stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"]`),
    ).toContainText('Kopiert innhold')
  })
})

test.describe('layout templates', () => {
  test('saves the current layout and creates a slide from it', async ({ page }) => {
    await createPresentation(page, 'Maler')
    await enterZoneMode(page)
    await splitSelected(page, [1, 2, 1], 'x')

    page.once('dialog', (dialog) => void dialog.accept('Tre kolonner'))
    await page.getByTestId('open-templates').click()
    await page.getByTestId('save-template').click()
    await expect(page.getByTestId('template-item')).toHaveCount(1)

    await page.getByTestId('use-template').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(2)
    const zones = await zoneRects(page)
    expect(zones).toHaveLength(3)
    // Templates carry layout only.
    await expect(stage(page).locator('.zone-content')).toHaveCount(0)
  })
})

test.describe('ideas', () => {
  test('captures ideas that persist with the presentation', async ({ page }) => {
    await createPresentation(page, 'Idéer')
    await page.getByTestId('open-ideas').click()
    await expect(page.getByTestId('ideas-window')).toBeVisible()

    await page.getByTestId('idea-input').first().fill('Husk å nevne geometrien')
    await page.getByTestId('idea-input').first().press('Enter')
    await expect(page.getByTestId('idea')).toHaveCount(1)
    await waitForSaved(page)

    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    // The window's open state is a local UI preference, so it comes back too.
    await expect(page.getByTestId('ideas-window')).toBeVisible()
    await expect(page.getByTestId('idea-text').first()).toHaveValue('Husk å nevne geometrien')
  })
})
