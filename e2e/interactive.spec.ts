import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from './fixtures'
import { createPresentation, presentedPage, stage, toast, waitForSaved, watchForErrors } from './helpers'

/**
 * The interactive slide, end to end: a file becomes a slide, the slide is a
 * cover until somebody presses its button, the app then owns the slide area
 * and the keyboard, and closing it hands everything back.
 *
 * Two things are measured from outside the app, through the messages the
 * fixture posts to the top window: that nothing of the file runs before
 * activation — not in the filmstrip, not on the stage, not in the player —
 * and that nothing of it keeps running after the frame is gone. Slaids itself
 * never listens for these messages; the spec does.
 *
 * Isolation is a separate question, measured in `interactive-security.spec.ts`.
 */

const COUNTER = readFileSync(new URL('./apps/counter-app.html', import.meta.url))
const ESCAPE = readFileSync(new URL('./apps/escape-app.html', import.meta.url))

interface CounterMessage {
  source: 'slaids-e2e-counter'
  type: 'ready' | 'count' | 'key' | 'tick' | 'late'
  detail: unknown
  run: string
  at: number
}

declare global {
  interface Window {
    __slaidsCounterMessages?: CounterMessage[]
  }
}

/** Start collecting the fixture's messages in the page. Call again after a reload. */
async function listenForApp(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__slaidsCounterMessages = []
    window.addEventListener('message', (event) => {
      const data = event.data as { source?: string } | null
      if (data && data.source === 'slaids-e2e-counter') {
        window.__slaidsCounterMessages!.push({ ...(data as CounterMessage), at: Date.now() })
      }
    })
  })
}

async function appMessages(page: Page): Promise<CounterMessage[]> {
  return page.evaluate(() => window.__slaidsCounterMessages ?? [])
}

/** Errors worth failing on. Chromium reports the frame's own permissions policy as noise. */
function relevant(errors: string[]): string[] {
  return errors.filter((error) => !/permissions policy/i.test(error))
}

async function openNewInteractive(page: Page): Promise<void> {
  await page.getByTestId('add-interactive').click()
  await expect(page.getByTestId('new-interactive-modal')).toBeVisible()
}

async function pickFile(
  page: Page,
  input: 'interactive-file-input' | 'interactive-replace-input',
  name: string,
  buffer: Buffer,
  mimeType = 'text/html',
): Promise<void> {
  await page.getByTestId(input).setInputFiles({ name, mimeType, buffer })
}

/** Add the counter app as a slide, through the dialog, and return its cover name. */
async function addCounterSlide(page: Page, name = 'Teller for salen'): Promise<void> {
  await openNewInteractive(page)
  await pickFile(page, 'interactive-file-input', 'counter-app.html', COUNTER)
  await expect(page.getByTestId('interactive-file-name')).toHaveText('counter-app.html')
  await page.getByTestId('interactive-name-input').fill(name)
  await page.getByTestId('create-interactive').click()
  await expect(page.getByTestId('new-interactive-modal')).toBeHidden()
  await expect(stage(page)).toHaveAttribute('data-interactive', '')
}

/** The running app's document, inside the wrapper, inside Slaids' frame. */
function app(scope: Page | Locator) {
  return scope.frameLocator('[data-testid="interactive-frame"]').frameLocator('#app')
}

