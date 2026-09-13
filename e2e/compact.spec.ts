/**
 * Slaids on a small screen, end to end.
 *
 * Run four times over: a phone upright, the same phone on its side, and a
 * narrow desktop window with a mouse and no touch at all — see
 * `playwright.config.ts`. The third run is the one that matters most for the
 * promise this feature makes: nothing here is decided by a user agent, so a
 * window that is merely narrow gets the same workspace a phone does, and a
 * suite that only passed with touch enabled would be proving otherwise.
 *
 * The desktop regression net is the rest of `e2e/`, which runs unchanged.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import {
  backToLibrary,
  createPresentation,
  dismissImageModal,
  stage,
  toast,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'
import {
  closeKeyboard,
  closePanel,
  isCoarse,
  isOnScreen,
  openKeyboard,
  openPanel,
  pressSlide,
  rotate,
  slideOrder,
  stageRoom,
} from './compactHelpers'

const COUNTER = readFileSync(new URL('./apps/counter-app.html', import.meta.url))

/** Put an untitled card into the slide's one empty zone, from the zone panel. */
async function addCardToRootZone(page: Page): Promise<void> {
  await openPanel(page, 'zone')
  await page.getByTestId('inspector-add-untitled-card').click()
  await expect(stage(page).locator('.zone-content--card')).toBeVisible()
}

