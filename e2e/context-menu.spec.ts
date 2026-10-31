/**
 * The right-click menu in zone mode.
 *
 * What a menu offers is unit-tested against the domain commands it asks; what
 * is checked here is what only a browser can say: that the menu is about the
 * thing under the pointer, that choosing from it changes the slide and never
 * the mode, that the keyboard reaches it, that it stays on screen — and that
 * text marked in a field is still marked when the menu opens on it.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  G,
  addContentToZone,
  clickZone,
  enterSubmenu,
  createPresentation,
  enterZoneMode,
  selectionTaken,
  slidePoint,
  splitSelected,
  stage,
  watchForErrors,
  zoneRects,
  type ZoneRect,
} from './helpers'

const menu = (page: Page) => page.getByTestId('context-menu')

async function rightClickAt(page: Page, x: number, y: number): Promise<void> {
  const point = await slidePoint(page, x, y)
  await page.mouse.click(point.x, point.y, { button: 'right' })
}

async function rightClickZone(page: Page, zone: ZoneRect): Promise<void> {
  await rightClickAt(page, zone.x + zone.w / 2, zone.y + zone.h / 2)
}

/** The zones once the slide shows `count` of them: a choice lands on the next render, not at once. */
async function zonesOnceThere(page: Page, count: number): Promise<ZoneRect[]> {
  await expect.poll(async () => (await zoneRects(page)).length).toBe(count)
  return zoneRects(page)
}

async function expectZoneMode(page: Page): Promise<void> {
  await expect(page.getByTestId('mode-zone')).toHaveClass(/btn--active/)
  await expect(page.getByTestId('zone-overlay')).toBeVisible()
}

test.describe('context menu in zone mode', () => {
  test('splits the zone under the pointer, and stays in zone mode', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)

    const [main] = await zoneRects(page)
    await rightClickZone(page, main)
    await expect(menu(page)).toBeVisible()
    await expect(menu(page)).toContainText('Tom sone')

    await page.getByTestId('menu-split').click()
    await page.getByTestId('menu-split-x').click()
    await expect(menu(page)).toBeHidden()

    const zones = await zonesOnceThere(page, 2)
    expect(zones[0].w).toBeCloseTo(zones[1].w, 0)
    await expectZoneMode(page)
    expect(guard.errors).toEqual([])
  })

  test('acts on the zone under the pointer, not the one selected before', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const [left, right] = await zoneRects(page)
    await clickZone(page, left)
    await rightClickZone(page, right)
    await page.getByTestId('menu-duplicate').click()

    const zones = await zonesOnceThere(page, 3)
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(3)
    // The copy sits right after the zone it was made from, and is selected.
    expect(zones[0].id).toBe(left.id)
    expect(zones[1].id).toBe(right.id)
    await expect(page.locator(`[data-node-outline="${zones[2].id}"]`)).toHaveClass(/zone-outline--selected/)
    await expectZoneMode(page)
  })

  test('moves a zone among its siblings with its ratio, from the menu and the keyboard', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 2, 1], 'x')

    const [a, b, c] = await zoneRects(page)
    const order = async (): Promise<string[]> => (await zoneRects(page)).map((zone) => zone.id)
    await rightClickZone(page, b)
    await page.getByTestId('menu-reorder').click()
    await page.getByTestId('menu-reorder-first').click()
    await expect(menu(page)).toBeHidden()

    await expect.poll(order).toEqual([b.id, a.id, c.id])
    const moved = await zoneRects(page)
    // Every zone kept its own width: the wide one is still the wide one.
    expect(moved[0].w).toBeCloseTo(b.w, 0)
    expect(moved[1].w).toBeCloseTo(a.w, 0)
    expect(moved[2].w).toBeCloseTo(c.w, 0)
    await expect(page.locator(`[data-node-outline="${b.id}"]`)).toHaveClass(/zone-outline--selected/)

    // Shift+arrow moves the selected zone one place, and the selection follows it.
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(order).toEqual([a.id, c.id, b.id])
    await expect(page.locator(`[data-node-outline="${b.id}"]`)).toHaveClass(/zone-outline--selected/)

    await page.keyboard.press('Control+z')
    await expect.poll(order).toEqual([a.id, b.id, c.id])
    await expectZoneMode(page)
    expect(guard.errors).toEqual([])
  })

  test('sets a split’s ratio from the gap between its zones', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const [left, right] = await zoneRects(page)
    await rightClickAt(page, left.x + left.w + G / 2, left.y + left.h / 2)
    await expect(menu(page)).toContainText('Delt sone')
    await expect(page.getByTestId('menu-equalize')).toHaveAttribute('data-disabled', '')

    await page.getByTestId('menu-ratios').click()
    await page.getByTestId('menu-ratio-1-2').click()

    await expect
      .poll(async () => {
        const [a, b] = await zoneRects(page)
        return b.w / a.w
      })
      .toBeCloseTo(2, 1)
    const [a, b] = await zoneRects(page)
    expect(a.w + b.w).toBeCloseTo(left.w + right.w, 0)
  })

  test('asks before deleting a zone', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const [, right] = await zoneRects(page)
    await rightClickZone(page, right)
    await page.getByTestId('menu-delete').click()
    const dialog = page.getByTestId('confirm-dialog')
    await expect(dialog).toBeVisible()
    // The question has the focus, not the slide behind it.
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    expect(await zoneRects(page)).toHaveLength(2)
    await page.getByTestId('confirm-accept').click()
    await zonesOnceThere(page, 1)
  })

  test('opens from the keyboard on the selected zone and closes without leaving zone mode', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    const [left] = await zoneRects(page)
    await clickZone(page, left)

    await page.keyboard.press('Shift+F10')
    await expect(menu(page)).toBeVisible()
    await expect(menu(page)).toContainText('Tom sone')
    await expect(page.getByTestId('menu-add-content')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('menu-paste')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu(page)).toBeHidden()
    await expectZoneMode(page)
  })

  test('stays inside the window when opened in its corner', async ({ page }) => {
    await createPresentation(page, 'Hurtigmeny')
    await enterZoneMode(page)
    const [main] = await zoneRects(page)
    await rightClickAt(page, main.x + main.w - 4, main.y + main.h - 4)

    const box = await menu(page).boundingBox()
    const viewport = page.viewportSize()
    if (!box || !viewport) throw new Error('the menu has no box')
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  })
})

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200"><rect width="800" height="200" fill="#4070d0"/></svg>`