test.describe('ny interaktiv slide', () => {
  test('dialogen tar én HTML-fil, foreslår navnet, forklarer vilkårene og oppretter sliden etter gjeldende', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Interaktiv')
    await listenForApp(page)

    // Two ordinary slides after the front page, and the first of them current,
    // so «after the current slide» is distinguishable from «last».
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)

    await openNewInteractive(page)
    const create = page.getByTestId('create-interactive')
    await expect(create).toBeDisabled()
    // The contract, in words, before any file is picked.
    const notes = page.getByTestId('interactive-notes').locator('li')
    await expect(notes).toHaveCount(5)
    await expect(notes.nth(0)).toContainText('Eksterne skript')
    await expect(notes.nth(1)).toContainText('arver presentasjonens farger')
    await expect(notes.nth(2)).toContainText('starter på nytt')
    await expect(notes.nth(3)).toContainText('følger med når presentasjonen deles')
    await expect(notes.nth(4)).toContainText('stoler på')

    // The wrong kind of file is refused in the dialog, and nothing is created.
    await pickFile(page, 'interactive-file-input', 'bilde.png', Buffer.from('not html'), 'image/png')
    await expect(page.getByTestId('interactive-file-error')).toContainText('.html')
    await expect(create).toBeDisabled()

    // A text file wearing the right name is refused by its content.
    await pickFile(page, 'interactive-file-input', 'notat.html', Buffer.from('bare tekst'))
    await expect(page.getByTestId('interactive-file-error')).toContainText('ingen elementer')
    await expect(create).toBeDisabled()

    // A UTF-16 file is refused by name, with the fix in the message.
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>x</p>', 'utf16le')])
    await pickFile(page, 'interactive-file-input', 'utf16.html', utf16)
    await expect(page.getByTestId('interactive-file-error')).toContainText('UTF-16')

    // The real file: name and size shown, the name suggested from the file.
    await pickFile(page, 'interactive-file-input', 'counter-app.html', COUNTER)
    await expect(page.getByTestId('interactive-file-error')).toHaveCount(0)
    await expect(page.getByTestId('interactive-file-name')).toHaveText('counter-app.html')
    await expect(page.getByTestId('interactive-file-size')).toContainText(/kB|byte/)
    await expect(page.getByTestId('interactive-name-input')).toHaveValue('counter-app')
    await expect(create).toBeEnabled()

    // Cancelling creates nothing.
    await page.getByRole('button', { name: 'Avbryt' }).click()
    await expect(page.getByTestId('new-interactive-modal')).toBeHidden()
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)

    await addCounterSlide(page)

    // Inserted right after the slide that was current, not at the end.
    const items = page.getByTestId('filmstrip-item')
    await expect(items).toHaveCount(4)
    await expect(items.nth(2).getByTestId('filmstrip-thumb')).toHaveAttribute('aria-label', 'Interaktiv')
    await expect(items.nth(2).locator('.filmstrip__badge')).toHaveText('Interaktiv')
    await expect(page.getByTestId('statusbar')).toContainText('Interaktiv 3 av 4')

    // The stage shows the cover in the deck's design: the name, and a play
    // button. Nothing else — the file name is the author's business and lives
    // in the inspector beside the stage.
    const cover = stage(page).getByTestId('interactive-page')
    await expect(cover).toBeVisible()
    await expect(cover.getByTestId('interactive-name')).toHaveText('Teller for salen')
    await expect(cover).not.toContainText('counter-app.html')
    await expect(cover).not.toContainText('Interaktiv miniapp')
    const play = stage(page).getByRole('button', { name: 'Aktiver miniapp' })
    await expect(play).toBeVisible()
    // Square, and a real target rather than a line of text.
    const playBox = (await play.boundingBox())!
    expect(Math.abs(playBox.width - playBox.height)).toBeLessThan(1.5)
    expect(playBox.width).toBeGreaterThanOrEqual(40)
    await expect(play.locator('svg')).toHaveCount(1)
    await expect(page.getByTestId('inspector').getByTestId('interactive-inspector-file')).toHaveText(
      'counter-app.html',
    )

    // The thumbnail is the same cover, drawn inert: no button, no frame.
    const thumb = items.nth(2).getByTestId('filmstrip-thumb')
    await expect(thumb.getByTestId('interactive-page')).toBeVisible()
    await expect(thumb.getByTestId('activate-interactive-inert')).toHaveCount(1)
    await expect(thumb.locator('button, iframe')).toHaveCount(0)
    await expect(page.locator('iframe')).toHaveCount(0)

    // And nothing of the file has run anywhere.
    expect(await appMessages(page)).toEqual([])
    expect(relevant(guard.errors)).toEqual([])
  })
})

