/**
 * Nothing leaves the window, at every width the UX plan names.
 *
 * Each surface has its own fit test where it is built — the main toolbar
 * (`toolbar.spec.ts`), the text toolbar (`text-toolbar.spec.ts`), the compact
 * shell and its sheets (`compact.spec.ts`), turning a tablet
 * (`workspace.spec.ts`). This is the one check across all of them together:
 * the library and the editor, in each mode, at desktop, narrow desktop, a
 * large touch screen, a narrow mouse window and a phone either way up, scroll
 * only where something is meant to scroll — never the page sideways — and
 * keep «Vis» and the way back in reach.
 */

import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import {
  addContentToZone,
  backToLibrary,
  createPresentation,
  enterZoneMode,
  stage,
  zoneRects,
} from './helpers'
import { closePanel, isCompact, openPanel, type CompactPanel } from './compactHelpers'

const PANELS: CompactPanel[] = ['slides', 'content', 'zone', 'tools']

const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 1000, touch: false },
  { name: 'smal desktop', width: 1366, height: 768, touch: false },
  { name: 'smal desktop', width: 1025, height: 768, touch: false },
  { name: 'stor berøringsskjerm', width: 1180, height: 820, touch: true },
  { name: 'smalt vindu med mus', width: 900, height: 760, touch: false },
  { name: 'telefon stående', width: 412, height: 892, touch: true },
  { name: 'telefon liggende', width: 892, height: 412, touch: true },
] as const

/** How far the page itself can be scrolled sideways — always 0. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement
    return Math.max(root.scrollWidth, document.body.scrollWidth) - window.innerWidth
  })

for (const { name, width, height, touch } of VIEWPORTS) {
  test.describe(`${name} ${width} × ${height}`, () => {
    test.use({ viewport: { width, height }, isMobile: touch, hasTouch: touch })

    test('biblioteket og editoren i alle modi og paneler uten sideveis rulling', async ({ page }) => {
      await createPresentation(page, 'Kvartalsrapport for tredje kvartal 2026')
      await expect(page.getByTestId('back-to-library')).toBeInViewport({ ratio: 1 })

      if (await isCompact(page)) {
        expect(await sideways(page), 'scenen').toBe(0)
        // «Vis» sits in the compact top bar, above whichever panel is open.
        for (const panel of PANELS) {
          await openPanel(page, panel)
          expect(await sideways(page), `panelet ${panel}`).toBe(0)
          await expect(page.getByTestId('present')).toBeInViewport({ ratio: 1 })
        }
        await closePanel(page)
      } else {
        const [zone] = await zoneRects(page)
        await addContentToZone(page, zone.id, 'titled-card')
        await stage(page).locator('.subfield .tiptap').first().click()
        await page.keyboard.type('Omsetningen økte i alle regioner.')
        await expect(page.getByTestId('text-toolbar')).toBeVisible()
        expect(await sideways(page), 'innholdsmodus med tekstfokus').toBe(0)
        await expect(page.getByTestId('present')).toBeInViewport({ ratio: 1 })

        await enterZoneMode(page)
        expect(await sideways(page), 'sonemodus').toBe(0)
        await expect(page.getByTestId('present')).toBeInViewport({ ratio: 1 })
      }

      await backToLibrary(page)
      expect(await sideways(page), 'biblioteket').toBe(0)
      await expect(page.getByTestId('new-presentation')).toBeInViewport({ ratio: 1 })
    })
  })
}
