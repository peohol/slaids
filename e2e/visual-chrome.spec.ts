import { expect, test, type Locator, type Page } from './fixtures'
import {
  addContentToZone,
  backToLibrary,
  createPresentation,
  enterZoneMode,
  openSlideMenu,
  stage,
  waitForSaved,
  zoneRects,
} from './helpers'
import { openPanel, type CompactPanel } from './compactHelpers'

/**
 * Visual regression of the app's own interface — the chrome, not the slide.
 *
 * `visual.spec.ts` guards what the audience sees; this guards what the author
 * works in: the library, the main toolbar, the inspector, the text toolbar,
 * the menus, the compact tabs and panels, in their selected, unavailable and
 * mode states, at the widths the UX plan names (UX_BASELINE.md). Each picture
 * is of one surface where that is enough, so a change to one surface fails
 * one expectation rather than every full-page shot at once.
 *
 * Pixel baselines only mean something in a fixed environment, so like
 * `visual.spec.ts` this is opt-in: `SLAIDS_VISUAL=1 npm run e2e -- visual`,
 * and `-- --update-snapshots` after an intended change. The baselines in
 * `visual-chrome.spec.ts-snapshots/` were made in Linux Chromium with the
 * suite's local fonts (`fixtures.ts`).
 */

const SHOT = { maxDiffPixelRatio: 0.01 } as const

/** Park the pointer where nothing reacts to it, so no hover state is in the picture. */
async function rest(page: Page): Promise<void> {
  const size = page.viewportSize()
  if (size) await page.mouse.move(size.width - 2, size.height - 2)
}

async function shoot(page: Page, target: Locator, name: string, mask: Locator[] = []) {
  await rest(page)
  await expect(target).toHaveScreenshot(name, { ...SHOT, mask })
}

/** A deck with a titled card on the first slide, saved, as most shots start from. */
async function deckWithCard(page: Page, title = 'Kvartalsrapport'): Promise<string> {
  await createPresentation(page, title)
  const [zone] = await zoneRects(page)
  await addContentToZone(page, zone.id, 'titled-card')
  await stage(page).locator('.card-header .tiptap').click()
  await page.keyboard.type('Resultater')
  await stage(page).locator('.subfield .tiptap').first().click()
  await page.keyboard.type('Omsetningen økte i alle regioner.')
  await waitForSaved(page)
  return zone.id
}

test.describe('app-chromen, visuelt', () => {
  test.skip(!process.env.SLAIDS_VISUAL, 'Set SLAIDS_VISUAL=1 to run visual regression.')

  test.describe('desktop 1600 × 1000', () => {
    test('biblioteket', async ({ page }) => {
      await deckWithCard(page)
      await backToLibrary(page)
      page.once('dialog', (dialog) => void dialog.accept('Kunder'))
      await page.getByTestId('new-folder').click()
      await expect(page.getByTestId('folder-item')).toHaveCount(1)
      // The date on a card is the run's own; everything around it is not.
      await shoot(page, page.locator('body'), 'library-1600.png', [
        page.locator('.presentation-card__meta'),
      ])
    })

    test('hovedlinjen, inspektøren og stripen i innholdsmodus', async ({ page }) => {
      await deckWithCard(page)
      await shoot(page, page.getByTestId('top-toolbar'), 'toolbar-content-1600.png')
      await shoot(page, page.getByTestId('inspector'), 'inspector-card-1600.png')
      await shoot(page, page.getByTestId('filmstrip'), 'filmstrip-1600.png')
    })

    test('tekstlinjen med aktiv formatering', async ({ page }) => {
      await deckWithCard(page)
      await page.keyboard.press('Control+a')
      await page.getByTestId('format-bold').click()
      await expect(page.getByTestId('format-bold')).toHaveAttribute('aria-pressed', 'true')
      await shoot(page, page.getByTestId('text-toolbar'), 'text-toolbar-1600.png')
    })

    test('sonemodus', async ({ page }) => {
      await deckWithCard(page)
      await enterZoneMode(page)
      await shoot(page, page.getByTestId('top-toolbar'), 'toolbar-zone-1600.png')
      await shoot(page, page.getByTestId('inspector'), 'inspector-zone-1600.png')
    })

    test('menyene', async ({ page }) => {
      await deckWithCard(page)
      const menu = page.getByTestId('context-menu')
      await page.getByTestId('toolbar-menu-presentation').click()
      await shoot(page, menu, 'menu-presentation.png')
      await page.keyboard.press('Escape')
      await page.getByTestId('toolbar-menu-content-kind').click()
      await shoot(page, menu, 'menu-content-kind.png')
      await page.keyboard.press('Escape')
      await openSlideMenu(page, 0)
      // The front page: «Flytt opp» and «Slett» unavailable, with their reasons.
      await shoot(page, menu, 'menu-slide-front-page.png')
    })

    test('forsiden, der sonehandlingene er utilgjengelige', async ({ page }) => {
      await deckWithCard(page)
      await page.getByTestId('filmstrip-thumb').first().click()
      await expect(page.getByTestId('mode-zone')).toBeDisabled()
      await shoot(page, page.getByTestId('top-toolbar'), 'toolbar-front-page-1600.png')
      await shoot(page, page.getByTestId('inspector'), 'inspector-front-page-1600.png')
    })
  })

  for (const { width, height } of [
    { width: 1366, height: 768 },
    { width: 1025, height: 768 },
  ]) {
    test.describe(`smal desktop ${width} × ${height}`, () => {
      test.use({ viewport: { width, height } })

      test('hovedlinjen og tekstlinjen', async ({ page }) => {
        await deckWithCard(page)
        await shoot(page, page.getByTestId('top-toolbar'), `toolbar-content-${width}.png`)
        await shoot(page, page.getByTestId('text-toolbar'), `text-toolbar-${width}.png`)
      })
    })
  }

  test.describe('stort nettbrett med berøring, 1180 × 820', () => {
    test.use({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true })

    test('editoren med fingerstore kontroller', async ({ page }) => {
      await createPresentation(page, 'Nettbrett')
      await waitForSaved(page)
      await shoot(page, page.locator('body'), 'tablet-1180-editor.png')
    })
  })

  for (const { width, height, panels } of [
    { width: 412, height: 892, panels: ['slides', 'content', 'zone', 'tools'] as CompactPanel[] },
    { width: 892, height: 412, panels: ['zone', 'tools'] as CompactPanel[] },
  ]) {
    test.describe(`telefon ${width} × ${height}`, () => {
      test.use({ viewport: { width, height }, isMobile: true, hasTouch: true })

      test('scenen og panelene', async ({ page }) => {
        await createPresentation(page, 'Telefon')
        await waitForSaved(page)
        await shoot(page, page.locator('body'), `phone-${width}x${height}-stage.png`)
        for (const panel of panels) {
          await openPanel(page, panel)
          await shoot(page, page.locator('body'), `phone-${width}x${height}-${panel}.png`)
        }
      })
    })
  }
})