test.describe('presentasjon', () => {
  test('forsiden er en side som alle andre, og appen kjører bare mellom Aktiver og Avslutt', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Vis miniapp')
    await listenForApp(page)
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()
    await addCounterSlide(page)
    // Deck: front, slide, slide, interactive — four pages.
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(4)

    await page.getByTestId('present').click()
    const view = page.getByTestId('present-view')
    await expect(view).toBeVisible()
    await page.keyboard.press('End')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 4, count: 4 })

    // Inactive: a cover with a real button, no frame, and the keys turn pages.
    await expect(view.getByTestId('interactive-page')).toBeVisible()
    const activate = view.getByRole('button', { name: 'Aktiver miniapp' })
    await expect(activate).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 3, count: 4 })
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 4, count: 4 })
    expect(await appMessages(page)).toEqual([])

    // Activate: the frame appears over the whole slide area, and the app runs.
    await activate.click()
    const frame = view.getByTestId('interactive-frame')
    await expect(frame).toBeVisible()
    await expect.poll(async () => (await appMessages(page)).some((m) => m.type === 'ready')).toBe(true)
    const slideBox = (await view.locator('.present__slide').boundingBox())!
    const frameBox = (await frame.boundingBox())!
    expect(Math.abs(frameBox.x - slideBox.x)).toBeLessThan(1.5)
    expect(Math.abs(frameBox.y - slideBox.y)).toBeLessThan(1.5)
    expect(Math.abs(frameBox.width - slideBox.width)).toBeLessThan(1.5)
    expect(Math.abs(frameBox.height - slideBox.height)).toBeLessThan(1.5)

    // The app is drawn in the deck's design: it names no font of its own, and
    // gets the deck's body role for text and its heading role for a heading.
    const inner = app(view)
    await expect(inner.locator('#title')).toHaveText('Teller')
    await expect(inner.locator('#font')).toContainText('Atkinson Hyperlegible Next')

    // Keyboard focus went into the app without a click.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
      .toBe('interactive-frame')
    await page.keyboard.press('ArrowRight')
    await expect(inner.locator('#key')).toHaveText('ArrowRight')
    expect(await presentedPage(page)).toEqual({ index: 4, count: 4 })

    // The app works: the field takes text, the button counts.
    await inner.locator('#text').fill('hei')
    await expect(inner.locator('#text')).toHaveValue('hei')
    await inner.locator('#count').click()
    await inner.locator('#count').click()
    await expect(inner.locator('#value')).toHaveText('2')

    // Every navigation key, a click and Escape: the page stays.
    for (const key of ['ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End', 'Space', 'Escape']) {
      await page.keyboard.press(key)
      expect(await presentedPage(page), key).toEqual({ index: 4, count: 4 })
    }
    await expect(view).toBeVisible()
    await frame.click({ position: { x: 20, y: 20 } })
    expect(await presentedPage(page)).toEqual({ index: 4, count: 4 })
    await expect(frame).toBeVisible()

    // The exit control: Slaids' own, top right, outside the frame, usable — and
    // a small × rather than a labelled button, so what it takes from the app is
    // the glyph inside it and not the target around it.
    const exit = view.getByRole('button', { name: 'Avslutt miniapp' })
    await expect(exit).toBeVisible()
    expect((await exit.textContent())?.trim()).toBe('')
    const exitBox = (await exit.boundingBox())!
    const glyphBox = (await view.getByTestId('exit-interactive-glyph').boundingBox())!
    expect(glyphBox.width).toBeLessThanOrEqual(28)
    expect(glyphBox.height).toBeLessThanOrEqual(28)
    expect(exitBox.width).toBeGreaterThan(glyphBox.width)
    expect(exitBox.height).toBeGreaterThan(glyphBox.height)
    expect(exitBox.width).toBeGreaterThanOrEqual(32)
    expect(exitBox.height).toBeGreaterThanOrEqual(32)
    expect(exitBox.x + exitBox.width).toBeLessThanOrEqual(slideBox.x + slideBox.width + 1)
    expect(exitBox.x).toBeGreaterThan(slideBox.x + slideBox.width * 0.7)
    expect(exitBox.y).toBeGreaterThanOrEqual(slideBox.y - 1)
    expect(exitBox.y).toBeLessThan(slideBox.y + slideBox.height * 0.2)
    expect(await frame.evaluate((node, exitNode) => node.contains(exitNode), await exit.elementHandle())).toBe(
      false,
    )

    // Exit: the frame is removed, the page is the same, focus is on the button.
    const ticksBefore = (await appMessages(page)).filter((m) => m.type === 'tick').length
    await exit.click()
    const exitedAt = Date.now()
    await expect(view.getByTestId('interactive-frame')).toHaveCount(0)
    await expect(page.locator('iframe')).toHaveCount(0)
    expect(await presentedPage(page)).toEqual({ index: 4, count: 4 })
    await expect(view.getByTestId('interactive-page')).toBeVisible()
    await expect(activate).toBeFocused()

    // Nothing of the app keeps running: no more ticks, and its delayed work
    // never arrives.
    await page.waitForTimeout(2000)
    const after = await appMessages(page)
    expect(after.filter((m) => m.type === 'tick').length).toBeLessThanOrEqual(ticksBefore + 1)
    expect(after.filter((m) => m.at > exitedAt + 250)).toEqual([])

    // Navigation is the player's again, and Escape leaves the presentation.
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => presentedPage(page)).toEqual({ index: 3, count: 4 })
    await page.keyboard.press('ArrowRight')

    // A second activation is a fresh run: new counter, new run id.
    const firstRun = after.find((m) => m.type === 'ready')!.run
    await view.getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(app(view).locator('#value')).toHaveText('0')
    await expect(app(view).locator('#text')).toHaveValue('')
    await expect
      .poll(async () => (await appMessages(page)).filter((m) => m.type === 'ready').map((m) => m.run))
      .toHaveLength(2)
    const runs = (await appMessages(page)).filter((m) => m.type === 'ready').map((m) => m.run)
    expect(runs[1]).not.toBe(firstRun)
    await view.getByRole('button', { name: 'Avslutt miniapp' }).click()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)
    expect(relevant(guard.errors)).toEqual([])
  })

  test('å forlate presentasjonen mens appen kjører tar appen med seg', async ({ page }) => {
    await createPresentation(page, 'Forlat')
    await listenForApp(page)
    await addCounterSlide(page)
    await page.getByTestId('present').click()
    await page.keyboard.press('End')
    await page.getByTestId('present-view').getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(page.getByTestId('interactive-frame')).toBeVisible()

    // Escape is the app's while it runs. The editor's own way out of the
    // player is gone until the app is closed — so close it, then leave.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('present-view')).toBeVisible()
    await page.getByRole('button', { name: 'Avslutt miniapp' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)

    // Turning to another page while an app runs is impossible from the keys;
    // the one way a page changes under a running app is the deck changing.
    // Back in the editor the stage is the other surface, and it runs the app
    // too — leaving the slide there unmounts it.
    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(page.getByTestId('interactive-frame')).toBeVisible()
    await page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb').click()
    await expect(page.locator('iframe')).toHaveCount(0)
  })
})


