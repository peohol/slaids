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
    await expect(notes).toHaveCount(4)
    await expect(notes.nth(0)).toContainText('Eksterne skript')
    await expect(notes.nth(1)).toContainText('starter på nytt')
    await expect(notes.nth(2)).toContainText('følger med når presentasjonen deles')
    await expect(notes.nth(3)).toContainText('stoler på')

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

    // The stage shows the cover in the deck's design: name, marking, button.
    const cover = stage(page).getByTestId('interactive-page')
    await expect(cover).toBeVisible()
    await expect(cover.getByTestId('interactive-name')).toHaveText('Teller for salen')
    await expect(cover).toContainText('Interaktiv miniapp')
    await expect(cover).toContainText('counter-app.html')
    await expect(stage(page).getByRole('button', { name: 'Aktiver miniapp' })).toBeVisible()
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

    // The app is drawn in its own design, not Slaids'.
    const inner = app(view)
    await expect(inner.locator('#title')).toHaveText('Teller')
    await expect(inner.locator('#font')).toContainText('Courier New')

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

    // The exit button: Slaids' own, top right, outside the frame, usable.
    const exit = view.getByRole('button', { name: 'Avslutt miniapp' })
    await expect(exit).toBeVisible()
    const exitBox = (await exit.boundingBox())!
    expect(exitBox.width).toBeGreaterThanOrEqual(44)
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
    await expect(stage(page).getByTestId('interactive-page')).toContainText('escape-app.html')
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
