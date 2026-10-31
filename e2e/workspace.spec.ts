/**
 * Crossing between the two workspaces.
 *
 * Every other suite stays on one side of the compact threshold: the phone
 * projects are compact whichever way they are turned, and the desktop project
 * is roomy. This is the one that goes back and forth, which is what a tablet
 * does — an 11-inch tablet is 1180 × 820 on its side and 820 × 1180 upright,
 * and those fall on opposite sides of the line.
 *
 * Crossing it rebuilds the layout by design: the two shells are different
 * arrangements, and exactly one is ever mounted. What must survive the rebuild
 * is everything that is *not* layout — the deck, the selection, the history,
 * and the choices the user made about which surface to work on.
 */

import { expect, test, type Page } from './fixtures'
import { createPresentation, stage } from './helpers'
import { openPanel } from './compactHelpers'

/** A tablet on its side: roomy enough for the three-column editor. */
const TABLET_LANDSCAPE = { width: 1180, height: 820 }
/** The same tablet upright: narrower than the threshold, so compact. */
const TABLET_PORTRAIT = { width: 820, height: 1180 }

async function shell(page: Page): Promise<string | null> {
  return page.getAttribute('[data-testid="editor"]', 'data-shell')
}

async function turn(
  page: Page,
  size: { width: number; height: number },
  expected: string,
): Promise<void> {
  await page.setViewportSize(size)
  await expect(page.getByTestId('editor')).toHaveAttribute('data-shell', expected)
  await page.waitForTimeout(150)
}

test.describe('workspace transitions', () => {
  test('rotating across the threshold keeps the work and the choices', async ({ page }) => {
    await page.setViewportSize(TABLET_LANDSCAPE)
    await createPresentation(page, 'Nettbrett')
    expect(await shell(page)).toBe('desktop')

    // Something to lose: a second slide, content, typed text and a split.
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.locator('[data-testid="empty-zone-untitled-card"]').first().click()
    await stage(page).locator('.subfield .tiptap').first().click({ position: { x: 4, y: 4 } })
    await page.keyboard.insertText('Skrevet før rotasjon')
    await expect(stage(page)).toContainText('Skrevet før rotasjon')

    await page.getByTestId('mode-zone').click()
    await page.getByTestId('inspector-action-split').click()
    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 1')

    const slidesBefore = await page.getByTestId('filmstrip-item').count()
    const zoneBefore = await page.getByTestId('inspector-breadcrumb').textContent()

    // Upright: the compact workspace. Choose a surface to work on.
    await turn(page, TABLET_PORTRAIT, 'compact')
    await openPanel(page, 'slides')
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(slidesBefore)

    /*
     * There and back. The shell is rebuilt twice over — which is exactly when
     * anything the shell itself was holding would quietly disappear.
     */
    await turn(page, TABLET_LANDSCAPE, 'desktop')
    await turn(page, TABLET_PORTRAIT, 'compact')

    // The surface the user chose is still the one open.
    await expect(page.getByTestId('compact-panel')).toHaveAttribute('data-panel', 'slides')
    await expect(page.getByTestId('compact-tab-slides')).toHaveAttribute('aria-pressed', 'true')

    // The deck, the text and the selected zone came through untouched.
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(slidesBefore)
    await expect(stage(page)).toContainText('Skrevet før rotasjon')
    await openPanel(page, 'zone')
    await expect(page.getByTestId('inspector-breadcrumb')).toHaveText(zoneBefore ?? '')
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 1')

    // And the history: the split can still be stepped back, then forward.
    await page.getByTestId('undo').click()
    await expect(page.getByTestId('zone-ratios')).toHaveCount(0)
    await page.getByTestId('redo').click()
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 1')

    // Back on the roomy side, the three columns are there as before.
    await turn(page, TABLET_LANDSCAPE, 'desktop')
    await expect(page.getByTestId('filmstrip')).toBeVisible()
    await expect(page.getByTestId('inspector')).toBeVisible()
    await expect(stage(page)).toContainText('Skrevet før rotasjon')
  })

  test('the editing mode, an unsaved edit and the history cross with the window', { tag: '@pr' }, async ({
    page,
  }) => {
    await page.setViewportSize(TABLET_LANDSCAPE)
    await createPresentation(page, 'Modus over terskelen')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.locator('[data-testid="empty-zone-untitled-card"]').first().click()

    // Zone mode on the desktop is the zone panel on the compact workspace —
    // the mode chosen is kept, and so is what it is about.
    await page.getByTestId('mode-zone').click()
    const zoneBefore = await page.getByTestId('inspector-breadcrumb').textContent()
    await turn(page, TABLET_PORTRAIT, 'compact')
    await expect(page.getByTestId('editor')).toHaveAttribute('data-mode', 'zone')
    await expect(page.getByTestId('compact-panel')).toHaveAttribute('data-panel', 'zone')
    await expect(page.getByTestId('compact-tab-zone')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('inspector-breadcrumb')).toHaveText(zoneBefore ?? '')

    // Leaving the zone panel is leaving zone mode, and the desktop agrees.
    await page.getByTestId('compact-panel-close').click()
    await turn(page, TABLET_LANDSCAPE, 'desktop')
    await expect(page.getByTestId('mode-content')).toHaveAttribute('aria-pressed', 'true')

    // An edit made the moment before the window changes — before autosave has
    // had its turn — is still there on the other side, and still undoable.
    await stage(page).locator('.subfield .tiptap').first().click({ position: { x: 4, y: 4 } })
    await page.keyboard.insertText('Rett før')
    await turn(page, TABLET_PORTRAIT, 'compact')
    await expect(stage(page)).toContainText('Rett før')
    await turn(page, TABLET_LANDSCAPE, 'desktop')
    await expect(stage(page)).toContainText('Rett før')
    await page.getByTestId('undo').click()
    await expect(stage(page)).not.toContainText('Rett før')
  })
})