test.describe('temaet i miniappen', () => {
  /** The section colours the front page starts with, read off the cover. */
  async function coverColors(page: Page): Promise<{ background: string }> {
    const background = await stage(page)
      .getByTestId('interactive-page')
      .evaluate((node) => getComputedStyle(node).backgroundColor)
    return { background }
  }

  test('appen arver seksjonens farger, dekkets fonter og Slaids’ basisstilark', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Tema')
    await addCounterSlide(page)
    const cover = await coverColors(page)

    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    const inner = app(page)
    await expect(inner.locator('#title')).toHaveText('Teller')

    // The variables Slaids sets are the ones the deck draws the slide in.
    const background = await inner.locator('#background').textContent()
    expect(background?.trim()).toBeTruthy()
    await expect(inner.locator('#accent')).not.toHaveText('')
    expect(
      await inner.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe(cover.background)

    // The type is the deck's two roles, as stacks — not a font name the app
    // knows. Body text gets the body role; a heading gets the heading role,
    // which in this deck is a different family entirely.
    await expect(inner.locator('#font')).toContainText('Atkinson Hyperlegible Next')
    expect(
      await inner.locator('#title').evaluate((node) => getComputedStyle(node).fontFamily),
    ).toContain('Quicksand')

    // Slaids' base stylesheet styled a button the app never styled…
    const buttonBackground = (await inner.locator('#button-background').textContent())?.trim()
    expect(buttonBackground).toMatch(/^rgb/)
    expect(buttonBackground).not.toBe('rgba(0, 0, 0, 0)')
    // …and the app's own CSS still wins where the two meet.
    expect(
      await inner.locator('#styled-by-app').evaluate((node) => getComputedStyle(node).letterSpacing),
    ).toBe('4px')

    await page.getByRole('button', { name: 'Avslutt miniapp' }).click()
    expect(relevant(guard.errors)).toEqual([])
  })

  test('fontene ligger i dokumentet: rammen ber om ingenting', async ({ page }) => {
    // Slaids' own font route serves the family from `fonts.gstatic.com`, as
    // Google's stylesheet does, so the inliner has something real to embed.
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: "@font-face{font-family:'Quicksand';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/s/quicksand/v1/face.ttf) format('truetype');}",
      }),
    )
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/ttf', body: Buffer.from([0, 1, 0, 0]) }),
    )

    // Everything the browser asks for, and which frame asked for it.
    const fromFrames: string[] = []
    page.on('request', (request) => {
      const frame = request.frame()
      if (frame && frame !== page.mainFrame()) fromFrames.push(request.url())
    })

    await createPresentation(page, 'Fonter')
    await addCounterSlide(page)
    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(app(page).locator('#title')).toHaveText('Teller')
    await page.waitForTimeout(500)

    // The faces are in the document, with the file itself inside them.
    const srcdoc = await page.getByTestId('interactive-frame').getAttribute('srcdoc')
    expect(srcdoc).toContain('@font-face')
    expect(srcdoc).toContain('url(data:font/ttf;base64,')
    // Nothing in the frame reached for anything: not the font, not anything.
    expect(fromFrames).toEqual([])
    await page.getByRole('button', { name: 'Avslutt miniapp' }).click()
  })

  test('en treg fontlast får play-knappen til å vente, ikke til å starte i feil font', async ({
    page,
  }) => {
    // The race the font path exists to prevent: the cover appears, the fetch
    // starts, and somebody presses play before it lands. The frame cannot go
    // and get a font itself, so a run that began without the faces keeps the
    // wrong type for as long as it lasts.
    await page.route('https://fonts.googleapis.com/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: "@font-face{font-family:'Quicksand';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/s/quicksand/v1/face.ttf) format('truetype');}",
      })
    })
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/ttf', body: Buffer.from([0, 1, 0, 0]) }),
    )

    await createPresentation(page, 'Treg font')
    await addCounterSlide(page)

    // Straight from the dialog to play, with no pause for the fetch.
    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(page.getByTestId('interactive-frame')).toBeVisible()

    // The very first run has the faces in it, not a document that will never
    // get them.
    const srcdoc = await page.getByTestId('interactive-frame').getAttribute('srcdoc')
    expect(srcdoc).toContain('@font-face')
    expect(srcdoc).toContain('url(data:font/ttf;base64,')
    await page.getByRole('button', { name: 'Avslutt miniapp' }).click()
  })

  test('en ny seksjonsfarge slår gjennom neste gang, uten å røre den lagrede filen', async ({
    page,
  }) => {
    await createPresentation(page, 'Farge')
    await addCounterSlide(page)

    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    const before = (await app(page).locator('#accent').textContent())?.trim()
    expect(before).toBeTruthy()
    await page.getByRole('button', { name: 'Avslutt miniapp' }).click()

    // Recolour the section that governs the slide. The interactive slide is
    // not touched by this edit at all.
    const fileBefore = await page.getByTestId('interactive-inspector-size').textContent()
    await page.getByTestId('filmstrip-item').nth(0).getByTestId('filmstrip-thumb').click()
    await page
      .getByTestId('inspector')
      .locator('section')
      .filter({ hasText: 'Aksentfarge' })
      .getByTestId('palette')
      .locator('[data-color]')
      .nth(3)
      .click()
    await page.getByTestId('filmstrip-item').nth(2).getByTestId('filmstrip-thumb').click()

    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    const after = (await app(page).locator('#accent').textContent())?.trim()
    expect(after).toBeTruthy()
    expect(after).not.toBe(before)
    // The file is the same file: the design is injected, never written in.
    expect(await page.getByTestId('interactive-inspector-size').textContent()).toBe(fileBefore)
    await page.getByRole('button', { name: 'Avslutt miniapp' }).click()
  })
})

