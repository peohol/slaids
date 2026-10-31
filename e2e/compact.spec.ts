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
  chooseSlideAction,
  addPage,
} from './helpers'
import {
  closeKeyboard,
  closePanel,
  dragAcrossSlide,
  isCoarse,
  isOnScreen,
  longPressSlide,
  longPressThenDrag,
  longPressWithDrift,
  openKeyboard,
  openPanel,
  pinchSlide,
  pressSlide,
  rotate,
  selectedText,
  shownSlideId,
  slideOrder,
  slidePointAt,
  stageArea,
  stageRoom,
  stageZoom,
  swipeSlide,
} from './compactHelpers'

const COUNTER = readFileSync(new URL('./apps/counter-app.html', import.meta.url))

/** Put an untitled card into the slide's one empty zone, from the zone panel. */
async function addCardToRootZone(page: Page): Promise<void> {
  await openPanel(page, 'zone')
  await page.getByTestId('inspector-add-untitled-card').click()
  await expect(stage(page).locator('.zone-content--card')).toBeVisible()
}

/** Add `count` ordinary slides through the overview, the way a finger does. */
async function addSlides(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await openPanel(page, 'slides')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
  }
}

/**
 * The field the stage is a writing surface for right now.
 *
 * The real thing rather than a stand-in: `.tiptap[contenteditable="true"]` is
 * ProseMirror's own answer to «this is a document you may type in», so a test
 * that finds one has found the same editor the desktop uses.
 */
function focusedField(page: Page) {
  return stage(page).locator('.tiptap[contenteditable="true"]').first()
}

/**
 * Write in one of the slide's fields the way a phone gets there: choose it in
 * the text list, which fills the stage with it, and type.
 *
 * Nothing is clicked after the list entry, deliberately — a field named rather
 * than pressed arrives with the caret already in it, so every use of this
 * helper is also a check that it does.
 */
async function writeInField(page: Page, kind: string, text: string): Promise<void> {
  await openPanel(page, 'content')
  await page
    .locator(`[data-testid="compact-content-item"][data-target-kind="${kind}"]`)
    .first()
    .click()
  await expect(focusedField(page)).toBeVisible()
  await page.keyboard.insertText(text)
}

/** Open «Innholdstype» from the tools panel: the same menu the desktop toolbar opens. */
async function openCompactKindMenu(page: Page) {
  await openPanel(page, 'tools')
  await page.getByTestId('compact-tool-content-kind').click()
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  return menu
}

/** The one way out of a focused field. */
async function exitFocus(page: Page): Promise<void> {
  await page.getByTestId('compact-stage-exit').click()
  await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')
}

/** Split the selected zone in two, through the dialog the panel offers. */
async function splitSelectedZone(page: Page): Promise<void> {
  await openPanel(page, 'zone')
  await page.getByTestId('inspector-action-split').click()
  await expect(page.getByTestId('split-modal')).toBeVisible()
  await page.getByTestId('split-apply').click()
  await expect(page.getByTestId('split-modal')).toBeHidden()
}

/** The smallest zone whose rectangle contains this slide point. */
function zoneAt(zones: { id: string; x: number; y: number; w: number; h: number }[], point: { x: number; y: number }) {
  return zones
    .filter((zone) => 
      point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h)
    .sort((a, b) => a.w * a.h - b.w * b.h)[0]
}

