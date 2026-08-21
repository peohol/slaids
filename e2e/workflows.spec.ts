import { expect, test, type Locator, type Page } from './fixtures'
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

  test('files ideas by dragging, and keeps them when a category goes', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Idéflytting')
    await page.getByTestId('open-ideas').click()
    await expect(page.getByTestId('ideas-window')).toBeVisible()

    // The first list is the uncategorised one, which is always there.
    const lists = page.getByTestId('idea-input')
    await lists.nth(0).fill('Uten kategori')
    await lists.nth(0).press('Enter')
    await lists.nth(1).fill('Første')
    await lists.nth(1).press('Enter')
    await lists.nth(1).fill('Andre')
    await lists.nth(1).press('Enter')
    await expect(page.getByTestId('idea')).toHaveCount(3)

    const inFirstCategory = async (): Promise<string[]> =>
      page.getByTestId('idea-category').nth(0).getByTestId('idea-text').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLInputElement).value),
      )
    const uncategorised = async (): Promise<string[]> =>
      page.getByTestId('idea-uncategorised').getByTestId('idea-text').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLInputElement).value),
      )

    expect(await inFirstCategory()).toEqual(['Første', 'Andre'])

    // Dragging an idea below another one puts it after it, not before.
    const cards = page.getByTestId('idea-category').nth(0).getByTestId('idea')
    await dragTo(page, cards.nth(0).getByRole('button', { name: 'Flytt idé' }), cards.nth(1), 8)
    expect(await inFirstCategory()).toEqual(['Andre', 'Første'])

    // An idea can leave its category entirely.
    await dragTo(
      page,
      page.getByTestId('idea-category').nth(0).getByTestId('idea').nth(0)
        .getByRole('button', { name: 'Flytt idé' }),
      page.getByTestId('idea-uncategorised').getByTestId('idea').nth(0),
      8,
    )
    expect(await uncategorised()).toEqual(['Uten kategori', 'Andre'])

    // Categories are ordered, and dragging one past another reorders them.
    const names = async (): Promise<string[]> =>
      page.locator('.idea-category__name').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLInputElement).value),
      )
    const before = await names()
    await dragTo(
      page,
      page.getByTestId('idea-category-grip').nth(1),
      page.getByTestId('idea-category').nth(0),
      6,
      'top',
    )
    expect(await names()).toEqual([before[1], before[0]])

    // Deleting a category is not a way to lose an idea: it only takes the
    // heading, and what was under it becomes uncategorised.
    await page.getByTestId('delete-idea-category').nth(1).click()
    await expect(page.getByTestId('idea-category')).toHaveCount(1)
    expect(await uncategorised()).toContain('Første')
    await expect(page.getByTestId('idea')).toHaveCount(3)
    expect(guard.errors).toEqual([])
  })
})

/**
 * A dnd-kit drag: press, nudge past the activation distance, then move.
 * `dy` offsets from the target's middle (or its top edge in 'top' mode), which
 * is what decides whether the drop lands before or after it.
 */
async function dragTo(
  page: Page,
  grip: Locator,
  target: Locator,
  dy = 0,
  from: 'middle' | 'top' = 'middle',
): Promise<void> {
  const source = await grip.boundingBox()
  const box = await target.boundingBox()
  if (!source || !box) throw new Error('missing drag geometry')
  const y = from === 'top' ? box.y + dy : box.y + box.height / 2 + dy
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 6, { steps: 3 })
  await page.mouse.move(box.x + box.width / 2, y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}