test.describe('editoren', () => {
  test('scenen kan prøve appen, og låser navigasjon og snarveier mens den kjører', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Prøv på scenen')
    await listenForApp(page)
    await addCounterSlide(page)
    await expect(page.getByTestId('statusbar')).toContainText('Interaktiv 3 av 3')

    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    const frame = stage(page).getByTestId('interactive-frame')
    await expect(frame).toBeVisible()
    await expect(app(page).locator('#title')).toHaveText('Teller')

    // Keys the editor would otherwise act on: page navigation, zone mode,
    // presenting. None of them may fire while the app owns the keyboard.
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('PageUp')
    await page.keyboard.press('Control+e')
    await page.keyboard.press('F5')
    await page.waitForTimeout(150)
    await expect(page.getByTestId('statusbar')).toContainText('Interaktiv 3 av 3')
    await expect(page.getByTestId('zone-overlay')).toHaveCount(0)
    await expect(page.getByTestId('present-view')).toHaveCount(0)
    await expect(frame).toBeVisible()

    await page.getByRole('button', { name: 'Avslutt miniapp' }).click()
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(stage(page).getByRole('button', { name: 'Aktiver miniapp' })).toBeFocused()

    // And the editor's keys are its own again.
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('statusbar')).toContainText('Slide 2 av 3')
    expect(relevant(guard.errors)).toEqual([])
  })

  test('navn og fil endres i panelet, angres med Ctrl+Z, og overlever en omlasting', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Rediger miniapp')
    await listenForApp(page)
    await addCounterSlide(page)

    // Rename from the inspector: the cover follows as you type.
    const nameField = page.getByTestId('interactive-inspector-name')
    await nameField.fill('Quiz')
    await expect(stage(page).getByTestId('interactive-name')).toHaveText('Quiz')
    await expect(page.getByTestId('filmstrip-item').nth(2).getByTestId('interactive-name')).toHaveText('Quiz')

    // A replacement that cannot be used is refused, and the app stays.
    await pickFile(page, 'interactive-replace-input', 'notat.html', Buffer.from('bare tekst'))
    await expect(toast(page, 'ingen elementer')).toBeVisible()
    await expect(page.getByTestId('interactive-inspector-file')).toHaveText('counter-app.html')
    await pickFile(page, 'interactive-replace-input', 'bilde.png', Buffer.from('x'), 'image/png')
    await expect(toast(page, '.html')).toBeVisible()
    await expect(page.getByTestId('interactive-inspector-file')).toHaveText('counter-app.html')

    // A good one replaces the file, keeping the slide, its place and its name.
    await pickFile(page, 'interactive-replace-input', 'escape-app.html', ESCAPE)
    await expect(page.getByTestId('interactive-inspector-file')).toHaveText('escape-app.html')
    await expect(stage(page).getByTestId('interactive-name')).toHaveText('Quiz')
    await expect(page.getByTestId('filmstrip-item')).toHaveCount(3)

    // Undo and redo, from the keyboard, with the focus off the inputs.
    await page.getByTestId('stage-note').click()
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('interactive-inspector-file')).toHaveText('counter-app.html')
    await page.keyboard.press('Control+Shift+z')
    await expect(page.getByTestId('interactive-inspector-file')).toHaveText('escape-app.html')
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('interactive-inspector-file')).toHaveText('counter-app.html')

    // Duplicate and delete are the filmstrip's ordinary tools.
    const items = page.getByTestId('filmstrip-item')
    await items.nth(2).getByTestId('duplicate-slide').click()
    await expect(items).toHaveCount(4)
    await expect(items.nth(3).getByTestId('filmstrip-thumb')).toHaveAttribute('aria-label', 'Interaktiv')
    await expect(items.nth(3).getByTestId('interactive-name')).toHaveText('Quiz')
    await items.nth(3).getByTestId('delete-slide').click()
    await page.getByTestId('confirm-accept').click()
    await expect(items).toHaveCount(3)

    // Reload: the slide is stored as data and comes back the same — and the
    // stored file still runs when asked to.
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await listenForApp(page)
    await expect(items).toHaveCount(3)
    await items.nth(2).getByTestId('filmstrip-thumb').click()
    await expect(stage(page).getByTestId('interactive-name')).toHaveText('Quiz')
    await expect(page.getByTestId('interactive-inspector-file')).toHaveText('counter-app.html')
    await expect(page.locator('iframe')).toHaveCount(0)
    expect(await appMessages(page)).toEqual([])

    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(app(page).locator('#title')).toHaveText('Teller')
    await expect.poll(async () => (await appMessages(page)).some((m) => m.type === 'ready')).toBe(true)
    await page.getByRole('button', { name: 'Avslutt miniapp' }).click()
    await expect(page.locator('iframe')).toHaveCount(0)

    expect(relevant(guard.errors)).toEqual([])
  })

  test('en fil som byttes ut mens appen kjører, avslutter den', async ({ page }) => {
    await createPresentation(page, 'Bytt under kjøring')
    await addCounterSlide(page)
    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(page.getByTestId('interactive-frame')).toBeVisible()

    await pickFile(page, 'interactive-replace-input', 'escape-app.html', ESCAPE)
    await expect(page.getByTestId('interactive-inspector-file')).toHaveText('escape-app.html')
    // What was running is not the slide's file any more, so it is gone.
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(stage(page).getByRole('button', { name: 'Aktiver miniapp' })).toBeVisible()
  })
})

