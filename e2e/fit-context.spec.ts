/**
 * Browser tests for the state a fit measurement is made *against*.
 *
 * Three things above a single zone decide what it renders — the typography, the
 * derived citation numbers, and (for a restored title) the zone itself. Each of
 * these used to be measured in a state that differed from the one the user
 * ends up looking at, which is exactly how content gets clipped despite a gate
 * that says it fits.
 *
 * The web font cases route Google Fonts to a local face, so what is proved is
 * ordering and metrics, not network luck.
 */

import { readFileSync } from 'node:fs'
import { expect, familiesFrom, localFaceCss, test, type Page } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  fillZoneToCapacity,
  renderedBodyFont,
  renderedHeadingFont,
  stage,
  toast,
  topUpToCapacity,
  worstOverflow,
  zoneRects,
} from './helpers'

/* ------------------------------------------------------------------ *
 * A local stand-in for a Google font
 * ------------------------------------------------------------------ */

/**
 * A monospace face served under the name of a web font.
 *
 * Every glyph is wider than the proportional fallback the stack would use, so
 * a measurement taken before the face arrives and one taken after do not just
 * differ by a rounding error — they give opposite answers. That is what makes
 * the ordering observable instead of assumed.
 */
const WIDE_FACE = readFileSync('/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf')

/**
 * A monospace face, served under the name of the font a test is switching *to*.
 *
 * Every other family — including the deck's defaults — keeps the proportional
 * face the shared fixture serves, so the two measurements a test compares are
 * genuinely different: one before the wide face exists, one after. Serving mono
 * for everything would make them identical and the test vacuous.
 */
function wideFaceCss(family: string): string {
  const data = WIDE_FACE.toString('base64')
  return [400, 500, 600, 700]
    .map(
      (weight) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
        `font-display:swap;src:url(data:font/ttf;base64,${data}) format('truetype');}`,
    )
    .join('\n')
}

interface FontRoute {
  /** Let a held-back stylesheet response through. */
  release: () => void
  /** How many stylesheet requests the page has made. */
  requests: () => number
}

/**
 * Serve Google Fonts locally, with `wideFor` arriving as the monospace face.
 *
 * `hold` keeps the response back until `release()` is called, which is how a
 * test can look at the app while the font is still on its way.
 */
async function routeFonts(
  page: Page,
  options: { hold?: boolean; fail?: boolean; wideFor?: string } = {},
): Promise<FontRoute> {
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let requests = 0

  await page.route('https://fonts.googleapis.com/**', async (route) => {
    requests += 1
    if (options.hold) await held
    if (options.fail) {
      await route.abort('failed')
      return
    }
    const families = familiesFrom(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: families
        .map((family) => (family === options.wideFor ? wideFaceCss(family) : localFaceCss(family)))
        .join('\n'),
    })
  })
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())

  return { release, requests: () => requests }
}