/** The first body field on the stage. */
const bodyField = (page: Page) => stage(page).locator('.subfield .ProseMirror').first()

/** Put the focus somewhere that is not the field under test: the slide title. */
async function leaveField(page: Page): Promise<void> {
  await stage(page).getByTestId('slide-title').locator('.ProseMirror').click()
}

async function writeInContainer(page: Page, text: string): Promise<void> {
  const [zone] = await zoneRects(page)
  await addContentToZone(page, zone.id, 'container')
  await bodyField(page).click()
  await page.keyboard.type(text)
}

test.describe('context menu in content mode', () => {
  test('formats text marked in a field being typed in, and offers the same menu elsewhere', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Tekstmeny')
    await writeInContainer(page, 'Første punkt')
    await page.keyboard.press('Shift+Home')
    await selectionTaken(bodyField(page))

    // The text marked is still what the menu acts on.
    await bodyField(page).getByText('Første punkt').click({ button: 'right' })
    await expect(menu(page)).toContainText('Brødtekst')
    await page.getByTestId('menu-formatting').click()
    await page.getByTestId('menu-bold').click()
    await expect(stage(page).locator('.subfield strong')).toHaveText('Første punkt')

    await leaveField(page)
    await bodyField(page).click({ button: 'right' })
    await expect(menu(page)).toContainText('Brødtekst')
    // Opening a menu on some text is not starting to type in it.
    await expect(bodyField(page)).not.toBeFocused()
    await expect(page.getByTestId('menu-formatting')).toHaveAttribute('data-disabled', '')

    await page.getByTestId('menu-paragraph').click()
    await page.getByTestId('menu-bullet').click()
    await expect(stage(page).locator('.subfield ul li')).toHaveText('Første punkt')
    await expect(stage(page).locator('.subfield ul strong')).toHaveText('Første punkt')
    await expect(page.getByTestId('mode-content')).toHaveClass(/btn--active/)
    expect(guard.errors).toEqual([])
  })

  test('formats the selection from the keyboard', async ({ page }) => {
    await createPresentation(page, 'Tekstmeny')
    await writeInContainer(page, 'Fet tekst')
    await page.keyboard.press('Shift+Home')
    await selectionTaken(bodyField(page))

    await page.keyboard.press('Shift+F10')
    await expect(page.getByTestId('menu-formatting')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('menu-bold')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(stage(page).locator('.subfield strong')).toHaveText('Fet tekst')
  })

  test('edits a table from a cell, and asks before deleting it', async ({ page }) => {
    await createPresentation(page, 'Tabellmeny')
    await writeInContainer(page, 'Tabell')
    await leaveField(page)
    await bodyField(page).click({ button: 'right' })
    await page.getByTestId('menu-insert').click()
    await page.getByTestId('menu-table').click()
    const rows = stage(page).locator('.subfield tr')
    await expect(rows).toHaveCount(3)

    await leaveField(page)
    await stage(page).locator('.subfield td').first().click({ button: 'right' })
    await expect(menu(page)).toContainText('Tabell')
    await page.getByTestId('menu-add-row').click()
    await expect(rows).toHaveCount(4)

    await leaveField(page)
    await stage(page).locator('.subfield td').first().click({ button: 'right' })
    await page.getByTestId('menu-del-table').click()
    await page.getByTestId('confirm-accept').click()
    await expect(stage(page).locator('.subfield table')).toHaveCount(0)
  })

  test('acts on the cell right-clicked, not on cells marked elsewhere', async ({ page }) => {
    await createPresentation(page, 'Tabellmeny')
    await writeInContainer(page, 'Tabell')
    await leaveField(page)
    await bodyField(page).click({ button: 'right' })
    await page.getByTestId('menu-insert').click()
    await page.getByTestId('menu-table').click()
    const rows = stage(page).locator('.subfield tr')
    await expect(rows).toHaveCount(3)

    const last = rows.last().locator('td').first()
    await last.click()
    await page.keyboard.type('Siste')
    // Mark the cells of the middle row, then right-click the last row.
    const middle = rows.nth(1).locator('td')
    await middle.first().hover()
    await page.mouse.down()
    await middle.last().hover()
    await page.mouse.up()
    await expect(stage(page).locator('.subfield .selectedCell')).toHaveCount(await middle.count())

    await last.click({ button: 'right' })
    await page.getByTestId('menu-del-row').click()
    await expect(rows).toHaveCount(2)
    await expect(stage(page).locator('.subfield table')).not.toContainText('Siste')
  })

  test('offers a picture, its crop and its caption their own menus', async ({ page }) => {
    await createPresentation(page, 'Bildemeny')
    const [zone] = await zoneRects(page)
    await page.getByTestId('empty-zone-image').click()
    await page.getByTestId('image-modal').getByRole('button', { name: 'Avbryt' }).click()

    // An empty picture asks for a file from the menu, not from the right-press.
    const picture = stage(page).locator('.image-panel')
    await picture.click({ button: 'right' })
    await expect(page.getByTestId('image-modal')).toHaveCount(0)
    await expect(menu(page)).toContainText('Tomt bilde')
    await page.getByTestId('menu-pick-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'bånd.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(stage(page).locator('img.image-panel__img')).toBeVisible()

    await picture.click({ button: 'right' })
    await expect(page.getByTestId('menu-reset-crop')).toHaveAttribute('data-disabled', '')
    await page.getByTestId('menu-caption').click()
    await page.getByTestId('menu-caption-bottom').click()
    await expect(stage(page).locator('.image-caption .tiptap')).toBeFocused()
    await page.keyboard.type('En bildetekst')

    await leaveField(page)
    await stage(page).locator('.image-caption').click({ button: 'right' })
    await expect(menu(page)).toContainText('Bildetekst')
    await page.getByTestId('menu-caption-remove').click()
    await page.getByTestId('confirm-accept').click()
    await expect(stage(page).locator(`.slide-zone[data-node-id="${zone.id}"] .image-caption`)).toHaveCount(0)
  })

  test('sizes and removes a picture in the text', async ({ page }) => {
    await createPresentation(page, 'Bilde i tekst')
    const [zone] = await zoneRects(page)
    await addContentToZone(page, zone.id, 'untitled-card')
    await bodyField(page).click()
    await page.getByTestId('open-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'bilde.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    const picture = stage(page).locator('.rd-image-wrapper')
    await expect(picture).toBeVisible()
    const share = () =>
      picture.evaluate((element) => element.getBoundingClientRect().width / (element.parentElement as HTMLElement).getBoundingClientRect().width)

    // A picture is not words: it gets the app's menu even in the field being typed in.
    await picture.click({ button: 'right' })
    await expect(menu(page)).toContainText('Bilde i teksten')
    await page.getByTestId('menu-image-width').click()
    await enterSubmenu(page, 'image-width')
    await page.getByTestId('menu-image-width-25').focus()
    await page.keyboard.press('Enter')
    await expect.poll(share).toBeCloseTo(0.25, 1)

    await picture.click({ button: 'right' })
    await page.getByTestId('menu-remove-inline-image').click()
    await page.getByTestId('confirm-accept').click()
    await expect(picture).toHaveCount(0)
  })

  test('puts colours picked by hand back to the section’s', async ({ page }) => {
    await createPresentation(page, 'Fargemeny')
    const [zone] = await zoneRects(page)
    await addContentToZone(page, zone.id, 'titled-card')
    const header = stage(page).locator('.card-header')
    const before = await header.evaluate((element) => getComputedStyle(element).backgroundColor)

    await leaveField(page)
    await header.click({ button: 'right' })
    await expect(page.getByTestId('menu-reset-colors')).toHaveAttribute('data-disabled', '')
    await page.getByTestId('menu-card-color').click()
    await page.getByTestId('menu-card-color-content').locator('[data-color]').first().click()
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before)

    await leaveField(page)
    await header.click({ button: 'right' })
    await page.getByTestId('menu-reset-colors').click()
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(before)
  })
})

test.describe('context menu on a section page', () => {
  test('offers a line its text and the page its two colours', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Seksjonsmeny')
    await page.getByTestId('filmstrip-item').first().getByTestId('filmstrip-thumb').click()
    const title = stage(page).locator('[data-section-line="title"] .ProseMirror')
    await expect(title).toBeVisible()

    await title.click({ button: 'right' })
    await expect(menu(page)).toContainText('Overskrift')
    // A section's lines are always centred: there is no alignment to offer.
    await expect(page.getByTestId('menu-alignment')).toHaveCount(0)
    await page.keyboard.press('Escape')

    const background = () =>
      page.evaluate(() => {
        const slide = document.querySelector('[data-testid="stage-slide"] .slide') as HTMLElement
        return getComputedStyle(slide).backgroundColor
      })
    const box = await stage(page).boundingBox()
    if (!box) throw new Error('the stage has no box')
    await page.mouse.click(box.x + 24, box.y + 24, { button: 'right' })
    await expect(menu(page)).toContainText('Forside')
    await page.getByTestId('menu-section-background').click()
    await page.getByTestId('menu-section-background-content').locator('[data-color="#4d4d80"]').click()
    await expect.poll(background).toBe('rgb(77, 77, 128)')
    await page.keyboard.press('Escape')

    // The margin around the page is not the page: no menu of ours there.
    const viewport = await page.locator('.stage-viewport', { has: stage(page) }).boundingBox()
    if (!viewport) throw new Error('the stage has no viewport')
    const margin =
      box.x - viewport.x > box.y - viewport.y
        ? { x: viewport.x + (box.x - viewport.x) / 2, y: box.y + box.height / 2 }
        : { x: box.x + box.width / 2, y: viewport.y + (box.y - viewport.y) / 2 }
    expect(Math.max(box.x - viewport.x, box.y - viewport.y)).toBeGreaterThan(4)
    await page.mouse.click(margin.x, margin.y, { button: 'right' })
    await page.waitForTimeout(200)
    await expect(menu(page)).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })
})
