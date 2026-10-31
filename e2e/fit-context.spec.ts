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
import { expect, familiesFrom, localFaceCss, test, type Locator, type Page } from './fixtures'
import {
  addContentToZone,
  caretInto,
  createPresentation,
  fillZoneToCapacity,
  renderedBodyFont,
  renderedHeadingFont,
  stage,
  titleTextOverflow,
  toast,
  topUpToCapacity,
  worstOverflow,
  zoneRects,
  chooseFromToolbarMenu,
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
    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
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
    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
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

    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
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

    // Filled while the browser is still drawing the fallback. The app gives a
    // web font a deadline of its own, and everything between opening the deck
    // and releasing the route is spent against it — so this fills coarsely
    // rather than to the last character. The face the fixture serves for Inter
    // is far wider than the fallback, so a zone this full still overflows when
    // it swaps in.
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await fillZoneToCapacity(page, zones[0].id, { chunks: 30, topUp: false })
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)

    // What is under test is that the swap does not pass unnoticed. Whether the
    // app had already given up waiting by then is a different behaviour with a
    // test of its own — and it is decided by how long this test's own setup
    // took, which is not something to assert on.
    route.release()
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

    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
    await page.getByTestId('theme-heading-font').selectOption({ label: 'Consolas' })
    await expect(toast(page, 'Denne fonten')).toBeVisible()
    expect(await renderedHeadingFont(page)).not.toContain('Consolas')

    expect(await titleTextOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('refuses a remembered title that no longer fits, and keeps it', async ({ page }) => {
    await createPresentation(page, 'Tittelgjenoppretting')
    const title = await fillTitleToCapacity(page)
    expect(title.length).toBeGreaterThan(20)

    await removeTitle(page)

    // With the zone gone there is nothing to object, so this is allowed.
    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
    await page.getByTestId('theme-heading-font').selectOption({ label: 'Consolas' })
    await expect.poll(() => renderedHeadingFont(page)).toContain('Consolas')
    await page.getByRole('button', { name: 'Ferdig' }).click()

    await page.getByTestId('toggle-title').click()
    await expect(toast(page, 'med gjeldende font')).toBeVisible()
    // Nothing half-applied: no empty title zone left behind.
    await expect(stage(page).locator('[data-testid="slide-title"]')).toHaveCount(0)

    // The text is not lost — with a narrower font it comes back intact.
    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
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
  /**
   * Type into a one-line field until it will not take any more.
   *
   * Coarse first, then one narrow glyph at a time: a rejected insert rolls back
   * whole, so a big chunk leaves as much slack as the chunk is long, and that
   * slack is exactly what the next assertion is trying to observe.
   */
  async function fillLineToCapacity(page: Page, field: Locator): Promise<void> {
    await caretInto(field)
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.insertText('ord ord ')
      await page.waitForTimeout(20)
    }
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.insertText('i')
      await page.waitForTimeout(20)
    }
  }

  /**
   * Create several references in one visit, each cited where the caret is.
   *
   * The modal stays open between saves, and saving inserts the citation — so
   * they land side by side and merge into one pill, which is what makes the
   * label wide enough for a browser to have an opinion about it.
   */
  async function citeNewReferences(page: Page, field: Locator, titles: string[]): Promise<void> {
    await field.click()
    await chooseFromToolbarMenu(page, 'presentation', 'open-references')
    for (const title of titles) {
      await page.getByTestId('reference-title').fill(title)
      await page.getByTestId('save-reference').click()
    }
    await closeReferences(page)
  }

  /** Cite references that already exist, side by side, so they merge into one pill. */
  async function citeExisting(page: Page, field: Locator, titles: string[]): Promise<void> {
    await caretInto(field)
    await chooseFromToolbarMenu(page, 'presentation', 'open-references')
    for (const title of titles) {
      await page
        .getByTestId('reference-row')
        .filter({ hasText: title })
        .getByTestId('insert-citation')
        .click()
    }
    await closeReferences(page)
  }

  /** Create a reference and drop a citation for it where the caret is. */
  async function citeNewReference(page: Page, title: string): Promise<void> {
    await chooseFromToolbarMenu(page, 'presentation', 'open-references')
    await page.getByTestId('reference-title').fill(title)
    await page.getByTestId('save-reference').click()
    await closeReferences(page)
  }

  /**
   * Close the modal and wait for it to be gone.
   *
   * Waited for rather than slept off: the overlay stays in the tree through its
   * closing animation and swallows the next click, which a caller that opens the
   * modal twice in a row finds out about and one that does not never does.
   */
  async function closeReferences(page: Page): Promise<void> {
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk' }).click()
    await expect(page.getByTestId('reference-modal')).toHaveCount(0)
    // The overlay outlives the dialog it dims, and it is the overlay that eats
    // the next click.
    await expect(page.locator('.dialog-overlay')).toHaveCount(0)
    await page.waitForTimeout(150)
  }

  test('a citation is part of what the zone has to fit', async ({ page }) => {
    await createPresentation(page, 'Citation-plass')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).first()
    await caretInto(field)
    await citeNewReference(page, 'Kilde')
    await expect(stage(page).locator('.rd-citation')).toHaveCount(1)

    await caretInto(field)
    await fillZoneToCapacity(page, zones[0].id)
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)

    // The pill occupies room like any other glyph run: with the zone full, one
    // more citation is refused rather than clipped.
    await citeNewReference(page, 'Kilde nummer to')
    await expect(toast(page, 'Innholdet får ikke plass i sonen.')).toBeVisible()
    await expect(stage(page).locator('.rd-citation')).toHaveText('1')
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('refuses to remove a citing title when the renumbering fills another slide', async ({
    page,
  }) => {
    // The editor's own path, end to end. Removing a title zone gives *this*
    // slide more room, which is why it looks like a change that cannot hide
    // anything — and why it went through the guard without measurers for a
    // while, which is the same as not going through it at all.
    //
    // What it can hide sits on another slide. The pill built below reads `1–4`
    // while slide 1's title cites the first two references, and `1, 2, 5, 6`
    // once that title is gone: runs of two are listed rather than ranged, so
    // three glyphs become ten. It sits in a *title*, which is one line and
    // fails horizontally — so the extra width is the overflow, with none of the
    // guesswork about where a wrapped paragraph happens to break.
    await createPresentation(page, 'Tittel med citation')

    // Slide 1's title cites the first two references, so they are 1 and 2.
    const titleField = stage(page).locator('[data-testid="slide-title"] .tiptap')
    await titleField.click()
    await page.keyboard.type('Kilder')
    await citeNewReferences(page, titleField, ['Kilde A1', 'Kilde A2'])
    await expect(stage(page).locator('[data-testid="slide-title"] .rd-citation')).toHaveText('1, 2')

    // Slide 2 cites four more, which are 3–6 while that title still stands.
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    const second = (await zoneRects(page))[0]
    await addContentToZone(page, second.id, 'untitled-card')
    const secondField = stage(page)
      .locator(`.slide-zone[data-node-id="${second.id}"] .tiptap`)
      .first()
    await citeNewReferences(page, secondField, ['Kilde B1', 'Kilde B2', 'Kilde C', 'Kilde D'])

    // Slide 3's own title holds one pill citing A1, A2, B1 and B2 — consecutive
    // today — and is then filled to the last character it will take.
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await citeExisting(page, titleField, ['Kilde A1', 'Kilde A2', 'Kilde B1', 'Kilde B2'])
    await expect(stage(page).locator('.rd-citation')).toHaveText('1–4')
    await fillLineToCapacity(page, titleField)
    expect(await titleTextOverflow(page)).toBeLessThanOrEqual(1)

    // Back to slide 1, and take its title away. Index 0 is the front page, so
    // the deck's first ordinary slide is index 1.
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await page.getByTestId('toggle-title').click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await page.getByTestId('confirm-accept').click()

    // Refused, in the guard's own words, and the title is still there — with
    // its citation, so the numbering the rest of the deck reads is unchanged.
    await expect(toast(page, 'renummererer citations')).toBeVisible()
    await expect(page.getByTestId('slide-title')).toBeVisible()
    await expect(stage(page).locator('[data-testid="slide-title"] .rd-citation')).toHaveText('1, 2')

    // Give slide 3's title room again, keeping its pill, and the same removal
    // lands.
    await page.getByTestId('filmstrip-item').nth(3).getByTestId('filmstrip-thumb').click()
    await caretInto(titleField)
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText('Kort ')
    await citeExisting(page, titleField, ['Kilde A1', 'Kilde A2', 'Kilde B1', 'Kilde B2'])
    await expect(stage(page).locator('.rd-citation')).toHaveText('1–4')

    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await page.getByTestId('toggle-title').click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('slide-title')).toHaveCount(0)

    // And the renumbering the refusal was about is now visible on slide 3: the
    // same four references, two of them numbered after everything else.
    await page.getByTestId('filmstrip-item').nth(3).getByTestId('filmstrip-thumb').click()
    await expect(stage(page).locator('.rd-citation')).toHaveText('1, 2, 5, 6')
    expect(await titleTextOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('renumbers citations across slides when the deck is reordered', async ({ page }) => {
    // What a browser can show here is the renumbering itself. Whether it is
    // *refused* at the fit boundary is proved in `commands/citationFit.test.ts`
    // instead, and deliberately: a pill has a `min-width` that swallows most of
    // the extra digit, so `1` becoming `10` is a fraction of a character wider.
    // A test that claimed to observe that in a real browser would be measuring
    // its own fixture, not the rule.
    await createPresentation(page, 'Renummerering')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator('.subfield .tiptap').first().click()
    await chooseFromToolbarMenu(page, 'presentation', 'open-references')
    await page.getByTestId('reference-title').fill('Kilden på slide 1')
    await page.getByTestId('save-reference').click()
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk' }).click()
    await expect(stage(page).locator('.rd-citation')).toHaveText('1')

    // A second slide, cited before the first one once it is moved in front.
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()
    const second = await zoneRects(page)
    await addContentToZone(page, second[0].id, 'untitled-card')
    await stage(page).locator(`.slide-zone[data-node-id="${second[0].id}"] .tiptap`).first().click()
    await chooseFromToolbarMenu(page, 'presentation', 'open-references')
    await page.getByTestId('reference-title').fill('Kilden på slide 2')
    await page.getByTestId('save-reference').click()
    await page.getByTestId('reference-modal').getByRole('button', { name: 'Lukk' }).click()
    await expect(stage(page).locator('.rd-citation')).toHaveText('2')

    // Drag slide 2 above slide 1, by its grip — the handle that drags on the
    // first millimetre of movement, unlike the thumbnail, which asks to be held.
    // Index 0 is the front page, which stays where it is: the two ordinary
    // slides are 1 and 2.
    const items = page.getByTestId('filmstrip-item')
    const from = await items.nth(2).locator('.filmstrip__grip').boundingBox()
    const to = await items.nth(1).boundingBox()
    if (!from || !to) throw new Error('missing filmstrip geometry')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + 8, { steps: 15 })
    await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    // The slide that used to be second now cites `1`, and the other one `2`.
    await expect(stage(page).locator('.rd-citation')).toHaveText('1')
    await page.getByTestId('filmstrip-item').nth(2).getByTestId('filmstrip-thumb').click()
    await expect(stage(page).locator('.rd-citation')).toHaveText('2')
    expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
  })
})
