import { expect, test } from './fixtures'
import {
  G,
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
    // The front section and the one slide a new deck opens onto.
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(2)

    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)

    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(4)
    await expect(page.getByTestId('slide-title')).toHaveCount(0)

    await page.getByTestId('duplicate-slide').nth(1).click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(5)

    await page.getByTestId('delete-slide').nth(1).click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(4)
    expect(guard.errors).toEqual([])
  })

  /*
   * The regression this covers: the strip is a column flex container, and its
   * items used to shrink instead of it scrolling. Past about six slides the
   * duplicate and delete buttons were squeezed out of every item's clipped box,
   * so there was no way left to delete a slide at all.
   */
  test('keeps every slide\'s tools reachable once the strip overflows', async ({ page }) => {
    await createPresentation(page, 'Lang filmstripe')
    for (let i = 0; i < 7; i += 1) {
      await page.getByTestId('add-slide').click()
      await page.getByTestId('new-slide-without-title').click()
    }
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(9)

    // The list scrolls rather than squeezing what it holds.
    const scrolls = await page.evaluate(() => {
      const list = document.querySelector('.filmstrip__list') as HTMLElement
      return list.scrollHeight > list.clientHeight + 1
    })
    expect(scrolls).toBe(true)

    for (const button of await page.getByTestId('delete-slide').all()) {
      await expect(button).toBeVisible()
    }
    await page.getByTestId('delete-slide').last().click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(8)
  })

  test('clicking a thumbnail navigates, holding it reorders', async ({ page }) => {
    await createPresentation(page, 'Dra slides')
    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId('add-slide').click()
      await page.getByTestId('new-slide-without-title').click()
    }
    const order = async (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="filmstrip-item"]')].map(
          (item) => (item as HTMLElement).dataset.slideId as string,
        ),
      )
    const before = await order()

    // A plain click is navigation, not a drag.
    await page.getByTestId('filmstrip-thumb').nth(3).click()
    await expect(page.getByTestId('statusbar')).toContainText('Slide 4 av 4')
    expect(await order()).toEqual(before)

    // The same surface, pressed and held, is the drag handle. The front page
    // stays where it is: index 1 is the first slide that can be moved.
    const first = await page.getByTestId('filmstrip-thumb').nth(1).boundingBox()
    const third = await page.getByTestId('filmstrip-thumb').nth(3).boundingBox()
    if (!first || !third) throw new Error('Fant ikke miniatyrene.')
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(350)
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2 + 20, { steps: 4 })
    await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2, { steps: 10 })
    await page.mouse.up()

    await expect.poll(order).not.toEqual(before)
    expect((await order()).sort()).toEqual([...before].sort())
  })

  /*
   * The same reorder, said as a command rather than as a gesture.
   *
   * It is not a mobile control that happens to be visible here: a drag is a
   * shortcut, and the strip has to be usable without one on any surface. The
   * command it ends in is the same `moveSlide` the drag commits, fit-validated
   * the same way — so this is also the desktop's guarantee that the road a
   * phone takes leads to the same deck.
   */
  test('reorders slides from the strip without dragging anything', async ({ page }) => {
    await createPresentation(page, 'Flytt uten dra')
    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId('add-slide').click()
      await page.getByTestId('new-slide-without-title').click()
    }
    const order = async (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="filmstrip-item"]')].map(
          (item) => (item as HTMLElement).dataset.slideId as string,
        ),
      )
    const before = await order()

    await page.getByTestId('filmstrip-item').nth(3).getByTestId('move-slide-up').click()
    await expect
      .poll(order)
      .toEqual([before[0], before[1], before[3], before[2]])

    await page.getByTestId('filmstrip-item').nth(2).getByTestId('move-slide-down').click()
    await expect.poll(order).toEqual(before)

    // The front page is a section, and the deck has to keep opening with one:
    // moving it up is not offered at all rather than refused afterwards.
    await expect(
      page.getByTestId('filmstrip-item').first().getByTestId('move-slide-up'),
    ).toBeDisabled()
    await expect(
      page.getByTestId('filmstrip-item').last().getByTestId('move-slide-down'),
    ).toBeDisabled()
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

    await page.getByTestId('filmstrip-thumb').nth(1).click()
    await expect(stage(page)).toContainText('Første slide')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')

    await page.getByTestId('filmstrip-thumb').nth(2).click()
    await expect(stage(page)).toContainText('Andre slide')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 3 av 3')
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
    expect(withoutTitle.y).toBeCloseTo(G, 0)

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

  /*
   * The compact workspace answers a resting finger with a focused, writable
   * field. None of that may reach a roomy one: there the caret is already
   * where the pointer is, so a press held still is simply a press held still —
   * no view moves, no control appears, and the text stays where it was typed.
   */
  test('a press held still on the desktop stage is not a mobile long press', async ({ page }) => {
    await createPresentation(page, 'Musetrykk')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.keyboard.type('Skrevet med mus')
    const before = (await stage(page).boundingBox())!

    const box = (await field.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(900)
    await page.mouse.up()

    await expect(page.getByTestId('compact-stage-exit')).toHaveCount(0)
    expect((await stage(page).boundingBox())!.width).toBeCloseTo(before.width, 1)
    await expect(field).toContainText('Skrevet med mus')
    // And the desktop keeps typing in every field, not in one focused one.
    await stage(page).locator('[data-testid="slide-title"] .tiptap').click()
    await page.keyboard.type('Tittelen også')
    await expect(page.getByTestId('slide-title')).toContainText('Tittelen også')
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

  test('changes the presentation typography globally', async ({ page }) => {
    await createPresentation(page, 'Tema')
    await page.getByTestId('open-theme').click()
    await expect(page.getByTestId('theme-modal')).toBeVisible()
    // Colour is a section's, so the theme modal offers none: what is global is
    // the two typefaces and the two scales.
    await expect(page.locator('[data-testid="theme-modal"] [data-testid="palette"]')).toHaveCount(0)
    await page.getByTestId('theme-body-font').selectOption({ label: 'Merriweather' })
    await page.getByRole('button', { name: 'Ferdig' }).click()

    const font = await page.evaluate(
      () => getComputedStyle(document.querySelector('.slide') as HTMLElement).fontFamily,
    )
    expect(font).toContain('Merriweather')
  })
})
