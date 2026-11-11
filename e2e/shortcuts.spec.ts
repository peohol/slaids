import { expect, test } from './fixtures'
import {
  addContentToZone,
  clickZone,
  createPresentation,
  enterZoneMode,
  splitSelected,
  stage,
  watchForErrors,
  zoneRects,
} from './helpers'

test.describe('keyboard shortcuts', () => {
  test('Ctrl+E toggles zone mode and F5 starts the presentation', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Hurtigtaster')
    await expect(page.getByTestId('zone-overlay')).toBeHidden()

    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('zone-overlay')).toBeVisible()
    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('zone-overlay')).toBeHidden()

    await page.keyboard.press('F5')
    await expect(page.getByTestId('present-view')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    expect(guard.errors).toEqual([])
  })

  test('Ctrl+Z undoes a structural change from the keyboard', async ({ page }) => {
    await createPresentation(page, 'Angre med tast')
    await page.keyboard.press('Control+e')
    await splitSelected(page, [1, 1], 'x')
    expect(await zoneRects(page)).toHaveLength(2)

    await page.keyboard.press('Control+z')
    expect(await zoneRects(page)).toHaveLength(1)
    await page.keyboard.press('Control+Shift+z')
    expect(await zoneRects(page)).toHaveLength(2)
  })

  test('Ctrl+Z and Ctrl+Y show the page a change is on before making it', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Angre på en annen side')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Andre slide')
    await expect(stage(page)).toContainText('Andre slide')

    await page.getByTestId('filmstrip-thumb').nth(1).click()
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')

    // The page comes first, with the change still on it; then the change.
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')
    await expect(stage(page)).toContainText('Andre slide')
    await expect(stage(page)).not.toContainText('Andre slide')

    await page.getByTestId('filmstrip-thumb').nth(1).click()
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')
    await page.keyboard.press('Control+y')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')
    await expect(stage(page)).not.toContainText('Andre slide')
    await expect(stage(page)).toContainText('Andre slide')
    expect(guard.errors).toEqual([])
  })

  /*
   * The regression this covers: the rich-text editors used to keep a
   * ProseMirror history of their own, so a Ctrl+Z with the caret in a field ran
   * that one *and* the deck's — and the toolbar button was the only thing that
   * reliably undid anything.
   */
  test('Ctrl+Z undoes typing while the caret is still in the field', async ({ page }) => {
    await createPresentation(page, 'Angre mens man skriver')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')

    const field = stage(page).locator('.tiptap').last()
    await field.click()
    await page.keyboard.type('Første')
    // Long enough that the two runs cannot coalesce into one undo step.
    await page.waitForTimeout(900)
    await page.keyboard.type(' andre')
    await page.waitForTimeout(900)
    await expect(field).toHaveText('Første andre')

    await page.keyboard.press('Control+z')
    await expect(field).toHaveText('Første')
    await page.keyboard.press('Control+Shift+z')
    await expect(field).toHaveText('Første andre')
  })

  test('substitutes dashes, arrows and separators while typing', async ({ page }) => {
    await createPresentation(page, 'Typografi')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')

    const field = stage(page).locator('.tiptap').last()
    await field.click()
    await page.keyboard.type('Del 1 - to -> tre * fire')
    await expect(field).toHaveText('Del 1 – to → tre · fire')

    // A hyphen without the spaces is a hyphen, and a line-initial dash is a list.
    await page.keyboard.press('Enter')
    await page.keyboard.type('e-post 1-2')
    await expect(field).toContainText('e-post 1-2')
  })

  test('arrow keys page through the deck, but not while typing', async ({ page }) => {
    await createPresentation(page, 'Piltaster')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')

    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')
    // One page further up is the front page, which is the deck's first section.
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('statusbar')).toContainText('Forside 1 av 3')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')

    // With a caret in a field the arrows belong to the text.
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await stage(page).locator('.tiptap').last().click()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')
  })

  test('mouse wheel pages through the deck, even with a caret in a field', async ({ page }) => {
    await createPresentation(page, 'Musehjul')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')

    await stage(page).hover()
    await page.mouse.wheel(0, -120)
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')
    // One page further up is the front page, which is the deck's first section.
    await page.waitForTimeout(400)
    await page.mouse.wheel(0, -120)
    await expect(page.getByTestId('statusbar')).toContainText('Forside 1 av 3')
    await page.waitForTimeout(400)
    await page.mouse.wheel(0, 120)
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')

    // Unlike the arrow keys, the wheel keeps paging with a caret in a field:
    // it has no other job in the app to hand off to.
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await stage(page).locator('.tiptap').last().click()
    await page.waitForTimeout(400)
    await page.mouse.wheel(0, -120)
    await expect(page.getByTestId('statusbar')).toContainText('Forside 1 av 3')

    // A single scroll gesture moves one slide, not several: repeated ticks
    // inside the same gesture collapse into one step rather than flying past
    // the deck the way five separate arrow presses would.
    await page.waitForTimeout(400)
    for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, 120)
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')
  })

  test('mouse wheel scrolls the filmstrip and inspector instead of paging the deck', async ({
    page,
  }) => {
    await createPresentation(page, 'Musehjul over paneler')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')

    await page.getByTestId('filmstrip').hover()
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(400)
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')

    await page.getByTestId('inspector').hover()
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(400)
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')
  })

  test('Escape leaves zone editing for content editing', async ({ page }) => {
    await createPresentation(page, 'Escape ut av soner')
    await enterZoneMode(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('zone-overlay')).toBeHidden()
  })

  test('åpner sandkassen, oppretter en slide og setter inn referanse med tastaturet', async ({ page }) => {
    await createPresentation(page, 'Snarveier for slides og referanser')
    await page.keyboard.press('Control+Alt+k')
    await expect(page.getByTestId('sandbox-window')).toBeVisible()
    await page.keyboard.press('Control+Meta+k')
    await expect(page.getByTestId('sandbox-window')).toBeHidden()

    await page.keyboard.press('Control+Alt+n')
    await expect(page.getByTestId('new-slide-modal')).toBeVisible()
    await page.keyboard.press('Control+Alt+k')
    await expect(page.getByTestId('sandbox-window')).toBeHidden()
    await page.getByTestId('new-slide-with-title').click()
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')

    await page.keyboard.press('Control+Alt+r')
    await expect(page.getByTestId('reference-modal')).toBeHidden()
    const title = stage(page).locator('[data-testid="slide-title"] .tiptap')
    await title.click()
    await page.keyboard.type('Med kilde')
    await page.keyboard.press('Control+Alt+r')
    await expect(page.getByTestId('reference-modal')).toBeVisible()
    await page.getByTestId('reference-title').fill('Kilden')
    await page.getByTestId('save-reference').click()
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk', exact: true }).click()
    await expect(title.locator('.rd-citation')).toHaveText('1')
  })

  test('deler, flytter innhold, tømmer og sletter med hurtigtaster i Soner', async ({ page }) => {
    await createPresentation(page, 'Hurtigtaster for soner')
    const [original] = await zoneRects(page)
    await addContentToZone(page, original.id, 'titled-card')
    await enterZoneMode(page)

    await page.keyboard.press('Control+Alt+v')
    const [left, right] = await zoneRects(page)
    expect(left.x).toBeLessThan(right.x)
    expect(left.y).toBeCloseTo(right.y)
    await clickZone(page, left)
    await page.keyboard.press('Control+Alt+m')
    await expect(page.getByTestId('sandbox-item')).toHaveCount(1)
    await expect(stage(page).locator('[data-content-kind]')).toHaveCount(0)
    await page.keyboard.press('Control+Alt+k')

    await page.keyboard.press('Control+Alt+h')
    const [top, bottom] = (await zoneRects(page)).filter((zone) => zone.x < right.x)
    expect(top.x).toBeCloseTo(bottom.x)
    expect(top.y).toBeLessThan(bottom.y)
    await page.keyboard.press('Control+Alt+t')
    await expect(page.getByRole('dialog', { name: 'Tømme sonen?' })).toBeVisible()
    await page.getByTestId('confirm-accept').click()
    expect(await zoneRects(page)).toHaveLength(2)

    await clickZone(page, right)
    await page.keyboard.press('Control+Alt+x')
    await expect(page.getByRole('dialog', { name: 'Slette sonen?' })).toBeVisible()
    await page.getByTestId('confirm-accept').click()
    expect(await zoneRects(page)).toHaveLength(1)
  })

  test('deler sonen det skrives i med hurtigtaster i innholdsredigering', { tag: '@pr' }, async ({ page }) => {
    await createPresentation(page, 'Del mens du skriver')
    const [original] = await zoneRects(page)
    await addContentToZone(page, original.id, 'untitled-card')
    await expect(page.getByTestId('zone-overlay')).toBeHidden()

    const body = () => stage(page).locator('.subfield .tiptap').first()
    await body().click()
    await page.keyboard.type('AB')
    await page.keyboard.press('ArrowLeft')
    // Redigeringsfeltet leser markøren fra nettleseren på neste runde, ikke i tastetrykket.
    type WithEditor = HTMLElement & { editor: { state: { selection: { head: number } } } }
    const caret = () => body().evaluate((element) => (element as WithEditor).editor.state.selection.head)
    await expect.poll(caret).toBe(2)

    // Delingen gjelder sonen markøren står i, og markøren blir stående i teksten.
    await page.keyboard.press('Control+Alt+v')
    const [left, right] = await zoneRects(page)
    expect(left.x).toBeLessThan(right.x)
    expect(left.y).toBeCloseTo(right.y)
    await expect(page.getByTestId('zone-overlay')).toBeHidden()
    await page.keyboard.type('X')
    await expect(body()).toHaveText('AXB')

    await page.keyboard.press('Control+Alt+h')
    const [top, bottom] = (await zoneRects(page)).filter((zone) => zone.x < right.x)
    expect(top.x).toBeCloseTo(bottom.x)
    expect(top.y).toBeLessThan(bottom.y)
    await page.keyboard.type('Y')
    await expect(body()).toHaveText('AXYB')
    expect(await zoneRects(page)).toHaveLength(3)

    // Slidetittelen er ingen sone, så der deler tastene ingenting.
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.press('Control+Alt+v')
    await page.keyboard.press('Control+Alt+h')
    expect(await zoneRects(page)).toHaveLength(3)
  })

  test('shows the shortcut reference', async ({ page }) => {
    await createPresentation(page, 'Referanse for taster')
    await page.getByTestId('show-shortcuts').click()
    await expect(page.getByTestId('shortcuts-modal')).toBeVisible()
    await expect(page.getByTestId('shortcuts-modal')).toContainText('Ctrl + E')
    await expect(page.getByTestId('shortcuts-modal')).toContainText('Soneredigering')
  })
})