test.describe('kompakt arbeidsflate', () => {
  test('gir compact shell, biblioteket uten sidescroll og en slide som får plass', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await page.goto('/')

    // The library fits the window it is in. A page that scrolls sideways is
    // the single clearest sign that a layout was never meant for this width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)

    await createPresentation(page, 'Kompakt')
    await expect(page.getByTestId('editor')).toHaveAttribute('data-shell', 'compact')
    // Exactly one editor is mounted: a hidden second tree would measure its
    // content as nothing, which is the one answer the fit rule must never get.
    await expect(page.getByTestId('stage-slide')).toHaveCount(1)
    // The desktop's three permanent columns are not merely narrow here, they
    // are absent — that is what makes room for the slide.
    await expect(page.getByTestId('top-toolbar')).toHaveCount(0)
    await expect(page.getByTestId('compact-tab-bar')).toBeVisible()
    expect(guard.errors).toEqual([])
  })

  test('lukket panel gir sliden hele skjermen', async ({ page }) => {
    await createPresentation(page, 'Fokus')
    // Upright the text panel is where the workspace starts; on its side the
    // slide is, so the panel is opened here rather than assumed.
    await openPanel(page, 'content')
    const roomWithPanel = await stageRoom(page)
    const slideWithPanel = await page.getByTestId('stage-slide').boundingBox()

    await closePanel(page)
    const roomAlone = await stageRoom(page)
    const slideAlone = await page.getByTestId('stage-slide').boundingBox()

    /*
     * Closing the panel *is* the "focus the slide" control: there is no second
     * button for it, and the stage simply takes the room back.
     *
     * The slide inside it grows with the stage until it runs out of the other
     * dimension — upright, a 16:9 page is as wide as the screen long before it
     * is as tall, so what the extra height buys there is inspection room
     * around the page rather than a bigger page. Hence two assertions: the
     * stage always gains room, and the page never loses any.
     */
    expect(roomAlone).toBeGreaterThan(roomWithPanel)
    expect(slideAlone!.width * slideAlone!.height).toBeGreaterThanOrEqual(
      slideWithPanel!.width * slideWithPanel!.height - 1,
    )
  })

  test('velger slide fra slideoversikten og flytter den uten å dra', async ({ page }) => {
    await createPresentation(page, 'Rekkefølge')
    await openPanel(page, 'slides')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    await openPanel(page, 'slides')
    // The mandatory front page, and the three ordinary slides after it.
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(4)
    const before = await slideOrder(page)

    // Selecting a page from the overview, by pressing its thumbnail.
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('filmstrip-item').nth(1)).toHaveClass(/filmstrip__item--active/)

    // Reordering without a drag anywhere in sight.
    await page.getByTestId('filmstrip-item').nth(2).getByTestId('move-slide-up').click()
    await expect
      .poll(() => slideOrder(page))
      .toEqual([before[0], before[2], before[1], ...before.slice(3)])

    // And back again, from the other end.
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('move-slide-down').click()
    await expect.poll(() => slideOrder(page)).toEqual(before)
  })

  test('trykk på sliden velger sonen, og soneoperasjoner går gjennom panelet', async ({ page }) => {
    await createPresentation(page, 'Sonevalg')
    await closePanel(page)
    // A press on the slide selects, in content mode as in zone mode: the
    // finger means "this one", never "put the caret here".
    await pressSlide(page, 800, 500)
    await openPanel(page, 'zone')
    await expect(page.getByTestId('inspector')).toBeVisible()

    await page.getByTestId('inspector-action-split').click()
    await expect(page.getByTestId('split-modal')).toBeVisible()
    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()

    // The split happened, the ratios are the whole numbers the domain stores,
    // and the size controls act on them without a drag.
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 1')
    await page.getByTestId('zone-weight-up-0').click()
    await expect(page.getByTestId('zone-ratios')).toHaveText('2 : 1')
    await page.getByTestId('zone-weight-down-0').click()
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 1')
  })

  /*
   * Content is not the same thing as text. A plain picture fills its zone and
   * has nothing to type into until it is given a caption, so the action that
   * opens the writing surface is not offered — a button that does nothing is
   * worse than no button.
   */
  test('en bildesone uten bildetekst tilbyr ingen tekstredigering', async ({ page }) => {
    await createPresentation(page, 'Bilde uten tekst')
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-add-image').click()
    await dismissImageModal(page)

    await openPanel(page, 'zone')
    await expect(page.getByTestId('inspector-action-move')).toBeVisible()
    await expect(page.getByTestId('inspector-action-edit-text')).toHaveCount(0)
    await expect(page.getByTestId('compact-tab-content')).toBeVisible()

    // Give it a caption, and the action is there — same walk, same answer.
    await page.getByTestId('caption-position-bottom').click()
    await expect(page.getByTestId('inspector-action-edit-text')).toBeVisible()
  })

  test('redigerer tekst på en lesbar flate, og fit måles mot den virkelige sonen', async ({
    page,
  }) => {
    await createPresentation(page, 'Tekst')
    await addCardToRootZone(page)

    await openPanel(page, 'content')
    const fields = page.getByTestId('compact-content-item')
    await expect(fields.first()).toBeVisible()
    await fields.filter({ hasText: 'Rot' }).first().click()

    const sheet = page.getByTestId('focused-text-editor')
    await expect(sheet).toBeVisible()
    const field = sheet.locator('.tiptap').first()
    await field.click()
    await page.keyboard.insertText('Kort nok.')
    await expect(stage(page)).toContainText('Kort nok.')

    // The writing surface is far bigger than the zone and would happily hold
    // this. The zone would not, so the edit is refused — measured against the
    // slide at 1600 × 900, exactly as a command measures it.
    await page.keyboard.insertText('Altfor mye tekst til denne sonen. '.repeat(120))
    await expect(toast(page, 'får ikke plass')).toBeVisible()
    await expect(field).not.toContainText('Altfor mye tekst')
    // The draft that was accepted is still there; nothing was lost.
    await expect(field).toContainText('Kort nok.')

    await sheet.getByTestId('focused-text-done').click()
    await expect(sheet).toBeHidden()
    await expect(stage(page)).toContainText('Kort nok.')
  })

  test('skjermtastatur skjuler ikke den primære handlingen', async ({ page }) => {
    await createPresentation(page, 'Tastatur')
    await addCardToRootZone(page)
    await openPanel(page, 'content')
    await page.getByTestId('compact-content-item').first().click()
    await expect(page.getByTestId('focused-text-editor')).toBeVisible()

    const shellBefore = await page.getAttribute('[data-testid="editor"]', 'data-shell')
    await openKeyboard(page)
    // «Ferdig» is the way out of the writing surface, so it is the one control
    // that may never end up behind the keyboard.
    expect(await isOnScreen(page, 'focused-text-done')).toBe(true)
    /*
     * And the editor underneath is the same editor.
     *
     * A keyboard covers part of the page; it does not make the window smaller.
     * If it were allowed to decide which shell is mounted, opening it would
     * unmount the very field the caret is in — see `deriveWorkspace`, and the
     * viewport meta in `index.html` that keeps the layout viewport still.
     */
    await expect(page.getByTestId('editor')).toHaveAttribute('data-shell', shellBefore ?? '')

    await closeKeyboard(page)
    await page.getByTestId('focused-text-done').click()
    await expect(page.getByTestId('focused-text-editor')).toBeHidden()

    // And the workspace's own bottom bar, once the sheet is gone.
    await openKeyboard(page)
    expect(await isOnScreen(page, 'compact-tab-bar')).toBe(true)
    await closeKeyboard(page)
  })

  /*
   * A `position: fixed` box is anchored to the layout viewport whatever the
   * keyboard is doing — that is the whole reason `visualViewport` exists. So a
   * dialog centred on the window hangs its buttons behind the keyboard, and a
   * sheet pinned to the window's bottom disappears under it. Both are placed
   * against the visible band instead.
   */
  test('dialoger og verktøyark holder seg over skjermtastaturet', async ({ page }) => {
    await createPresentation(page, 'Over tastaturet')

    await openPanel(page, 'slides')
    await page.getByTestId('add-slide').click()
    await expect(page.locator('[role="dialog"]').first()).toBeVisible()
    await openKeyboard(page)
    // The buttons that finish the job, not merely the dialog's top edge.
    expect(await isOnScreen(page, 'new-slide-with-title')).toBe(true)
    await closeKeyboard(page)
    await page.getByTestId('new-slide-with-title').click()

    // Ideas is a sheet with a text field in its own footer: the one surface
    // where being under the keyboard would hide the thing it exists for.
    await openPanel(page, 'tools')
    await page.getByTestId('compact-tool-ideas').click()
    await expect(page.getByTestId('ideas-window')).toBeVisible()
    await openKeyboard(page)
    expect(await isOnScreen(page, 'idea-input')).toBe(true)
    await closeKeyboard(page)
  })

  test('rotasjon beholder valgt slide, valgt sone og angrehistorikk', async ({ page }) => {
    await createPresentation(page, 'Rotasjon')
    await openPanel(page, 'slides')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await closePanel(page)
    await addCardToRootZone(page)

    await openPanel(page, 'zone')
    await page.getByTestId('inspector-action-split').click()
    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()

    const slideBefore = await page.getByTestId('inspector-breadcrumb').textContent()
    const selectedBefore = await page.evaluate(
      () => document.querySelector('[data-node-outline]')?.getAttribute('data-node-outline') ?? '',
    )
    const orderBefore = await slideOrder(page)

    await rotate(page)

    // Same deck, same page, same zone — a turn of the wrist is a layout signal
    // and nothing else.
    await expect(page.getByTestId('editor')).toHaveAttribute('data-shell', 'compact')
    await openPanel(page, 'zone')
    await expect(page.getByTestId('inspector-breadcrumb')).toHaveText(slideBefore ?? '')
    expect(await slideOrder(page)).toEqual(orderBefore)
    expect(selectedBefore).not.toBe('')

    // And the history survived: the split can still be stepped back.
    await page.getByTestId('undo').click()
    await expect(page.getByTestId('zone-ratios')).toHaveCount(0)
    await rotate(page)
  })

  test('plasserer et sandkasseelement uten å dra det', async ({ page }) => {
    await createPresentation(page, 'Sandkasse')
    await addCardToRootZone(page)

    // Park the content, so the sandbox has something in it and the zone is free.
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-action-sandbox').click()
    await expect(page.getByTestId('sandbox-window')).toBeVisible()
    await expect(page.getByTestId('sandbox-item')).toHaveCount(1)

    // Pick the item, then pick the zone. No drag at any point.
    await page.getByTestId('sandbox-place').click()
    await expect(page.getByTestId('placement-bar')).toBeVisible()
    await expect(page.getByTestId('zone-drop-available')).toHaveCount(1)
    await pressSlide(page, 800, 500)

    await expect(page.getByTestId('placement-bar')).toBeHidden()
    await expect(stage(page).locator('.zone-content--card')).toBeVisible()
    await openPanel(page, 'tools')
    await expect(page.getByTestId('compact-tool-sandbox')).toHaveText('Sandkassen')
  })

  test('modaler holder seg innenfor en liten viewport og beholder knappene sine', async ({
    page,
  }) => {
    await createPresentation(page, 'Modal')
    await openPanel(page, 'slides')
    await page.getByTestId('add-slide').click()

    const dialog = page.locator('[role="dialog"]').first()
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    const view = page.viewportSize()!
    expect(box!.width).toBeLessThanOrEqual(view.width)
    expect(box!.height).toBeLessThanOrEqual(view.height)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    // The action that finishes the job is on screen, not below the fold.
    await expect(page.getByTestId('new-slide-with-title')).toBeInViewport()
    await page.getByTestId('new-slide-with-title').click()
    await expect(dialog).toBeHidden()
  })

  test('presentasjonsmodus styres og avsluttes uten tastatur', async ({ page }) => {
    await createPresentation(page, 'Visning')
    await openPanel(page, 'slides')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    // Start from the front, so there is somewhere to go next.
    await openPanel(page, 'slides')
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toBeVisible()

    // The controls are up to begin with on a surface that has no keys.
    const controls = page.getByTestId('present-controls')
    await expect(controls).toHaveAttribute('data-visible', '')
    const start = Number(await page.getByTestId('present-view').getAttribute('data-page'))

    await page.getByTestId('present-next').click()
    await expect(page.getByTestId('present-view')).toHaveAttribute('data-page', String(start + 1))
    await page.getByTestId('present-prev').click()
    await expect(page.getByTestId('present-view')).toHaveAttribute('data-page', String(start))

    /*
     * A press on empty slide area is the one thing that differs by pointer, so
     * it is asserted against the pointer this run actually has.
     *
     * With a finger it asks for the controls: a tap is as likely to be
     * somebody steadying the phone as a request for the next page. With a
     * mouse it is the fastest way through a deck and always has been — a small
     * window does not change that, and taking the click away to toggle a bar
     * the mouse can already see would be a regression on the desktop.
     */
    const view = page.getByTestId('present-view')
    // The top-left corner: away from the controls and away from the page's text.
    const emptyArea = { position: { x: 5, y: 5 } }

    if (await isCoarse(page)) {
      await expect(controls).toHaveAttribute('data-visible', '')
      await view.click(emptyArea)
      await expect(view).toHaveAttribute('data-page', String(start))
      await expect(controls).not.toHaveAttribute('data-visible', '')
      // And a press brings them back, which on this surface is the only way.
      await view.click(emptyArea)
      await expect(controls).toHaveAttribute('data-visible', '')
    } else {
      await view.click(emptyArea)
      await expect(view).toHaveAttribute('data-page', String(start + 1))
      // The controls stay put: with no press to bring them back, hiding them
      // would simply lose them.
      await expect(controls).toHaveAttribute('data-visible', '')
      await page.getByTestId('present-prev').click()
      await expect(view).toHaveAttribute('data-page', String(start))
    }

    // Out without touching a key.
    await page.getByTestId('present-exit').click()
    await expect(page.getByTestId('editor')).toBeVisible()
  })

  test('starter og avslutter en miniapp med trykk', async ({ page }) => {
    await createPresentation(page, 'Miniapp')
    await openPanel(page, 'slides')
    await page.getByTestId('add-interactive').click()
    await page.getByTestId('interactive-file-input').setInputFiles({
      name: 'counter-app.html',
      mimeType: 'text/html',
      buffer: COUNTER,
    })
    await page.getByTestId('interactive-name-input').fill('Teller')
    await page.getByTestId('create-interactive').click()
    await expect(page.getByTestId('new-interactive-modal')).toBeHidden()
    await closePanel(page)

    // The cover's button is a real target, and pressing it starts the app.
    await page.getByTestId('activate-interactive').click()
    await expect(page.getByTestId('interactive-runtime')).toBeVisible()
    const coarse = await isCoarse(page)

    // While it runs the app owns its own surface, this finger included: the
    // chrome above sits over one corner and takes nothing else.
    const inner = page.frameLocator('[data-testid="interactive-frame"]').frameLocator('#app')
    await expect(inner.locator('#title')).toHaveText('Teller')
    if (coarse) await inner.locator('#count').tap()
    else await inner.locator('#count').click()
    await expect(inner.locator('#value')).toHaveText('1')
    await inner.locator('#text').fill('hei')
    await expect(inner.locator('#text')).toHaveValue('hei')

    /*
     * Slaids' way out is two sizes at once, which is the whole point of it: the
     * glyph is small, because it is drawn on top of somebody's app, and the
     * target around it is a finger's, because it has to be hit without aiming.
     * Both are screen pixels whatever the slide's scale.
     */
    const exit = page.getByTestId('exit-interactive')
    const box = (await exit.boundingBox())!
    const glyphBox = (await page.getByTestId('exit-interactive-glyph').boundingBox())!
    expect(glyphBox.width).toBeLessThanOrEqual(28)
    expect(box.width).toBeGreaterThan(glyphBox.width)
    expect(box.height).toBeGreaterThan(glyphBox.height)
    if (coarse) {
      // The shared token, not a number of this control's own.
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    } else {
      expect(box.width).toBeGreaterThanOrEqual(32)
      expect(box.height).toBeGreaterThanOrEqual(32)
    }

    // And all of it is somewhere a thumb can actually go: inside the part of
    // the page that is on screen, and inside the slide's own top right corner,
    // whichever way the phone is held.
    expect(await isOnScreen(page, 'exit-interactive')).toBe(true)
    const slideBox = (await stage(page).boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(slideBox.x + slideBox.width + 1)
    expect(box.x).toBeGreaterThan(slideBox.x + slideBox.width * 0.6)
    expect(box.y).toBeGreaterThanOrEqual(slideBox.y - 1)
    expect(box.y).toBeLessThan(slideBox.y + slideBox.height * 0.3)

    // A tap — never a hover, which a finger cannot do — and the app is gone.
    if (coarse) await exit.tap()
    else await exit.click()
    await expect(page.getByTestId('interactive-runtime')).toBeHidden()
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(page.getByTestId('activate-interactive')).toBeVisible()
  })

  /*
   * A reference slide is computed from the deck and is read-only. What matters
   * here is that the panels answer about *it* and not about the authored slide
   * the view was opened from: a text list that offered that slide's fields
   * would let somebody edit a page they cannot see.
   */
  test('en avledet side tilbyr ingenting å redigere', async ({ page }) => {
    await createPresentation(page, 'Avledet')
    await addCardToRootZone(page)

    // Cite something, so the deck grows a reference slide. A body field, not
    // the title: a citation is body text, and the title's toolbar says so by
    // not offering the button.
    await openPanel(page, 'content')
    await page.locator('[data-testid="compact-content-item"][data-target-kind="body"]').first().click()
    await page.getByTestId('focused-text-editor').locator('.tiptap').first().click()
    await page.keyboard.insertText('Påstand med kilde')
    await page.getByTestId('insert-reference').click()
    await expect(page.getByTestId('reference-modal')).toBeVisible()
    await page.getByTestId('reference-title').fill('En viktig kilde')
    await page.getByTestId('save-reference').click()
    await page.getByRole('button', { name: 'Lukk' }).click()
    await page.getByTestId('focused-text-done').click()

    // Go to the generated page from the slide overview.
    await openPanel(page, 'slides')
    await expect(page.getByTestId('filmstrip-derived')).toHaveCount(1)
    await page.getByTestId('filmstrip-derived').getByRole('button').first().click()
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-readonly', '')

    // The text panel answers about the page on screen, which has no fields.
    await openPanel(page, 'content')
    await expect(page.getByTestId('compact-content-item')).toHaveCount(0)
    await expect(page.getByTestId('compact-content-empty')).toContainText('lages automatisk')

    // Back to an authored slide, and the fields are there again.
    await openPanel(page, 'slides')
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await openPanel(page, 'content')
    await expect(page.getByTestId('compact-content-item').first()).toBeVisible()
  })

  test('innholdsvelgeren følger den samme regelen som på desktop', async ({ page }) => {
    /*
     * Same rule, different surface.
     *
     * A compact workspace offers the content kinds in its own list rather than
     * in the zone, and the zone panel offers them again — but «can this kind be
     * drawn in this zone» is the domain's answer in both places, so a zone too
     * small for a card is a zone with no card button here either. The reason is
     * written out rather than hovered for: there is no pointer to hover with.
     */
    await createPresentation(page, 'Velger på mobil')
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-action-split').click()
    await expect(page.getByTestId('split-modal')).toBeVisible()
    await page.getByTestId('split-axis-y').click()
    await page.getByTestId('split-count').fill('3')
    await expect(page.getByTestId('split-weight-2')).toBeVisible()
    for (const [index, weight] of ['1', '10', '1'].entries()) {
      await page.getByTestId(`split-weight-${index}`).fill(weight)
    }
    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()

    // Select the sliver at the top of the slide, by its own rectangle rather
    // than by a guessed point: it is only a few dozen pixels tall.
    const zones = await zoneRects(page)
    const sliver = zones.reduce((shortest, zone) => (zone.h < shortest.h ? zone : shortest))
    await closePanel(page)
    await pressSlide(page, sliver.x + sliver.w / 2, sliver.y + sliver.h / 2)

    await openPanel(page, 'tools')
    await expect(page.getByTestId('content-kind-titled-card')).toBeDisabled()
    await expect(page.getByTestId('content-kind-negative-space')).toBeEnabled()
    await expect(page.getByTestId('content-kind-hint')).toContainText('for liten')

    // And the zone panel, which is the other door to the same choice.
    await openPanel(page, 'zone')
    await expect(page.getByTestId('inspector-add-titled-card')).toBeDisabled()
    await expect(page.getByTestId('inspector-add-negative-space')).toBeEnabled()

    await page.getByTestId('inspector-add-negative-space').click()
    await expect(stage(page).locator('[data-content-kind="negative-space"]')).toHaveCount(1)
  })

  test('lagrer og henter tilbake etter reload', async ({ page }) => {
    await createPresentation(page, 'Varig')
    await addCardToRootZone(page)
    await openPanel(page, 'content')
    await page.getByTestId('compact-content-item').first().click()
    await page.getByTestId('focused-text-editor').locator('.tiptap').first().click()
    await page.keyboard.insertText('Skrevet på mobil')
    await page.getByTestId('focused-text-done').click()

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toHaveAttribute('data-shell', 'compact')
    await expect(stage(page)).toContainText('Skrevet på mobil')

    // And the way back out of the editor still works from the compact bar.
    await backToLibrary(page)
    await expect(page.getByTestId('presentation-card').first()).toContainText('Varig')
  })
})