/**
 * Slaids' way out of a running app, as a control rather than as a lifecycle.
 *
 * What it *does* is measured above, on both surfaces and from the app's side of
 * the frame. What is measured here is what it costs the app to have it there:
 * a glyph small enough to be ignored and faint enough to be forgotten, with a
 * target around it that is neither — and the states that make the difference
 * between the two visible to somebody aiming at it.
 */
test.describe('avsluttkontrollen', () => {
  test('er nesten usynlig i hvile, tydelig når den treffes, og avsluttes med tastatur og trykk', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Avslutt')
    await addCounterSlide(page)
    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(app(page).locator('#title')).toHaveText('Teller')

    const exit = page.getByTestId('exit-interactive')
    const glyph = page.getByTestId('exit-interactive-glyph')
    const opacity = async (): Promise<number> =>
      Number(await glyph.evaluate((node) => getComputedStyle(node).opacity))

    // Drawn, and barely drawn: the app behind it is the thing on screen.
    expect(await opacity()).toBeGreaterThan(0)
    expect(await opacity()).toBeLessThan(0.7)

    // A pointer on it, and there is no doubt what it is…
    await exit.hover()
    await expect.poll(opacity).toBe(1)
    // …for as long as the pointer is there, and no longer.
    await page.mouse.move(2, 2)
    await expect.poll(opacity).toBeLessThan(0.7)

    /*
     * The keyboard reaches it from inside the running app: Tab leaves a frame
     * the way it leaves anything else, and the control is the next thing after
     * the frame. How many presses that takes is the app's business — it has
     * fields of its own — so this asks for the one thing that matters, which is
     * that the control is reachable at all.
     */
    for (let i = 0; i < 10; i += 1) {
      if (await exit.evaluate((node) => node === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(exit).toBeFocused()
    // Where the keyboard is, said twice: at full strength, and ringed.
    await expect.poll(opacity).toBe(1)
    expect(await glyph.evaluate((node) => getComputedStyle(node).outlineWidth)).toBe('3px')

    // Enter is still the way out, as it was when the control carried a label.
    await page.keyboard.press('Enter')
    await expect(page.locator('iframe')).toHaveCount(0)
    await expect(stage(page).getByRole('button', { name: 'Aktiver miniapp' })).toBeFocused()

    /*
     * And a press answers before the app goes away — the one state a finger can
     * actually reach, since hovering is not something a finger does.
     */
    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    await expect(page.getByTestId('interactive-frame')).toBeVisible()
    const transform = (): Promise<string> =>
      glyph.evaluate((node) => getComputedStyle(node).transform)
    expect(await transform()).toBe('none')
    const box = (await exit.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect.poll(transform).not.toBe('none')
    await page.mouse.up()
    await expect(page.locator('iframe')).toHaveCount(0)
    expect(relevant(guard.errors)).toEqual([])
  })

  test('scenen og spilleren bruker den samme kontrollen', async ({ page }) => {
    await createPresentation(page, 'Samme vei ut')
    await addCounterSlide(page)

    /** The control as it is on this surface: the element, and its size on screen. */
    async function control(scope: Page | Locator): Promise<{ markup: string; size: string }> {
      const exit = scope.getByTestId('exit-interactive')
      const box = (await exit.boundingBox())!
      return {
        markup: await exit.evaluate((node) => node.outerHTML),
        size: `${Math.round(box.width)}×${Math.round(box.height)}`,
      }
    }

    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    const onStage = await control(stage(page))
    await page.getByTestId('exit-interactive').click()

    await page.getByTestId('present').click()
    await page.keyboard.press('End')
    const view = page.getByTestId('present-view')
    await view.getByRole('button', { name: 'Aktiver miniapp' }).click()
    const inPlayer = await control(view)
    await view.getByTestId('exit-interactive').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()

    /*
     * One control, not two that resemble each other: the same markup, and the
     * same size on screen although the editor draws the slide at a fraction of
     * the size the player does. That second half is the scale rule — the chrome
     * undoes the slide's scaling — measured where it is easiest to break.
     */
    expect(inPlayer).toEqual(onStage)
  })
})
