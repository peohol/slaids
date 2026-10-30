/**
 * The desktop's main toolbar (docs/UX_BASELINE.md § 4.1).
 *
 * What is checked here is what only a browser can tell: that the bar fits the
 * window at the widths people actually use, and that its menus open, choose
 * and close from the mouse, the keyboard and a finger alike. What the menus
 * hold is checked where it is built (`toolbarMenus.test.ts`,
 * `contentKinds.test.ts`); that each tool still works is checked by the specs
 * that use it, through `chooseFromToolbarMenu`.
 */

import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { addContentToZone, createPresentation, waitForSaved, watchForErrors, zoneRects } from './helpers'

/** A presentation whose first zone holds an untitled card, selected. */
async function withSelectedCard(page: Page, title: string): Promise<void> {
  await createPresentation(page, title)
  const [first] = await zoneRects(page)
  await addContentToZone(page, first.id, 'untitled-card')
  await expect(kindButton(page)).toBeEnabled()
}

const kindButton = (page: Page) => page.getByTestId('toolbar-menu-content-kind')
const kindShown = (page: Page) => kindButton(page).locator('[data-kind]')
const menu = (page: Page) => page.getByTestId('context-menu')

test.describe('the toolbar fits the window', () => {
  // Laptop widths where the old bar pushed «Del» and «Vis» off screen.
  for (const width of [1025, 1180, 1366]) {
    test(`at ${width} px nothing leaves the window`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await withSelectedCard(page, 'Kvartalsrapport for tredje kvartal 2026')

      const bar = page.getByTestId('top-toolbar')
      const overflow = await bar.evaluate((element) => element.scrollWidth - element.clientWidth)
      expect(overflow).toBe(0)

      const controls = bar.locator('button')
      const count = await controls.count()
      expect(count).toBeGreaterThan(0)
      for (let index = 0; index < count; index += 1) {
        const box = await controls.nth(index).boundingBox()
        expect(box, `button ${index}`).not.toBeNull()
        expect(box!.x, `button ${index}`).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width, `button ${index}`).toBeLessThanOrEqual(width)
      }
      // Sharing and presenting are always in reach, by name.
      await expect(page.getByTestId('present')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('toggle-share')).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: 'Vis' })).toBeVisible()
    })
  }
})

test.describe('content kind', () => {
  test('names the kind in force, and changes it from its menu', async ({ page }) => {
    const guard = watchForErrors(page)
    await withSelectedCard(page, 'Innholdstype')
    await expect(kindShown(page)).toHaveAttribute('data-kind', 'untitled-card')

    await kindButton(page).click()
    await expect(kindButton(page)).toHaveAttribute('aria-expanded', 'true')
    // The kind in force is the checked entry, and there is exactly one.
    await expect(menu(page).getByRole('menuitemcheckbox', { checked: true })).toHaveCount(1)
    await expect(menu(page).getByTestId('menu-kind-untitled-card')).toHaveAttribute('aria-checked', 'true')

    await menu(page).getByTestId('menu-kind-titled-card').click()
    await expect(menu(page)).toBeHidden()
    await expect(kindShown(page)).toHaveAttribute('data-kind', 'titled-card')
    await expect(kindButton(page)).toHaveAttribute('aria-expanded', 'false')
    await waitForSaved(page)
    expect(guard.errors).toEqual([])
  })

  test('works from the keyboard, and gives the focus back', async ({ page }) => {
    await withSelectedCard(page, 'Tastatur')
    await kindButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(menu(page)).toBeVisible()
    // The first entry has the focus at once, so the arrows work straight away.
    await expect(menu(page).locator('[role^="menuitem"]').first()).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu(page)).toBeHidden()
    await expect(kindButton(page)).toBeFocused()

    await page.keyboard.press('Space')
    await expect(menu(page)).toBeVisible()
    await menu(page).getByTestId('menu-kind-titled-card').focus()
    await page.keyboard.press('Enter')
    await expect(kindShown(page)).toHaveAttribute('data-kind', 'titled-card')
  })

  test('a second press closes the menu it opened', async ({ page }) => {
    await withSelectedCard(page, 'Av og på')
    await kindButton(page).click()
    await expect(menu(page)).toBeVisible()
    await kindButton(page).click()
    await expect(menu(page)).toBeHidden()
    await expect(kindButton(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('the picture file is its own action, not a kind', async ({ page }) => {
    await withSelectedCard(page, 'Bildefil')
    await page.getByTestId('open-image').click()
    await expect(page.getByTestId('image-modal')).toBeVisible()
    await expect(page.getByTestId('context-menu')).toHaveCount(0)
    // Choosing a file to put in the card leaves it a card.
    await expect(kindShown(page)).toHaveAttribute('data-kind', 'untitled-card')
  })
})

test.describe('presentation and tools menus', () => {
  test('hold the presentation tools, and the helpers with their state', async ({ page }) => {
    await createPresentation(page, 'Menyer')

    await page.getByTestId('toolbar-menu-presentation').click()
    for (const id of ['menu-rename', 'open-theme', 'open-templates', 'open-references', 'open-image-brief', 'optimize-images']) {
      await expect(menu(page).getByTestId(id)).toBeVisible()
    }
    await menu(page).getByTestId('open-theme').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.getByTestId('toolbar-menu-tools').click()
    await expect(menu(page).getByTestId('open-ideas')).toHaveAttribute('aria-checked', 'false')
    await menu(page).getByTestId('open-ideas').click()
    await expect(page.getByTestId('ideas-window')).toBeVisible()
    await page.getByTestId('toolbar-menu-tools').click()
    await expect(menu(page).getByTestId('open-ideas')).toHaveAttribute('aria-checked', 'true')
    await menu(page).getByTestId('menu-shortcuts').click()
    await expect(page.getByRole('dialog', { name: 'Hurtigtaster' })).toBeVisible()
  })

  test('keep the keyboard shortcuts working beside them', async ({ page }) => {
    await createPresentation(page, 'Snarveier')
    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('mode-zone')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('mode-content')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true })

  test('a tap opens a menu and a tap chooses from it', async ({ page }) => {
    await withSelectedCard(page, 'Berøring')
    await kindButton(page).tap()
    await expect(menu(page)).toBeVisible()
    await menu(page).getByTestId('menu-kind-titled-card').tap()
    await expect(kindShown(page)).toHaveAttribute('data-kind', 'titled-card')

    await page.getByTestId('toolbar-menu-tools').tap()
    await menu(page).getByTestId('open-ideas').tap()
    await expect(page.getByTestId('ideas-window')).toBeVisible()
  })
})