test.describe('fit measurement and web fonts', () => {
  test('judges a font change by the web font, not by the fallback', async ({ page }) => {
    await routeFonts(page, { wideFor: 'Inter' })
    await createPresentation(page, 'Fontmåling')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id)

    const before = await renderedBodyFont(page)
    await page.getByTestId('open-theme').click()
    // Inter's fallback is the system font the zone was just filled with, so a
    // measurement taken before the face loads would accept this. The face that
    // actually arrives is monospace and far too wide.
    await page.getByTestId('theme-body-font').selectOption({ label: 'Inter' })

    await expect(toast(page, 'Denne fonten')).toBeVisible()
    expect(await renderedBodyFont(page)).toBe(before)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('waits for the font before committing anything', async ({ page }) => {
    const route = await routeFonts(page, { hold: true })
    await createPresentation(page, 'Fontventing')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).first()
    await field.click()
    await page.keyboard.insertText('Kort.')

    const before = await renderedBodyFont(page)
    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-body-font').selectOption({ label: 'Inter' })

    // While the stylesheet is held back the app says so and changes nothing.
    await expect(page.getByTestId('font-loading')).toBeVisible()
    await expect(page.getByTestId('theme-body-font')).toBeDisabled()
    expect(await renderedBodyFont(page)).toBe(before)
    expect(route.requests()).toBeGreaterThan(0)

    route.release()
    await expect(page.getByTestId('font-loading')).toBeHidden()
    await expect.poll(() => renderedBodyFont(page)).toContain('Inter')
  })

  test('refuses a font it could not load instead of measuring the fallback', async ({ page }) => {
    await routeFonts(page, { fail: true })
    await createPresentation(page, 'Fontfeil')
    const before = await renderedBodyFont(page)

    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-body-font').selectOption({ label: 'Inter' })

    await expect(toast(page, 'kunne ikke lastes')).toBeVisible()
    expect(await renderedBodyFont(page)).toBe(before)
    await expect(page.getByTestId('theme-body-font')).toBeEnabled()
  })

  test('notices content that stops fitting when a web font swaps in', async ({ page }) => {
    // A deck that already uses a web font renders with the fallback first and
    // swaps when the real face arrives. No command can be blamed for that, and
    // nothing can be rolled back — but it must not pass unnoticed.
    const route = await routeFonts(page, { hold: true, wideFor: 'Inter' })
    await page.goto('/')
    await page.getByTestId('new-presentation').click()
    await page.getByTestId('presentation-title-input').fill('Fontbytte')
    await page.getByTestId('body-font-select').selectOption({ label: 'Inter' })
    await page.getByTestId('create-presentation').click()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('editor')).toHaveAttribute('data-fonts', 'pending')

    // Filled while the browser is still drawing the fallback.
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)

    route.release()
    await expect(page.getByTestId('editor')).toHaveAttribute('data-fonts', 'ready')
    await expect(toast(page, 'etter at fonten ble lastet ferdig')).toBeVisible({ timeout: 15_000 })
  })
})

/* ------------------------------------------------------------------ *
 * Restoring a title
 * ------------------------------------------------------------------ */

