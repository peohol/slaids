/**
 * The base test, with Google Fonts served locally.
 *
 * The default theme uses web fonts, and the app deliberately waits for them
 * before it measures anything. A test run that lets those requests reach the
 * network would be slow where the network is fast and stuck where it is not, so
 * every test gets a local face under the requested family name. Cases that care
 * about *when* the font arrives (or that it never does) add their own route on
 * top — routes are consulted newest first, so a later one wins.
 */

import { readFileSync } from 'node:fs'
import { test as base, expect, type Locator, type Page } from '@playwright/test'

const LOCAL_FACE = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'

let cached: string | null = null

function faceData(): string {
  cached ??= readFileSync(LOCAL_FACE).toString('base64')
  return cached
}

/** A `@font-face` for every weight the renderer can ask for. */
export function localFaceCss(family: string): string {
  const data = faceData()
  return [400, 500, 600, 700]
    .map(
      (weight) =>
        `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
        `font-display:swap;src:url(data:font/ttf;base64,${data}) format('truetype');}`,
    )
    .join('\n')
}

/** Families named by a Google Fonts css2 request. */
export function familiesFrom(url: string): string[] {
  return new URL(url).searchParams
    .getAll('family')
    .map((value) => value.split(':')[0].replace(/\+/g, ' '))
}

export const test = base.extend<{ localFonts: void }>({
  localFonts: [
    async ({ page }, use) => {
      await page.route('https://fonts.googleapis.com/**', async (route) => {
        const families = familiesFrom(route.request().url())
        await route.fulfill({
          status: 200,
          contentType: 'text/css',
          body: families.map(localFaceCss).join('\n'),
        })
      })
      // The preconnect carries no data; letting it out would only make the run
      // wait for a host that may not be reachable.
      await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
      await use()
    },
    { auto: true },
  ],
})

export { expect }
export type { Locator, Page }