/** The same box, to the pixel. */
function expectSameBox(actual: { x: number; y: number; width: number; height: number } | null, expected: { x: number; y: number; width: number; height: number } | null): void {
  expect(actual).not.toBeNull()
  expect(expected).not.toBeNull()
  expect(actual!.x).toBeCloseTo(expected!.x, 1)
  expect(actual!.y).toBeCloseTo(expected!.y, 1)
  expect(actual!.width).toBeCloseTo(expected!.width, 1)
  expect(actual!.height).toBeCloseTo(expected!.height, 1)
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

    // Selecting a page from the overview is navigation, so the overview closes
    // and leaves the selected page on screen.
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('compact-panel')).toBeHidden()
    await openPanel(page, 'slides')
    await expect(page.getByTestId('filmstrip-item').nth(1)).toHaveClass(/filmstrip__item--active/)

    // Reordering without a drag anywhere in sight.
    await chooseSlideAction(page, 2, 'move-slide-up')
    await expect
      .poll(() => slideOrder(page))
      .toEqual([before[0], before[2], before[1], ...before.slice(3)])

    // And back again, from the other end.
    await chooseSlideAction(page, 1, 'move-slide-down')
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
   * has nothing to type into until it is given a caption — so a long press on
   * it still fills the stage with the zone, and still finds no caret to offer,
   * because there is none to offer.
   */
  test('en bildesone uten bildetekst fokuseres, men har ingen tekst å skrive i', async ({
    page,
  }) => {
    await createPresentation(page, 'Bilde uten tekst')
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-add-image').click()
    await dismissImageModal(page)
    await closePanel(page)

    await longPressSlide(page, 800, 500)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    await expect(focusedField(page)).toHaveCount(0)
    // Nothing to type in means no bar to type with, either.
    await expect(page.getByTestId('text-toolbar')).toHaveCount(0)
    await expect(page.getByTestId('text-toolbar-empty')).toHaveCount(0)
    /*
     * An empty picture panel offers to pick a file, so the press that ends the
     * long press may land on that offer — depending on where the panel is drawn
     * once the zone fills the stage. Either way it is not what is under test.
     */
    if (await page.getByTestId('image-modal').isVisible()) await dismissImageModal(page)
    await exitFocus(page)

    // Give it a caption with something in it. A caption that is still empty is
    // not a field yet — it removes itself the moment the caret leaves, which is
    // the rule `CaptionEditor` states — so the text list is where one is filled.
    await openPanel(page, 'zone')
    await page.getByTestId('caption-position-bottom').click()
    await writeInField(page, 'caption', 'En bildetekst')
    await exitFocus(page)

    // And now the very same gesture lands in a writing surface.
    await longPressSlide(page, 800, 500)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    await expect(focusedField(page)).toBeVisible()
  })

  test('tekstlista åpner den samme skriveflaten på sliden, og fit måles der', async ({
    page,
  }) => {
    await createPresentation(page, 'Tekst')
    await addCardToRootZone(page)

    await openPanel(page, 'content')
    const fields = page.getByTestId('compact-content-item')
    await expect(fields.first()).toBeVisible()
    await fields.filter({ hasText: 'Rot' }).first().click()

    // The list is navigation: what it opens is the field on the slide, not a
    // sheet over it. The old separate writing surface is gone for good.
    await expect(page.getByTestId('focused-text-editor')).toHaveCount(0)
    await expect(page.getByTestId('compact-panel')).toBeHidden()
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    const field = focusedField(page)
    await expect(field).toBeVisible()
    // Typed without pressing anything first: naming a field in the list brings
    // the caret with it, which is the whole difference from a long press.
    await page.keyboard.insertText('Kort nok.')
    await expect(stage(page)).toContainText('Kort nok.')

    // The zone is drawn several times its real size here and would happily
    // hold this. The zone at 1600 × 900 would not, so the edit is refused —
    // measured against the slide, exactly as a command measures it.
    await page.keyboard.insertText('Altfor mye tekst til denne sonen. '.repeat(120))
    await expect(toast(page, 'får ikke plass')).toBeVisible()
    await expect(field).not.toContainText('Altfor mye tekst')
    // The draft that was accepted is still there; nothing was lost.
    await expect(field).toContainText('Kort nok.')

    await exitFocus(page)
    await expect(stage(page)).toContainText('Kort nok.')
  })

  test('skjermtastatur skjuler ikke den primære handlingen', async ({ page }) => {
    await createPresentation(page, 'Tastatur')
    await addCardToRootZone(page)
    await openPanel(page, 'content')
    await page.getByTestId('compact-content-item').first().click()
    await expect(focusedField(page)).toBeVisible()

    const shellBefore = await page.getAttribute('[data-testid="editor"]', 'data-shell')
    await openKeyboard(page)
    // The × is the way out of the writing surface, so it is the one control
    // that may never end up behind the keyboard.
    expect(await isOnScreen(page, 'compact-stage-exit')).toBe(true)
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
    await exitFocus(page)

    // And the workspace's own bottom bar, once the field is left.
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
    await addPage(page, 'interactive')
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
    await writeInField(page, 'body', 'Påstand med kilde')
    await page.getByTestId('insert-reference').click()
    await expect(page.getByTestId('reference-modal')).toBeVisible()
    await page.getByTestId('reference-title').fill('En viktig kilde')
    await page.getByTestId('save-reference').click()
    await page.getByRole('button', { name: 'Lukk' }).click()
    await exitFocus(page)

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

    // The tools panel's «Innholdstype» is the desktop toolbar's menu button.
    const menu = await openCompactKindMenu(page)
    await expect(menu.getByTestId('menu-kind-titled-card')).toHaveAttribute('data-disabled', '')
    await expect(menu.getByTestId('menu-kind-negative-space')).not.toHaveAttribute('data-disabled', '')
    // The reason belongs to the choice it is about, not to the panel: there is
    // no pointer here to hover a tooltip with.
    await expect(menu.getByTestId('menu-kind-titled-card')).toContainText('for liten')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // And the zone panel, which is the other door to the same choice.
    await openPanel(page, 'zone')
    await expect(page.getByTestId('inspector-add-titled-card')).toBeDisabled()
    await expect(page.getByTestId('inspector-add-negative-space')).toBeEnabled()
    // Written beside the choice here too, not kept for a hover.
    await expect(page.getByTestId('inspector-add-titled-card')).toContainText('for liten')

    await page.getByTestId('inspector-add-negative-space').click()
    await expect(stage(page).locator('[data-content-kind="negative-space"]')).toHaveCount(1)
  })

  test('forklarer hvert utilgjengelige valg for seg, med sin egen grunn', async ({ page }) => {
    /*
     * Two choices, unavailable for two different reasons at once.
     *
     * A card and a picture do not need the same room — a card spends a header
     * and two paddings before a single line of text, a picture spends nothing —
     * so in one sliver of a zone the two are refused with two different
     * sentences. One shared line of help would have to pick one of them and be
     * wrong about the other, and on this surface there is no pointer to hover a
     * tooltip with: the explanation has to belong to the choice it is about.
     */
    await createPresentation(page, 'To grunner')
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

    const zones = await zoneRects(page)
    const sliver = zones.reduce((shortest, zone) => (zone.h < shortest.h ? zone : shortest))
    await closePanel(page)
    await pressSlide(page, sliver.x + sliver.w / 2, sliver.y + sliver.h / 2)
    const menu = await openCompactKindMenu(page)

    const reason = (kind: string) => menu.getByTestId(`menu-kind-${kind}`).locator('.context-menu__reason')
    await expect(reason('titled-card')).toBeVisible()
    await expect(reason('image')).toBeVisible()
    // Each says what *that* kind needs, so the two cannot be the same sentence.
    expect(await reason('titled-card').textContent()).not.toBe(await reason('image').textContent())

    // And the one choice that is available carries no explanation at all.
    await expect(menu.getByTestId('menu-kind-negative-space')).not.toHaveAttribute('data-disabled', '')
    await expect(reason('negative-space')).toHaveCount(0)
  })

  test('sonepanelet sier hva som er valgt, og alt i det nås med trykk', async ({ page }) => {
    await createPresentation(page, 'Sonepanel')
    await addCardToRootZone(page)

    // What is selected, and where, before anything is done to it.
    const head = page.getByTestId('inspector-selection')
    await expect(head).toContainText('Kort uten tittel')
    await expect(head).toContainText('Hovedsonen')

    // The kind is changed from the same menu the desktop toolbar opens.
    await page.getByTestId('inspector-content-kind').click()
    await page.getByTestId('context-menu').getByTestId('menu-kind-titled-card').click()
    await expect(stage(page).locator('[data-content-kind="titled-card"]')).toHaveCount(1)
    await expect(head).toContainText('Kort med tittel')

    // Split it, pick one half by name, and reach each ratio in its fold.
    await page.getByTestId('inspector-action-split').click()
    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()
    await expect(page.getByTestId('inspector-child-0')).toContainText('Kort med tittel')
    await page.getByTestId('inspector-child-1').click()
    await expect(head).toContainText('Sone 2 av 2')
    await page.getByTestId('inspector-fold-zone-ratios').locator('summary').click()
    await page.getByTestId('zone-weight-up-1').click()
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 2')

    // Nothing in the panel runs past its edge on this width.
    const overflow = await page.getByTestId('inspector').evaluate((panel) => {
      const edge = panel.getBoundingClientRect().right
      return [...panel.querySelectorAll<HTMLElement>('button, summary')]
        .filter((control) => control.getBoundingClientRect().right > edge + 0.5)
        .map((control) => control.textContent ?? '')
    })
    expect(overflow).toEqual([])
  })

  /* ----------------------------------------------------------------- *
   * Swiping between slides
   * ----------------------------------------------------------------- */

  test('sveip mot venstre er neste slide, mot høyre er forrige', async ({ page }) => {
    await createPresentation(page, 'Sveip')
    await addSlides(page, 2)

    await openPanel(page, 'slides')
    const order = await slideOrder(page)
    expect(order.length).toBe(4)
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
    await closePanel(page)
    await expect.poll(() => shownSlideId(page)).toBe(order[0])

    /*
     * The direction, spelled out in the hand's own travel rather than through
     * the helper: dragging the page leftwards brings the next one in from the
     * right, the way every carousel on a phone behaves.
     */
    const travel = Math.min(240, (await stageArea(page)).width * 0.5)
    await dragAcrossSlide(page, { dx: -travel, dy: 0 })
    await expect.poll(() => shownSlideId(page)).toBe(order[1])
    await dragAcrossSlide(page, { dx: travel, dy: 0 })
    await expect.poll(() => shownSlideId(page)).toBe(order[0])
  })

  test('én gest flytter nøyaktig én slide', async ({ page }) => {
    await createPresentation(page, 'Én per gest')
    await addSlides(page, 2)

    await openPanel(page, 'slides')
    const order = await slideOrder(page)
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
    await closePanel(page)
    await expect.poll(() => shownSlideId(page)).toBe(order[0])

    /*
     * One flick, one page, however far the hand goes. A recogniser that fired
     * on every move instead of on the release would have gone straight to the
     * end of the deck here.
     */
    await swipeSlide(page, 1)
    await expect.poll(() => shownSlideId(page)).toBe(order[1])
    await swipeSlide(page, 1)
    await expect.poll(() => shownSlideId(page)).toBe(order[2])
    await swipeSlide(page, -1)
    await expect.poll(() => shownSlideId(page)).toBe(order[1])
  })

  test('trykk og loddrett bevegelse er ikke slidebytte', async ({ page }) => {
    await createPresentation(page, 'Ikke sveip')
    await addSlides(page, 2)
    await closePanel(page)
    const before = await shownSlideId(page)
    const box = await stageArea(page)
    // Up in the corner of the stage, so a downward drag has somewhere to go
    // whichever way the phone is held.
    const from = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.2 }

    // A press that wobbled is still a press.
    await dragAcrossSlide(page, { dx: 6, dy: 4 }, from)
    expect(await shownSlideId(page)).toBe(before)

    // A drag down the page, and a drag down it that drifted sideways: neither
    // is a page turn, and a deck that jumped for one would be unusable.
    await dragAcrossSlide(page, { dx: 0, dy: box.height * 0.5 }, from)
    expect(await shownSlideId(page)).toBe(before)
    await dragAcrossSlide(page, { dx: 60, dy: box.height * 0.5 }, from)
    expect(await shownSlideId(page)).toBe(before)
  })

  test('en knapp og en kjørende miniapp eier sine egne gester', async ({ page }) => {
    await createPresentation(page, 'Egne gester')
    await openPanel(page, 'slides')
    await addPage(page, 'interactive')
    await page.getByTestId('interactive-file-input').setInputFiles({
      name: 'counter-app.html',
      mimeType: 'text/html',
      buffer: COUNTER,
    })
    await page.getByTestId('interactive-name-input').fill('Teller')
    await page.getByTestId('create-interactive').click()
    await expect(page.getByTestId('new-interactive-modal')).toBeHidden()
    await closePanel(page)
    const before = await shownSlideId(page)

    // A drag that starts on the cover's own button belongs to the button. It
    // goes rightwards — back through the deck — because this page was added
    // last and there is nothing after it for a hijacked gesture to reach.
    const activate = (await page.getByTestId('activate-interactive').boundingBox())!
    await dragAcrossSlide(
      page,
      { dx: 200, dy: 0 },
      { x: activate.x + activate.width / 2, y: activate.y + activate.height / 2 },
    )
    expect(await shownSlideId(page)).toBe(before)
    await expect(page.getByTestId('activate-interactive')).toBeVisible()

    // And while the app runs, every gesture on the page is the app's.
    await page.getByTestId('activate-interactive').click()
    await expect(page.getByTestId('interactive-runtime')).toBeVisible()
    await dragAcrossSlide(page, { dx: 220, dy: 0 })
    expect(await shownSlideId(page)).toBe(before)
    await expect(page.getByTestId('interactive-runtime')).toBeVisible()
  })

  /* ----------------------------------------------------------------- *
   * The slide overview
   * ----------------------------------------------------------------- */

  test('slideoversikten tar hele høyden under toppmenyen, med brede miniatyrer', async ({
    page,
  }) => {
    await createPresentation(page, 'Oversikt')
    await addSlides(page, 5)
    await openPanel(page, 'slides')

    const overview = (await page.getByTestId('compact-panel').boundingBox())!
    const topBar = (await page.getByTestId('compact-top-bar').boundingBox())!
    const tabBar = (await page.getByTestId('compact-tab-bar').boundingBox())!
    // Everything between the two bars, in both orientations: the overview is
    // navigation, not a drawer beside a sliver of the current slide.
    expect(overview.y).toBeLessThanOrEqual(topBar.y + topBar.height + 1)
    expect(overview.y + overview.height).toBeGreaterThanOrEqual(tabBar.y - 1)
    expect(overview.width).toBeCloseTo(topBar.width, 0)

    // The pages use the room: wider than the desktop column's thumbnail, and
    // together filling the row they are in.
    const list = (await page.getByTestId('filmstrip-list').boundingBox())!
    const thumb = (await page.getByTestId('filmstrip-thumb').first().boundingBox())!
    expect(thumb.width).toBeGreaterThan(168)
    const perRow = Math.max(1, Math.round(list.width / thumb.width))
    expect(thumb.width * perRow).toBeGreaterThan(list.width * 0.8)

    // There is more deck than screen, and the list is what scrolls.
    const scroll = await page
      .getByTestId('filmstrip-list')
      .evaluate((element) => {
        element.scrollTop = element.scrollHeight
        return { top: element.scrollTop, height: element.scrollHeight, visible: element.clientHeight }
      })
    expect(scroll.height).toBeGreaterThan(scroll.visible)
    expect(scroll.top).toBeGreaterThan(0)

    // Choosing a page is one press, and the overview gives the stage back.
    await page.getByTestId('filmstrip-list').evaluate((element) => element.scrollTo(0, 0))
    let thumbs = page.getByTestId('filmstrip-item')
    await thumbs.nth(2).getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('compact-panel')).toBeHidden()
    await openPanel(page, 'slides')
    thumbs = page.getByTestId('filmstrip-item')
    await expect(thumbs.nth(2)).toHaveClass(/filmstrip__item--active/)
    await expect(thumbs.nth(2).getByTestId('filmstrip-thumb')).toHaveAttribute(
      'aria-current',
      'true',
    )

    // The number row above a thumbnail is part of the same press: it chooses
    // the page and gives the stage back just the same.
    await thumbs.nth(1).locator('.filmstrip__index').click()
    await expect(page.getByTestId('compact-panel')).toBeHidden()
    await openPanel(page, 'slides')
    thumbs = page.getByTestId('filmstrip-item')
    await expect(thumbs.nth(1)).toHaveClass(/filmstrip__item--active/)

    // And the discrete way to reorder is still right there on every entry,
    // in the menu its own button opens.
    const order = await slideOrder(page)
    await chooseSlideAction(page, 2, 'move-slide-up')
    await expect
      .poll(() => slideOrder(page))
      .toEqual([order[0], order[2], order[1], ...order.slice(3)])
  })

  /* ----------------------------------------------------------------- *
   * Pinch, pan and the focus ladder
   * ----------------------------------------------------------------- */

  test('pinch zoomer stagen og ingenting annet', async ({ page }) => {
    await createPresentation(page, 'Pinch')
    // Asked of the app once there is an app to ask: a pinch needs two fingers,
    // and the run with a mouse has one pointer to give.
    test.skip(!(await isCoarse(page)), 'Pinch trenger to fingre; denne kjøringen har mus.')
    await addCardToRootZone(page)
    await closePanel(page)

    const pinched = await shownSlideId(page)
    const topBefore = await page.getByTestId('compact-top-bar').boundingBox()
    const tabsBefore = await page.getByTestId('compact-tab-bar').boundingBox()
    const slideBefore = (await stage(page).boundingBox())!
    expect(await stageZoom(page)).toBe(1)

    await pinchSlide(page, { from: 80, to: 260 })

    // The slide grew …
    expect(await stageZoom(page)).toBeGreaterThan(1.5)
    const slideAfter = (await stage(page).boundingBox())!
    expect(slideAfter.width).toBeGreaterThan(slideBefore.width * 1.4)

    // … and the application around it did not move, did not resize, and was
    // not itself zoomed by the browser.
    expectSameBox(await page.getByTestId('compact-top-bar').boundingBox(), topBefore)
    expectSameBox(await page.getByTestId('compact-tab-bar').boundingBox(), tabsBefore)
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBeCloseTo(1, 2)

    // One press puts it back, and nothing about it was ever the document's:
    // a reload comes back at the view the slide has always had.
    await page.getByTestId('compact-stage-reset-zoom').click()
    await expect.poll(() => stageZoom(page)).toBe(1)
    expectSameBox(await stage(page).boundingBox(), slideBefore)

    await pinchSlide(page, { from: 80, to: 260 })
    expect(await stageZoom(page)).toBeGreaterThan(1.5)

    /*
     * And a magnification is let go of, not merely hidden. Leaving the slide
     * and coming back must land on the page as it is, not on the corner
     * somebody was inspecting a minute ago — which would also silently take
     * the swipe away, since a magnified view pans instead of paging.
     */
    await openPanel(page, 'slides')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await openPanel(page, 'slides')
    const order = await slideOrder(page)
    // The slide just added, not the front page: a section draws no slide stage
    // of its own, and what is under test here is the stage's own state.
    await page.getByTestId('filmstrip-item').last().getByTestId('filmstrip-thumb').click()
    await closePanel(page)
    await expect.poll(() => shownSlideId(page)).toBe(order[order.length - 1])
    expect(await stageZoom(page)).toBe(1)

    await openPanel(page, 'slides')
    await page
      .getByTestId('filmstrip-item')
      .nth(order.indexOf(pinched))
      .getByTestId('filmstrip-thumb')
      .click()
    await closePanel(page)
    await expect.poll(() => shownSlideId(page)).toBe(pinched)
    expect(await stageZoom(page)).toBe(1)

    await pinchSlide(page, { from: 80, to: 260 })
    expect(await stageZoom(page)).toBeGreaterThan(1.5)
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('stage-slide')).toBeVisible()
    expect(await stageZoom(page)).toBe(1)
  })

  test('pinch zoomer også en seksjon, en miniappforside og en generert side', async ({ page }) => {
    await createPresentation(page, 'Pinch overalt')
    test.skip(!(await isCoarse(page)), 'Pinch trenger to fingre; denne kjøringen har mus.')
    await addCardToRootZone(page)

    // Cite something, so the deck also grows a generated reference page.
    await writeInField(page, 'body', 'Påstand med kilde')
    await page.getByTestId('insert-reference').click()
    await page.getByTestId('reference-title').fill('En kilde')
    await page.getByTestId('save-reference').click()
    await page.getByRole('button', { name: 'Lukk' }).click()
    await exitFocus(page)

    // … and a miniapp, so every kind of page the stage can show is in the deck.
    await openPanel(page, 'slides')
    await addPage(page, 'interactive')
    await page.getByTestId('interactive-file-input').setInputFiles({
      name: 'counter-app.html',
      mimeType: 'text/html',
      buffer: COUNTER,
    })
    await page.getByTestId('interactive-name-input').fill('Teller')
    await page.getByTestId('create-interactive').click()
    await expect(page.getByTestId('new-interactive-modal')).toBeHidden()

    /**
     * The whole requirement, on one page: the slide grows, the application
     * does not, and the browser never zoomed the page itself.
     */
    const pinchHere = async (what: string): Promise<void> => {
      const barBefore = await page.getByTestId('compact-top-bar').boundingBox()
      const slideBefore = (await stage(page).boundingBox())!
      expect(await stageZoom(page), what).toBe(1)

      await pinchSlide(page, { from: 80, to: 260 })

      expect(await stageZoom(page), what).toBeGreaterThan(1.5)
      const slideAfter = (await stage(page).boundingBox())!
      expect(slideAfter.width, what).toBeGreaterThan(slideBefore.width * 1.4)
      expectSameBox(await page.getByTestId('compact-top-bar').boundingBox(), barBefore)
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1), what).toBeCloseTo(1, 2)

      await page.getByTestId('compact-stage-reset-zoom').click()
      await expect.poll(() => stageZoom(page)).toBe(1)
    }

    // The front page is a section.
    await openPanel(page, 'slides')
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
    await closePanel(page)
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-section', '')
    await pinchHere('seksjon')

    // The miniapp's cover, with nothing running on it.
    await openPanel(page, 'slides')
    await page.getByTestId('filmstrip-item').last().getByTestId('filmstrip-thumb').click()
    await closePanel(page)
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-interactive', '')
    await pinchHere('miniappforside')

    // And the generated reference page, which nobody can edit but anyone may
    // want to read.
    await openPanel(page, 'slides')
    await page.getByTestId('filmstrip-derived').getByRole('button').first().click()
    await closePanel(page)
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-readonly', '')
    await pinchHere('generert side')
  })

  test('sonevalg treffer riktig slidepunkt gjennom en zoomet visning', async ({ page }) => {
    await createPresentation(page, 'Treff under zoom')
    test.skip(!(await isCoarse(page)), 'Pinch trenger to fingre; denne kjøringen har mus.')
    await splitSelectedZone(page)
    await closePanel(page)

    await pinchSlide(page, { from: 80, to: 220 })
    expect(await stageZoom(page)).toBeGreaterThan(1)

    /*
     * Press a point on screen, ask the geometry which zone is drawn there, and
     * require the two to agree. That is the whole promise of the view
     * transform: the page is bigger, the coordinates are not different.
     */
    const box = await stageArea(page)
    const where = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 }
    const point = await slidePointAt(page, where)
    const expected = zoneAt(await zoneRects(page), point)
    expect(expected).toBeTruthy()

    await page.mouse.click(where.x, where.y)
    await openPanel(page, 'zone')
    await expect(page.locator('.zone-outline--selected')).toHaveAttribute(
      'data-node-outline',
      expected.id,
    )
  })

  test('langtrykk fyller stagen med sonen og gjør den skrivbar i samme gest', async ({
    page,
  }) => {
    await createPresentation(page, 'Skriv i sonen')
    await splitSelectedZone(page)
    await closePanel(page)

    const zones = await zoneRects(page)
    const target = zones[0]
    const centre = { x: target.x + target.w / 2, y: target.y + target.h / 2 }
    await pressSlide(page, centre.x, centre.y)
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-add-untitled-card').click()
    await expect(stage(page).locator('.zone-content--card')).toBeVisible()
    await closePanel(page)

    const wholeSlide = (await stage(page).boundingBox())!
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')

    /*
     * An ordinary press is still an ordinary press: it selects, and nothing
     * about the view changes. The two gestures start identically, so this is
     * the assertion that says they are actually told apart.
     */
    await pressSlide(page, centre.x, centre.y)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')
    expectSameBox(await stage(page).boundingBox(), wholeSlide)

    /*
     * And holding still is the whole of it: the zone fills the stage *and* is
     * a writing surface, in one gesture. Nothing is pressed in between, and
     * there is nothing left to press — the two controls the old four-step
     * model needed do not exist.
     */
    await longPressSlide(page, centre.x, centre.y)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    const focused = (await stage(page).boundingBox())!
    expect(focused.width).toBeGreaterThan(wholeSlide.width)
    await expect(page.getByTestId('compact-stage-focus')).toHaveCount(0)
    await expect(page.getByTestId('compact-stage-edit')).toHaveCount(0)
    await expect(page.getByTestId('compact-stage-done')).toHaveCount(0)
    // And not under any other name either: the two controls of the old
    // four-step model are gone from the product, not merely renamed.
    await expect(page.getByRole('button', { name: 'Fokuser sonen' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rediger tekst' })).toHaveCount(0)

    const field = focusedField(page)
    await expect(field).toBeVisible()
    /*
     * Typed with nothing pressed in between. The long press is the whole way
     * in, so the caret has to be in the field when it ends — not only when the
     * fingertip happens to come down over a word after the zone has been
     * re-laid out several times its size.
     */
    await page.keyboard.insertText('Skrevet rett i sonen.')
    await expect(stage(page)).toContainText('Skrevet rett i sonen.')
    await expect(field).toBeFocused()

    // The toolbar is there for the field that has the caret, and acts on it.
    await page.getByTestId('format-bold').click()
    await page.keyboard.insertText('Uthevet')
    await expect(field.locator('strong')).toContainText('Uthevet')
    await page.getByTestId('format-bold').click()

    /*
     * And the surface is still not the measure. The zone is drawn several times
     * its real size here and would happily hold this; the zone at 1600 × 900
     * would not, so the edit is refused with the same message and the draft
     * that was accepted stays.
     */
    await page.keyboard.insertText('Altfor mye tekst til en halv slide. '.repeat(120))
    await expect(toast(page, 'får ikke plass')).toBeVisible()
    await expect(field).not.toContainText('Altfor mye tekst')
    await expect(field).toContainText('Skrevet rett i sonen.')

    // One × ends the typing and the focused view together, in one press.
    await exitFocus(page)
    expectSameBox(await stage(page).boundingBox(), wholeSlide)
    await expect(focusedField(page)).toHaveCount(0)
    await expect(stage(page)).toContainText('Skrevet rett i sonen.')
  })

  /*
   * The gesture has to be a gesture, not merely a timer: every other thing a
   * hand does on the slide area starts from the same pointerdown, and none of
   * them may end in a focused field.
   */
  test('bare et ekte langtrykk fokuserer: ikke drift, ikke sveip, ikke pinch', async ({
    page,
  }) => {
    await createPresentation(page, 'Ekte langtrykk')
    await addSlides(page, 1)
    await splitSelectedZone(page)
    // Back out of zone mode before the swipes: the zone tab *is* zone mode, and
    // there a press on the slide is a layout gesture that keeps the deck still.
    await openPanel(page, 'content')
    await closePanel(page)
    const zones = await zoneRects(page)
    const centre = { x: zones[0].x + zones[0].w / 2, y: zones[0].y + zones[0].h / 2 }

    // A finger that travelled was never resting.
    await longPressWithDrift(page, centre.x, centre.y, { dx: 90, dy: 0 })
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')

    // A swipe, however unhurried, turns the page instead.
    const before = await shownSlideId(page)
    await swipeSlide(page, -1)
    await expect.poll(() => shownSlideId(page)).not.toBe(before)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')
    await swipeSlide(page, 1)
    await expect.poll(() => shownSlideId(page)).toBe(before)

    // Two fingers held still are a pinch, and a pinch is never a long press.
    if (await isCoarse(page)) {
      await pinchSlide(page, { from: 80, to: 260 })
      await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')
      await page.getByTestId('compact-stage-reset-zoom').click()
      await expect.poll(() => stageZoom(page)).toBe(1)
    }

    // And the same hand, held still, does focus the zone.
    await longPressSlide(page, centre.x, centre.y)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    await exitFocus(page)

    /*
     * And the press is spent once it has fired. Dragging sideways before
     * letting go is how a hand extends a selection in the field it just
     * opened — the deck must not turn under it. Two recognisers saw this one
     * press, and only one of them knows it became a long press.
     */
    const here = await shownSlideId(page)
    await longPressThenDrag(page, centre.x, centre.y, { dx: -260, dy: 0 })
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    expect(await shownSlideId(page)).toBe(here)
  })

  /*
   * The bar formats the field you are looking at, or it is not there.
   *
   * The editors on a compact stage stay mounted when the focus moves and only
   * turn read-only, so a bar that was merely *shown* whenever something is
   * focused would still be aimed at the field just left — and pressing Bold
   * would change a page the user cannot see.
   */
  test('verktøylinja følger ikke med inn i en sone det ikke er noe å skrive i', async ({
    page,
  }) => {
    await createPresentation(page, 'Verktøylinja')
    await splitSelectedZone(page)
    await closePanel(page)
    const zones = await zoneRects(page)
    const a = { x: zones[0].x + zones[0].w / 2, y: zones[0].y + zones[0].h / 2 }
    const b = { x: zones[1].x + zones[1].w / 2, y: zones[1].y + zones[1].h / 2 }

    // A card in one zone and deliberate air in the other. Air rather than a
    // picture because an empty picture panel offers to pick a file, and what is
    // under test here is the bar, not that affordance.
    await pressSlide(page, a.x, a.y)
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-add-untitled-card').click()
    await closePanel(page)
    await pressSlide(page, b.x, b.y)
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-add-negative-space').click()
    await closePanel(page)
    // Out of zone mode, so nothing below clears the active field on the way.
    await openPanel(page, 'content')
    await closePanel(page)

    await longPressSlide(page, a.x, a.y)
    await page.keyboard.insertText('Uendret tekst')
    await expect(stage(page)).toContainText('Uendret tekst')
    await expect(page.getByTestId('text-toolbar')).toBeVisible()
    await exitFocus(page)

    // The empty zone focuses like any other, and has nothing to format.
    await longPressSlide(page, b.x, b.y)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    await expect(focusedField(page)).toHaveCount(0)
    await expect(page.getByTestId('text-toolbar')).toHaveCount(0)
    await expect(page.getByTestId('text-toolbar-empty')).toHaveCount(0)
    await expect(page.getByTestId('format-bold')).toHaveCount(0)

    // And the field left behind is exactly as it was.
    await exitFocus(page)
    await expect(stage(page)).toContainText('Uendret tekst')
    await expect(stage(page).locator('strong')).toHaveCount(0)
  })

  /*
   * A zone is several fields — a card's title, its body — and all of them carry
   * the same node id. A focus that remembered only the zone would answer every
   * entry of that zone identically, and the list's own distinction between them
   * would be decoration.
   */
  test('tekstlista åpner feltet man valgte, ikke bare sonen det ligger i', async ({ page }) => {
    await createPresentation(page, 'Riktig felt')
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-add-titled-card').click()
    await expect(stage(page).locator('.zone-content--card')).toBeVisible()

    await writeInField(page, 'card-title', 'Korttittelen')
    await expect(stage(page).locator('.card-header')).toContainText('Korttittelen')
    await expect(stage(page).locator('.card-body')).not.toContainText('Korttittelen')
    await exitFocus(page)

    await writeInField(page, 'body', 'Brødteksten')
    await expect(stage(page).locator('.card-body')).toContainText('Brødteksten')
    await expect(stage(page).locator('.card-header')).not.toContainText('Brødteksten')
    await exitFocus(page)

    // And the heading, which is not in a zone at all, is its own field too.
    await writeInField(page, 'slide-title', 'Slidetittelen')
    await expect(stage(page).getByTestId('slide-title')).toContainText('Slidetittelen')
    await expect(stage(page).locator('.card-header')).not.toContainText('Slidetittelen')
  })

  /*
   * The bar under a focused field is the desktop's, with the same groups and
   * the same states, and a finger uses it the way a mouse does: the press
   * formats the field that is the writing surface, shows what is now in force,
   * and leaves the caret — and the keyboard that comes with it — where it was.
   */
  test('tekstlinja formaterer feltet som skrives i og viser hva som gjelder, også med finger', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Formatering med finger')
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-add-titled-card').click()
    await expect(stage(page).locator('.zone-content--card')).toBeVisible()

    await writeInField(page, 'body', 'Viktig')
    await expect(page.getByTestId('text-toolbar')).toHaveAttribute('aria-label', 'Tekstverktøy for brødtekst')
    await page.keyboard.press('Shift+Home')
    const bold = page.getByTestId('format-bold')
    await expect(bold).toHaveAttribute('aria-pressed', 'false')
    const coarse = await isCoarse(page)
    if (coarse) await bold.tap()
    else await bold.click()
    const cardBody = stage(page).locator('.card-body .tiptap')
    await expect(cardBody.locator('strong')).toHaveText('Viktig')
    await expect(bold).toHaveAttribute('aria-pressed', 'true')
    await expect(cardBody).toBeFocused()
    await expect(page.getByTestId('valign-middle')).toHaveAttribute('aria-pressed', 'true')
    // A finger gets the full target, a mouse the compact one.
    const box = (await bold.boundingBox())!
    if (coarse) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44)
    await exitFocus(page)

    // The card's title is its own field, with only what a title can take.
    await writeInField(page, 'card-title', 'Tittel')
    await expect(page.getByTestId('text-toolbar')).toHaveAttribute('aria-label', 'Tekstverktøy for korttittel')
    await expect(page.getByTestId('format-superscript')).toBeVisible()
    await expect(page.getByTestId('format-bold')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  /*
   * A heading and a section's two lines are text on the page without being
   * zones of the layout. They are focused by the same gesture and edited on the
   * same stage — which is what keeps the compact workspace to one text model
   * rather than a stage for zones and a sheet for everything else.
   */
  test('slidetittel og seksjonslinjer redigeres på stagen som alt annet', async ({ page }) => {
    await createPresentation(page, 'Tittel og seksjon')
    await closePanel(page)

    // The heading sits above the layout, so `hitTestLayout` alone would miss it.
    await longPressSlide(page, 800, 60)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    const heading = focusedField(page)
    await expect(heading).toBeVisible()
    await heading.click()
    await page.keyboard.insertText('En overskrift')
    await exitFocus(page)
    await expect(stage(page).getByTestId('slide-title')).toContainText('En overskrift')

    // And the front page, which is a section: no zones at all, same gesture.
    await openPanel(page, 'slides')
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
    await closePanel(page)
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-section', '')
    await expect(focusedField(page)).toHaveCount(0)

    await longPressSlide(page, 800, 200)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    const line = focusedField(page)
    await expect(line).toBeVisible()
    await line.click()
    await page.keyboard.insertText('Seksjonen')
    await exitFocus(page)
    await expect(stage(page)).toContainText('Seksjonen')
  })

  test('en forlatt fokusering kommer ikke tilbake av seg selv', async ({ page }) => {
    await createPresentation(page, 'Forlatt fokus')
    await addSlides(page, 1)
    await splitSelectedZone(page)
    await closePanel(page)
    const zones = await zoneRects(page)
    const centre = { x: zones[0].x + zones[0].w / 2, y: zones[0].y + zones[0].h / 2 }
    const focusedOn = await shownSlideId(page)

    await longPressSlide(page, centre.x, centre.y)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')

    /*
     * Leave by turning the page, and come back. A focus that was only *hidden*
     * would be true again here and put the stage into a view nobody asked for.
     */
    await openPanel(page, 'slides')
    const order = await slideOrder(page)
    await page
      .getByTestId('filmstrip-item')
      .nth(order.indexOf(focusedOn) === 0 ? 1 : 0)
      .getByTestId('filmstrip-thumb')
      .click()
    await closePanel(page)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')

    await openPanel(page, 'slides')
    await page
      .getByTestId('filmstrip-item')
      .nth(order.indexOf(focusedOn))
      .getByTestId('filmstrip-thumb')
      .click()
    await closePanel(page)
    await expect.poll(() => shownSlideId(page)).toBe(focusedOn)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')
  })

  test('sveip når fram til en avledet referanseside og tilbake igjen', async ({ page }) => {
    await createPresentation(page, 'Avledet og sveip')
    await addCardToRootZone(page)

    // Cite something, so the deck grows a reference page after the last slide.
    await writeInField(page, 'body', 'Påstand med kilde')
    await page.getByTestId('insert-reference').click()
    await page.getByTestId('reference-title').fill('En kilde')
    await page.getByTestId('save-reference').click()
    await page.getByRole('button', { name: 'Lukk' }).click()
    await exitFocus(page)

    // Start on the last authored page. The next page in the audience order is
    // generated, but it must still be reachable by the same swipe.
    await openPanel(page, 'slides')
    const order = await slideOrder(page)
    await page.getByTestId('filmstrip-item').last().getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('compact-panel')).toBeHidden()
    await expect(page.getByTestId('stage-slide')).not.toHaveAttribute('data-readonly', '')

    await swipeSlide(page, 1)
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-readonly', '')

    // Going back walks the same page list in reverse and returns to the authored
    // page that came immediately before the generated one.
    await swipeSlide(page, -1)
    await expect(page.getByTestId('stage-slide')).not.toHaveAttribute('data-readonly', '')
    expect(await shownSlideId(page)).toBe(order[order.length - 1])
  })

  test('rotasjon beholder den fokuserte sonen', async ({ page }) => {
    await createPresentation(page, 'Fokus gjennom rotasjon')
    await splitSelectedZone(page)
    await closePanel(page)
    const zones = await zoneRects(page)
    await longPressSlide(page, zones[0].x + zones[0].w / 2, zones[0].y + zones[0].h / 2)
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')

    await rotate(page)

    // A turn of the wrist is a layout signal. Which field the user is writing
    // in is not a fact about the window, so it is still the one it was.
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'zone')
    await expect(page.getByTestId('compact-stage-exit')).toBeVisible()
    await openPanel(page, 'zone')
    await expect(page.locator('.zone-outline--selected')).toHaveAttribute(
      'data-node-outline',
      zones[0].id,
    )
    await rotate(page)
  })

  /* ----------------------------------------------------------------- *
   * Text selection
   * ----------------------------------------------------------------- */

  test('hver stage tar pinchen fra nettleseren, og bare stagen', async ({ page }) => {
    await createPresentation(page, 'Hvem eier pinchen')
    const touchAction = (testId: string): Promise<string> =>
      page.getByTestId(testId).evaluate((element) => getComputedStyle(element).touchAction)

    // Every stage magnifies the slide itself, so every stage takes the gesture.
    expect(await touchAction('stage-viewport')).toBe('none')
    await openPanel(page, 'slides')
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
    await closePanel(page)
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-section', '')
    expect(await touchAction('stage-viewport')).toBe('none')

    /*
     * The area around it keeps what the browser needs: it must not take a
     * sideways drag (that is the deck's), but vertical panning and the
     * browser's own pinch are still its own outside the page itself.
     */
    expect(await touchAction('compact-stage')).toContain('pan-y')
    expect(await touchAction('compact-stage')).toContain('pinch-zoom')

    // And the deck can still be swiped on a section, which is the other half.
    const before = await shownSlideId(page)
    await swipeSlide(page, 1)
    await expect.poll(() => shownSlideId(page)).not.toBe(before)
  })

  test('slideoversikten kan dra-sorteres i flerkolonnevisning', async ({ page }) => {
    await createPresentation(page, 'Dra i gridet')
    await addSlides(page, 3)
    await openPanel(page, 'slides')
    // The overview opens with the shown (last) slide in its middle; this test is
    // about the first entries, so it scrolls back to them by hand first.
    await page.getByTestId('filmstrip-list').evaluate((element) => element.scrollTo({ top: 0 }))

    const list = (await page.getByTestId('filmstrip-list').boundingBox())!
    const thumb = (await page.getByTestId('filmstrip-thumb').first().boundingBox())!
    const columns = Math.max(1, Math.round(list.width / thumb.width))
    test.skip(columns < 2, 'Denne flaten gir én kolonne; gridet testes der det finnes.')

    /*
     * A drag in a grid is not a drag in a column: the entries to either side
     * move sideways, not up and down, so the sorting strategy has to be the
     * one that makes no assumption about the shape. This is the test that
     * would fail if the overview kept the list's strategy.
     */
    const before = await slideOrder(page)
    const items = page.getByTestId('filmstrip-item')
    const from = (await items.nth(2).locator('.filmstrip__grip').boundingBox())!
    const to = (await items.nth(1).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 - 10, from.y + from.height / 2, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 })
    await page.mouse.move(to.x + to.width / 2 - 4, to.y + to.height / 2, { steps: 4 })
    await page.waitForTimeout(250)

    /*
     * Still holding: the entry being pushed out of the way has to move
     * *sideways*, because in a grid that is where the next cell is. This is
     * the assertion the list's own strategy fails — it would displace the
     * neighbour straight down, past an entry that is not underneath it. The
     * drop order alone would not catch it: where an item lands comes from
     * collision detection, and only the displacement comes from the strategy.
     */
    const pushed = await items.nth(1).evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return { x: matrix.m41, y: matrix.m42 }
    })
    expect(Math.abs(pushed.x)).toBeGreaterThan(Math.abs(pushed.y))
    expect(Math.abs(pushed.x)).toBeGreaterThan(8)

    await page.mouse.up()
    await expect
      .poll(() => slideOrder(page))
      .toEqual([before[0], before[2], before[1], ...before.slice(3)])
  })

  test('sonetekst markeres ikke av trykk eller drag, men et felt markerer som vanlig', async ({
    page,
  }) => {
    await createPresentation(page, 'Markering')
    await splitSelectedZone(page)
    await closePanel(page)
    const zones = await zoneRects(page)
    const target = zones[0]
    await pressSlide(page, target.x + target.w / 2, target.y + target.h / 2)
    await openPanel(page, 'zone')
    await page.getByTestId('inspector-add-untitled-card').click()
    await expect(stage(page).locator('.zone-content--card')).toBeVisible()

    // The card's own text, not the slide title: the words under test have to
    // be inside the zone that is focused further down.
    await writeInField(page, 'body', 'En setning som ser ut som den kan markeres.')
    await exitFocus(page)
    await expect(stage(page)).toContainText('En setning som ser ut')

    // The invariant, as the browser computes it: the words on the slide are a
    // picture of the presentation, not a text field.
    const words = stage(page).locator('.rich-doc:not(.rich-doc--title) p').first()
    expect(await words.evaluate((element) => getComputedStyle(element).userSelect)).toBe('none')

    /*
     * And as a hand performs it. Every drag here is kept shorter than a swipe
     * on purpose: what is under test is whether the words highlight, and a
     * gesture long enough to turn the page would be testing something else.
     */
    const line = (await words.boundingBox())!
    const mid = line.y + line.height / 2
    await page.mouse.move(line.x + 1, mid)
    await page.mouse.down()
    await page.mouse.move(line.x + 40, mid, { steps: 8 })
    await page.mouse.up()
    expect(await selectedText(page)).toBe('')

    // And a finger dragged straight across them.
    await dragAcrossSlide(page, { dx: 40, dy: 0 }, { x: line.x + 1, y: mid })
    expect(await selectedText(page)).toBe('')

    /*
     * A long press on them is the one gesture that has to do *both* things at
     * once: open the field, and leave no highlight behind on the way in. The
     * callout menu a phone would otherwise raise is the same thing said in the
     * platform's words.
     */
    await longPressSlide(page, target.x + target.w / 2, target.y + target.h / 2)
    expect(await selectedText(page)).toBe('')

    /*
     * Inside the writing surface it all comes back — because that is where the
     * user actually asked for a caret.
     */
    const field = focusedField(page)
    await expect(field).toBeVisible()
    expect(await field.evaluate((element) => getComputedStyle(element).userSelect)).toBe('text')
    await field.click()
    await page.keyboard.press('ControlOrMeta+a')
    expect(await selectedText(page)).toContain('setning')

    // The caret is a caret too: what is selected can be replaced by typing.
    await page.keyboard.insertText('Erstattet')
    await expect(field).toContainText('Erstattet')
    await expect(field).not.toContainText('setning')
  })

  /* ----------------------------------------------------------------- *
   * Tabs, modes and the tools panel (U6)
   * ----------------------------------------------------------------- */

  test('sonefanen er sonemodus, uansett hvordan man kommer inn og ut', async ({ page }) => {
    await createPresentation(page, 'Modus')
    await addCardToRootZone(page)
    const editor = page.getByTestId('editor')
    const zoneTab = page.getByTestId('compact-tab-zone')

    // In through the tab: the tab is pressed and the editor is in zone mode.
    await expect(editor).toHaveAttribute('data-mode', 'zone')
    await expect(zoneTab).toHaveAttribute('aria-pressed', 'true')

    // Out through the panel's own ×: back to content mode, with no tab
    // pressed and no zone outlines left on a slide that has no panel for them.
    await closePanel(page)
    await expect(editor).toHaveAttribute('data-mode', 'content')
    await expect(page.locator('.compact-tab[aria-pressed="true"]')).toHaveCount(0)

    // Another tab is content mode too.
    await openPanel(page, 'zone')
    await openPanel(page, 'slides')
    await expect(editor).toHaveAttribute('data-mode', 'content')
    await expect(zoneTab).toHaveAttribute('aria-pressed', 'false')

    // The keyboard reaches the same state from either side: Ctrl+E opens the
    // zone panel because it *is* zone mode, and Escape closes it again.
    await closePanel(page)
    await page.keyboard.press('ControlOrMeta+e')
    await expect(editor).toHaveAttribute('data-mode', 'zone')
    await expect(page.getByTestId('compact-panel')).toHaveAttribute('data-panel', 'zone')
    await expect(zoneTab).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(editor).toHaveAttribute('data-mode', 'content')
    await expect(page.getByTestId('compact-panel')).toBeHidden()
  })

  test('verktøypanelet er ordnet og navngitt som desktopens verktøylinje', async ({ page }) => {
    await createPresentation(page, 'Verktøy')
    await addCardToRootZone(page)
    await openPanel(page, 'tools')

    // The desktop toolbar's groups, in its order and with its names.
    await expect(page.getByTestId('compact-tools').locator('h3')).toHaveText([
      'Valgt sone',
      'Slide',
      'Presentasjon',
      'Verktøy',
    ])
    // The content kind is the desktop's menu button, naming the kind in force.
    await expect(page.getByTestId('compact-tool-content-kind')).toContainText('Kort uten tittel')
    await expect(page.getByTestId('compact-tool-content-kind')).toHaveAttribute('aria-haspopup', 'menu')

    // «Overskrift» is a toggle, as on the desktop: pressed while the slide has
    // its title zone, and the same command takes it away and back.
    const title = page.getByTestId('compact-tool-title')
    await expect(title).toHaveText('Overskrift')
    const before = await title.getAttribute('aria-pressed')
    await title.click()
    await expect(title).not.toHaveAttribute('aria-pressed', before ?? '')
    await page.getByTestId('undo').click()
    await expect(title).toHaveAttribute('aria-pressed', before ?? '')

    // The presentation's tools are the «Presentasjon» menu's entries, named as
    // there (a dialog still says so with its «…»), and the helpers the
    // «Verktøy» menu's.
    await expect(page.getByTestId('compact-tool-theme')).toHaveText('Tema …')
    await expect(page.getByTestId('compact-tool-shortcuts')).toHaveText('Hurtigtaster')
    await expect(page.getByTestId('toggle-share')).toBeVisible()
  })

  test('alle kontroller er fingerstore når pekeren er en finger', async ({ page }) => {
    await createPresentation(page, 'Treffflater')
    test.skip(!(await isCoarse(page)), 'Bare berøring skal ha fingerstore treffflater')
    await addCardToRootZone(page)

    /*
     * Every control on screen in every panel, measured as laid out: 44 px both
     * ways. The one exception is the colour grid, whose swatches share the
     * row and stay square at 28 px or more — still above the 24 px WCAG floor.
     */
    const tooSmall = () =>
      page.evaluate(() => {
        const found: string[] = []
        for (const control of document.querySelectorAll<HTMLElement>('button, input, select, summary')) {
          const box = control.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue
          if (control.closest('[data-testid="stage-slide"], .filmstrip__thumb')) continue
          const swatch = control.classList.contains('palette__swatch')
          const least = swatch ? 28 : 44
          if (box.width < least - 0.5 || box.height < least - 0.5) {
            found.push(`${control.dataset.testid ?? control.className} ${Math.round(box.width)}×${Math.round(box.height)}`)
          }
        }
        return found
      })

    for (const panel of ['slides', 'content', 'zone', 'tools'] as const) {
      await openPanel(page, panel)
      expect(await tooSmall(), panel).toEqual([])
    }
    await closePanel(page)
    expect(await tooSmall(), 'top and tab bars').toEqual([])
  })

  test('en tekstlinje som ruller sideveis viser at det finnes mer', async ({ page }) => {
    await createPresentation(page, 'Mer i linja')
    await addCardToRootZone(page)
    await writeInField(page, 'body', 'Tekst')
    const bar = page.getByTestId('text-toolbar')
    await expect(bar).toBeVisible()

    const overflows = await bar.evaluate((element) => element.scrollWidth > element.clientWidth + 1)
    test.skip(!overflows, 'Linja får plass i denne bredden')

    // At the start there is more to the right, and only to the right.
    await expect(bar).toHaveAttribute('data-more-end', '')
    await expect(bar).not.toHaveAttribute('data-more-start', '')
    // Scrolled to the end, the marks swap over.
    await bar.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
      element.dispatchEvent(new Event('scroll'))
    })
    await expect(bar).toHaveAttribute('data-more-start', '')
    await expect(bar).not.toHaveAttribute('data-more-end', '')
  })

  test('lagrer og henter tilbake etter reload', async ({ page }) => {
    await createPresentation(page, 'Varig')
    await addCardToRootZone(page)
    await writeInField(page, 'body', 'Skrevet på mobil')
    await exitFocus(page)

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toHaveAttribute('data-shell', 'compact')
    await expect(stage(page)).toContainText('Skrevet på mobil')
    // The text was the document's; the focused view never was. A reload comes
    // back on the whole slide.
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus', 'slide')

    // And the way back out of the editor still works from the compact bar.
    await backToLibrary(page)
    await expect(page.getByTestId('presentation-card').first()).toContainText('Varig')
  })
})