test.describe('restoring a slide title', () => {
  /**
   * Type into the title until the editor stops accepting more, so the zone is
   * as full as it can be for the font in force — the only starting point from
   * which "a wider font no longer fits" means anything.
   */
  async function fillTitleToCapacity(page: Page): Promise<string> {
    const editor = stage(page).locator('[data-testid="slide-title"] .tiptap')
    await editor.click()
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.insertText('overskriftstekst ')
    }
    await topUpToCapacity(page, editor)
    return (await editor.innerText()).trim()
  }

  async function removeTitle(page: Page): Promise<void> {
    await page.getByTestId('toggle-title').click()
    await page.getByTestId('confirm-accept').click()
    await expect(stage(page).locator('[data-testid="slide-title"]')).toHaveCount(0)
  }

  test('refuses a heading font that pushes the title out of its zone', async ({ page }) => {
    // The offscreen title measurement is the only thing standing between a
    // global font change and a clipped title: the live editor guard never runs
    // for a change nobody typed.
    await createPresentation(page, 'Tittelfont')
    await fillTitleToCapacity(page)

    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-heading-font').selectOption({ label: 'Consolas' })
    await expect(toast(page, 'Denne fonten')).toBeVisible()
    expect(await renderedHeadingFont(page)).not.toContain('Consolas')

    const overflow = await page.evaluate(() => {
      const element = document.querySelector(
        '[data-testid="stage-slide"] .slide-title',
      ) as HTMLElement
      return element.scrollWidth - element.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('refuses a remembered title that no longer fits, and keeps it', async ({ page }) => {
    await createPresentation(page, 'Tittelgjenoppretting')
    const title = await fillTitleToCapacity(page)
    expect(title.length).toBeGreaterThan(20)

    await removeTitle(page)

    // With the zone gone there is nothing to object, so this is allowed.
    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-heading-font').selectOption({ label: 'Consolas' })
    await expect.poll(() => renderedHeadingFont(page)).toContain('Consolas')
    await page.getByRole('button', { name: 'Ferdig' }).click()

    await page.getByTestId('toggle-title').click()
    await expect(toast(page, 'med gjeldende font')).toBeVisible()
    // Nothing half-applied: no empty title zone left behind.
    await expect(stage(page).locator('[data-testid="slide-title"]')).toHaveCount(0)

    // The text is not lost — with a narrower font it comes back intact.
    await page.getByTestId('open-theme').click()
    await page.getByTestId('theme-heading-font').selectOption({ label: 'Times New Roman' })
    await expect.poll(() => renderedHeadingFont(page)).toContain('Times')
    await page.getByRole('button', { name: 'Ferdig' }).click()

    await page.getByTestId('toggle-title').click()
    await expect(stage(page).locator('[data-testid="slide-title"]')).toContainText(title)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })
})

/* ------------------------------------------------------------------ *
 * Citation numbering
 * ------------------------------------------------------------------ */

test.describe('citation numbering and fit', () => {
  /** Create a reference and drop a citation for it where the caret is. */
  async function citeNewReference(page: Page, title: string): Promise<void> {
    await page.getByTestId('open-references').click()
    await page.getByTestId('reference-title').fill(title)
    await page.getByTestId('save-reference').click()
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk' }).click()
    await page.waitForTimeout(150)
  }

  test('a citation is part of what the zone has to fit', async ({ page }) => {
    await createPresentation(page, 'Citation-plass')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).first()
    await field.click()
    await citeNewReference(page, 'Kilde')
    await expect(stage(page).locator('.rd-citation')).toHaveCount(1)

    await field.click()
    await fillZoneToCapacity(page, zones[0].id)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)

    // The pill occupies room like any other glyph run: with the zone full, one
    // more citation is refused rather than clipped.
    await citeNewReference(page, 'Kilde nummer to')
    await expect(toast(page, 'får ikke plass')).toBeVisible()
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('refuses a slide reorder that widens a label on a full slide', async ({ page }) => {
    await createPresentation(page, 'Rekkefølge og citations')

    // Slide 1: the same reference cited many times over.
    //
    // One pill barely changes width when its label goes from `1` to `10` — the
    // CSS gives it a `min-width` that a single extra digit mostly fits inside.
    // What that means is not "the effect is imaginary" but "the effect is a
    // fraction of a character per citation", so a case that can observe it in a
    // real browser needs a zone with many citations sitting at its limit. This
    // is that case.
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).first()
    await field.click()
    await page.getByTestId('open-references').click()
    await page.getByTestId('reference-title').fill('Kilden på slide 1')
    await page.getByTestId('save-reference').click()
    for (let i = 0; i < 59; i += 1) await page.getByTestId('insert-citation').first().click()
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk' }).click()
    await expect(stage(page).locator('.rd-citation')).toHaveCount(60)

    await fillZoneToCapacity(page, zones[0].id)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)

    // Slide 2: nine other references, so moving it in front turns `1` into `10`.
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    const second = await zoneRects(page)
    await addContentToZone(page, second[0].id, 'untitled-card')
    await stage(page).locator(`.slide-zone[data-node-id="${second[0].id}"] .tiptap`).first().click()
    await page.getByTestId('open-references').click()
    for (let i = 0; i < 9; i += 1) {
      await page.getByTestId('reference-title').fill(`Kilde ${i + 2}`)
      await page.getByTestId('save-reference').click()
      await page.waitForTimeout(80)
    }
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk' }).click()
    await expect(stage(page).locator('.rd-citation')).toHaveCount(9)

    // Drag slide 2 above slide 1, by its grip.
    const items = page.getByTestId('filmstrip-item')
    const before = await items.evaluateAll((entries) =>
      entries.map((entry) => (entry as HTMLElement).dataset.slideId),
    )
    const grip = items.nth(1).getByRole('button', { name: 'Flytt slide' })
    const from = await grip.boundingBox()
    const to = await items.nth(0).boundingBox()
    if (!from || !to) throw new Error('missing filmstrip geometry')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + 8, { steps: 15 })
    await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    await expect(toast(page, 'Rekkefølgen')).toBeVisible()
    // The deck is unchanged: the full slide is still first, still numbered `1`.
    const order = await page
      .getByTestId('filmstrip-item')
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.slideId))
    expect(order).toEqual(before)
    await page.getByTestId('filmstrip-item').nth(0).getByTestId('filmstrip-thumb').click()
    await expect(stage(page).locator('.rd-citation').first()).toHaveText('1')
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })
})
