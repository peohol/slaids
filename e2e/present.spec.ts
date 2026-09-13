import { expect, test, type Page } from './fixtures'
import {
  PROGRESS_HEIGHT,
  SLIDE_WIDTH,
  addContentToZone,
  createPresentation,
  presentedPage,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

/**
 * The progress indicator on the page currently being presented, measured in
 * logical slide pixels against the slide it is drawn on.
 */
async function progressBar(page: Page): Promise<{
  present: boolean
  left: number
  right: number
  bottom: number
  height: number
  fillWidth: number
  transition: string
} | null> {
  return page.evaluate(() => {
    const slide = document.querySelector('[data-testid="present-view"] .slide') as HTMLElement
    if (!slide) return null
    const slideBox = slide.getBoundingClientRect()
    const scale = slideBox.width / 1600
    // The indicator belongs to the page rather than to the slide, so it hangs
    // in the page box beside it — see `DeckPageView`. Measured against the
    // slide all the same: that is the box it has to be flush with.
    const host = slide.closest('.deck-page') ?? slide
    const bar = host.querySelector('[data-testid="slide-progress"]') as HTMLElement | null
    if (!bar) {
      return { present: false, left: 0, right: 0, bottom: 0, height: 0, fillWidth: 0, transition: '' }
    }
    const box = bar.getBoundingClientRect()
    const fill = host.querySelector('[data-testid="slide-progress-fill"]') as HTMLElement
    return {
      present: true,
      left: (box.left - slideBox.left) / scale,
      right: (slideBox.right - box.right) / scale,
      bottom: (slideBox.bottom - box.bottom) / scale,
      height: box.height / scale,
      fillWidth: fill.getBoundingClientRect().width / scale,
      transition: `${getComputedStyle(fill).transitionProperty} ${getComputedStyle(fill).transitionDuration} ${getComputedStyle(fill).transitionTimingFunction}`,
    }
  })
}

test.describe('presentation mode', () => {
  test('navigates slides with the keyboard and exits with Escape', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Visning')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    // Three slides, and the mandatory cover in front of them: four pages.
    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toBeVisible()
    await expect.poll(() => presentedPage(page)).toEqual({ index: 4, count: 4 })

    await page.keyboard.press('Home')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 1, count: 4 })
    await expect(page.getByTestId('present-view')).toContainText('Visning')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 2, count: 4 })
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 1, count: 4 })
    await page.keyboard.press('End')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 4, count: 4 })

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    expect(guard.errors).toEqual([])
  })

  test('returns to the last slide shown, not the one presenting started from', async ({ page }) => {
    await createPresentation(page, 'Tilbake til riktig slide')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    // Select the cover before presenting, so leaving would return there if the
    // editor's prior selection were used instead of where presenting left off.
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('filmstrip-item').first()).toHaveClass(/filmstrip__item--active/)

    await page.getByTestId('present').click()
    await expect.poll(() => presentedPage(page)).toEqual({ index: 1, count: 4 })
    await page.keyboard.press('End')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 4, count: 4 })

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('filmstrip-item').last()).toHaveClass(/filmstrip__item--active/)
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

  /*
   * A slide's text is ordinary selectable text — an audience copies a quotation
   * out of a deck, a presenter highlights a line while talking — and the
   * mouse-up that finishes such a drag arrives as a click on the page. Turning
   * the page on it would take the selection away in the same motion that made
   * it, which is what § 44.5.7 means by «valgbar tekst tolkes aldri som
   * navigasjon».
   */
  test('selecting text with the mouse does not turn the page', async ({ page }) => {
    await createPresentation(page, 'Markering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('En setning som kan markeres med musen')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toBeVisible()
    const before = await presentedPage(page)

    const text = page.getByTestId('present-view').locator('.subfield .rd-p').first()
    const box = await text.boundingBox()
    if (!box) throw new Error('Fant ikke teksten på siden.')
    // A drag across the line, which is how a selection is made.
    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()

    expect(await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim())).not.toBe('')
    expect(await presentedPage(page)).toEqual(before)

    // And an ordinary click still turns the page: the selection collapses
    // before the event is dispatched, so nothing was taken away from it.
    await page.getByTestId('present-view').click({ position: { x: 5, y: 5 } })
    await expect
      .poll(async () => (await presentedPage(page)).index)
      .toBe(before.index + 1)
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

    // Cover, the authored slide, then the derived reference slide.
    await page.getByTestId('present').click()
    await expect.poll(() => presentedPage(page)).toEqual({ index: 2, count: 3 })
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 3, count: 3 })
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
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)

    await page.getByTestId('filmstrip-derived').getByRole('button').first().click()
    await expect(page.getByTestId('stage-slide')).toHaveAttribute('data-readonly', '')

    // Away to another slide, then back to the one the derived view was opened
    // from: it must stay closed rather than reappear.
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('stage-slide')).not.toHaveAttribute('data-readonly', '')
    await page.getByTestId('filmstrip-item').nth(2).getByTestId('filmstrip-thumb').click()
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
    // Past the cover: the link is on the first authored slide.
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 2, count: 3 })

    const link = page.getByTestId('present-view').locator('a').first()
    await expect(link).toBeVisible()
    const popup = page.context().waitForEvent('page').catch(() => null)
    await link.click()
    // The click belonged to the link, not to the deck.
    await expect.poll(() => presentedPage(page)).toEqual({ index: 2, count: 3 })
    const opened = await popup
    if (opened) await opened.close()

    // A click on the slide itself still advances.
    await page.getByTestId('present-view').click({ position: { x: 5, y: 5 } })
    await expect.poll(() => presentedPage(page)).toEqual({ index: 3, count: 3 })
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

  test('draws a progress indicator on every page but the cover', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Fremdrift')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    await page.getByTestId('present').click()
    await page.keyboard.press('Home')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 1, count: 4 })
    // The cover is the way in to the deck, not a step through it.
    expect((await progressBar(page))?.present).toBe(false)

    // Three slides after the cover, so the first of them is one third of the way.
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 2, count: 4 })
    const first = await progressBar(page)
    expect(first?.present).toBe(true)
    // Flush with the bottom and with both sides; only the gap above it is air.
    expect(first?.left).toBeCloseTo(0, 0)
    expect(first?.right).toBeCloseTo(0, 0)
    expect(first?.bottom).toBeCloseTo(0, 0)
    expect(first?.height).toBeCloseTo(PROGRESS_HEIGHT, 0)
    expect(first?.fillWidth).toBeCloseTo(SLIDE_WIDTH / 3, 0)
    expect(first?.transition).toBe('width 0.6s ease-in-out')

    await page.keyboard.press('End')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 4, count: 4 })
    // Polled rather than read once: the fill moves to its new position instead
    // of jumping there, so right after a page turn it is still on its way.
    expect((await progressBar(page))?.fillWidth).toBeLessThan(SLIDE_WIDTH)
    // The last page is the end of the deck, whatever kind of page it is.
    await expect
      .poll(async () => (await progressBar(page))?.fillWidth)
      .toBeCloseTo(SLIDE_WIDTH, 0)

    await page.keyboard.press('Escape')
    expect(guard.errors).toEqual([])
  })
})
