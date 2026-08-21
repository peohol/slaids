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

    await page.getByTestId('idea-input').fill('Husk å nevne geometrien')
    await page.getByTestId('idea-input').press('Enter')
    await expect(page.getByTestId('idea')).toHaveCount(1)
    await waitForSaved(page)

    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    // The window's open state is a local UI preference, so it comes back too.
    await expect(page.getByTestId('ideas-window')).toBeVisible()
    await expect(page.getByTestId('idea-text').first()).toHaveText('Husk å nevne geometrien')
  })

  test('edits an idea in place, and cancels without losing the old text', async ({ page }) => {
    await createPresentation(page, 'Idéretting')
    await page.getByTestId('open-ideas').click()
    await page.getByTestId('idea-input').fill('Første utkast')
    await page.getByTestId('idea-input').press('Enter')

    // A click on the text opens the editor on that row.
    await page.getByTestId('idea-text').first().click()
    await expect(page.getByTestId('idea-edit')).toBeVisible()
    await page.getByTestId('idea-edit').fill('Andre utkast')
    await page.getByTestId('idea-edit').press('Enter')
    await expect(page.getByTestId('idea-text').first()).toHaveText('Andre utkast')

    // Escape abandons the edit, and then the old text is what still stands.
    await page.getByTestId('idea-text').first().click()
    await page.getByTestId('idea-edit').fill('Kastes')
    await page.getByTestId('idea-edit').press('Escape')
    await expect(page.getByTestId('idea-text').first()).toHaveText('Andre utkast')
  })

  test('files ideas by dragging, and keeps them when a category goes', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Idéflytting')
    await page.getByTestId('open-ideas').click()
    await expect(page.getByTestId('ideas-window')).toBeVisible()

    await addLooseIdea(page, 'Uten kategori')
    await addCategory(page, 'Kilder')
    await addCategory(page, 'Å gjøre')
    // Categories and loose ideas share one list, so the loose note stays first.
    expect(await rowTexts(page)).toEqual(['Uten kategori', 'Kilder', 'Å gjøre'])

    await addIdeaTo(page, 0, 'Første')
    await addIdeaTo(page, 0, 'Andre')
    await expect(page.getByTestId('idea')).toHaveCount(3)
    // Reading order is the whole list, one level deep: the ideas under a
    // category are read between its heading and the next one.
    expect(await rowTexts(page)).toEqual([
      'Uten kategori',
      'Kilder',
      'Første',
      'Andre',
      'Å gjøre',
    ])

    const inFirstCategory = async (): Promise<string[]> =>
      page.getByTestId('idea-category').nth(0).getByTestId('idea-text').allTextContents()

    expect(await inFirstCategory()).toEqual(['Første', 'Andre'])

    // Dragging a card below another one puts it after it, not before.
    const cards = page.getByTestId('idea-category').nth(0).getByTestId('idea')
    await dragTo(page, cards.nth(0).locator('.idea-grip'), cards.nth(1), 8)
    expect(await inFirstCategory()).toEqual(['Andre', 'Første'])

    // An idea can leave its category entirely, and lands at the root.
    await dragTo(
      page,
      page.getByTestId('idea-category').nth(0).getByTestId('idea').nth(0).locator('.idea-grip'),
      page.getByTestId('ideas-list').getByTestId('idea').first(),
      -8,
    )
    expect(await inFirstCategory()).toEqual(['Første'])
    expect(await rowTexts(page)).toEqual([
      'Andre',
      'Uten kategori',
      'Kilder',
      'Første',
      'Å gjøre',
    ])

    // A category is dragged by its heading, and carries its ideas with it.
    await dragTo(
      page,
      page.getByTestId('idea-category').nth(1).locator('.idea-grip'),
      page.getByTestId('idea-category').nth(0),
      6,
      'top',
    )
    expect(await rowTexts(page)).toEqual([
      'Andre',
      'Uten kategori',
      'Å gjøre',
      'Kilder',
      'Første',
    ])

    // Deleting a category is not a way to lose an idea: it only takes the
    // heading, and what was under it is left where the heading stood.
    await page.getByTestId('delete-idea-category').nth(1).click()
    await expect(page.getByTestId('idea-category')).toHaveCount(1)
    await expect(page.getByTestId('idea')).toHaveCount(3)
    expect(await rowTexts(page)).toEqual(['Andre', 'Uten kategori', 'Å gjøre', 'Første'])
    expect(guard.errors).toEqual([])
  })

  test('moves a row with the keyboard', async ({ page }) => {
    await createPresentation(page, 'Idétastatur')
    await page.getByTestId('open-ideas').click()
    await addLooseIdea(page, 'en')
    await addLooseIdea(page, 'to')
    await addCategory(page, 'Kilder')

    // Alt + arrow moves the focused row one step within its container.
    await page.getByTestId('idea').nth(1).click()
    await page.getByTestId('idea').nth(1).press('Alt+ArrowUp')
    expect(await rowTexts(page)).toEqual(['to', 'en', 'Kilder'])

    // Alt + right files a loose idea under the category above it; Alt + left
    // takes it back out.
    await page.getByTestId('idea').nth(1).press('Alt+ArrowDown')
    await page.getByTestId('idea').nth(1).press('Alt+ArrowDown')
    expect(await rowTexts(page)).toEqual(['to', 'Kilder', 'en'])
    await page.getByTestId('idea').nth(1).press('Alt+ArrowRight')
    expect(await rowTexts(page)).toEqual(['to', 'Kilder', 'en'])
    await expect(page.getByTestId('idea-category').getByTestId('idea')).toHaveCount(1)
    await page.getByTestId('idea-category').getByTestId('idea').press('Alt+ArrowLeft')
    await expect(page.getByTestId('idea-category').getByTestId('idea')).toHaveCount(0)
  })
})

/** The list in reading order: categories and loose ideas alike, as it is drawn. */
async function rowTexts(page: Page): Promise<string[]> {
  return page.locator('.idea-text, .idea-cat-title').allTextContents()
}

/** A note typed into the field at the foot of the window. */
async function addLooseIdea(page: Page, text: string): Promise<void> {
  await page.getByTestId('idea-input').fill(text)
  await page.getByTestId('idea-input').press('Enter')
}

/**
 * A new category. The button makes one with a placeholder name and opens the
 * editor on it with the text selected, so typing replaces it.
 */
async function addCategory(page: Page, name: string): Promise<void> {
  await page.getByTestId('add-idea-category').click()
  await expect(page.getByTestId('idea-edit')).toBeVisible()
  await page.getByTestId('idea-edit').fill(name)
  await page.getByTestId('idea-edit').press('Enter')
  await expect(page.getByTestId('idea-edit')).toHaveCount(0)
}

/** A new idea inside a category, added by the `+` in its heading. */
async function addIdeaTo(page: Page, index: number, text: string): Promise<void> {
  await page.getByTestId('idea-category').nth(index).locator('.idea-cat-add').click()
  await expect(page.getByTestId('idea-edit')).toBeVisible()
  await page.getByTestId('idea-edit').fill(text)
  await page.getByTestId('idea-edit').press('Enter')
  await expect(page.getByTestId('idea-edit')).toHaveCount(0)
}

/**
 * A drag: press, nudge past the activation distance, then move.
 *
 * `dy` offsets from the target's middle (or its top edge in 'top' mode). In the
 * ideas window that offset is the whole point — the placeholder goes before the
 * first neighbour the pointer is past the middle of, so a few pixels either way
 * is the difference between landing above a row and below it.
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
