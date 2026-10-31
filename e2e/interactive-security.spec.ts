import { readFileSync } from 'node:fs'
import type { FrameLocator } from '@playwright/test'
import { expect, test, type Page } from './fixtures'
import { createPresentation, presentedPage, stage, addPage } from './helpers'

/**
 * The isolation boundary, measured.
 *
 * A hostile miniapp (`apps/escape-app.html`) tries everything an uploaded
 * file could try in order to get past its frame — the page around it, its
 * storage, the network, popups, downloads, dialogs, workers, `eval`,
 * loosening its own policy, a child frame with more flags, a message to the
 * page — first on load and then again with a real click, for the things
 * browsers only grant on user activation. Navigating its own frame is tried
 * last, one attempt per fresh app, because a refused navigation still leaves
 * the browser's block page where the app was.
 *
 * The app writes what it saw into its own document, and that is read here.
 * But nothing that can be measured from outside is taken on the app's word.
 * Every request the browser reports is classified: one that reaches the
 * route handler has reached the network layer and is a finding; one the
 * renderer refused under the policy is reported as failed with reason `csp`
 * and never gets that far. Popups, downloads, dialogs and frame navigations
 * are counted, and the page around the frame — its URL, its title, which
 * slide is showing — is checked to be exactly what it was.
 *
 * Chromium only, because only Chromium is installed where this runs; the
 * spec is written for all three engines and the PR says which were run.
 */

const ESCAPE = readFileSync(new URL('./apps/escape-app.html', import.meta.url))

interface Outside {
  /** Probe URLs that reached the network layer. Any entry is a finding. */
  routed: string[]
  /** Probe URLs the browser reported a request for, with how each ended. */
  reported: Map<string, string>
  popups: number
  downloads: number
  dialogs: number
  /** Frames that navigated to a probe URL. */
  navigations: string[]
}

/** Everything the browser would let out or open, counted from outside the frame. */
async function watchOutside(page: Page): Promise<Outside> {
  const outside: Outside = {
    routed: [],
    reported: new Map(),
    popups: 0,
    downloads: 0,
    dialogs: 0,
    navigations: [],
  }
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (/probe/i.test(url)) {
      outside.routed.push(url)
      await route.abort()
      return
    }
    // Older routes — the fixture's local fonts — still apply.
    await route.fallback()
  })
  page.on('request', (request) => {
    if (/probe/i.test(request.url())) outside.reported.set(request.url(), 'pending')
  })
  page.on('requestfailed', (request) => {
    if (/probe/i.test(request.url())) {
      outside.reported.set(request.url(), `failed:${request.failure()?.errorText ?? ''}`)
    }
  })
  page.on('requestfinished', (request) => {
    if (/probe/i.test(request.url())) outside.reported.set(request.url(), 'finished')
  })
  page.on('popup', () => {
    outside.popups += 1
  })
  page.context().on('page', () => {
    outside.popups += 1
  })
  page.on('download', () => {
    outside.downloads += 1
  })
  page.on('dialog', async (dialog) => {
    outside.dialogs += 1
    await dialog.dismiss()
  })
  page.on('framenavigated', (frame) => {
    if (/probe/i.test(frame.url())) outside.navigations.push(frame.url())
  })
  return outside
}

/** Nothing left the frame: what was reported was refused in the renderer. */
function expectNothingOut(outside: Outside): void {
  expect(outside.routed, 'requests that reached the network layer').toEqual([])
  for (const [url, ending] of outside.reported) {
    expect(ending, url).toBe('failed:csp')
  }
  expect(outside.navigations, 'frames that navigated to a probe URL').toEqual([])
  expect(outside.popups, 'popups').toBe(0)
  expect(outside.downloads, 'downloads').toBe(0)
  expect(outside.dialogs, 'dialogs').toBe(0)
}

async function addEscapeSlide(page: Page): Promise<void> {
  await addPage(page, 'interactive')
  await page.getByTestId('interactive-file-input').setInputFiles({
    name: 'escape-app.html',
    mimeType: 'text/html',
    buffer: ESCAPE,
  })
  await expect(page.getByTestId('interactive-file-name')).toHaveText('escape-app.html')
  await page.getByTestId('create-interactive').click()
  await expect(page.getByTestId('new-interactive-modal')).toBeHidden()
}

function app(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="interactive-frame"]').frameLocator('#app')
}

/** Start the app on the page on screen and wait until it reports in. */
async function activate(page: Page): Promise<FrameLocator> {
  await page.getByRole('button', { name: 'Aktiver miniapp' }).click()
  const frame = app(page)
  await expect(frame.locator('[data-probe="ready"]')).toHaveAttribute('data-outcome', 'ready')
  return frame
}

async function exit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Avslutt miniapp' }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
}

/** The outcome the app recorded for one probe, once it has stopped being pending. */
async function outcome(frame: FrameLocator, name: string): Promise<string> {
  const item = frame.locator(`[data-probe="${name}"]`)
  await expect(item, name).toHaveCount(1, { timeout: 15_000 })
  await expect(item, name).not.toHaveAttribute('data-outcome', 'pending', { timeout: 15_000 })
  return (await item.getAttribute('data-outcome')) ?? ''
}

async function expectBlocked(frame: FrameLocator, name: string): Promise<void> {
  expect(await outcome(frame, name), name).toMatch(/^blocked/)
}

/** The frame is still the hostile document, alive and ticking. */
async function expectStillAlive(frame: FrameLocator): Promise<void> {
  const before = Number(await frame.locator('#pulse').textContent())
  await expect
    .poll(async () => Number(await frame.locator('#pulse').textContent()))
    .toBeGreaterThan(before)
}

test.describe('isolasjonen, målt', () => {
  test('ingenting når ut av rammen, og ingenting av Slaids nås fra den — heller ikke med et klikk', async ({
    page,
  }) => {
    const outside = await watchOutside(page)
    await createPresentation(page, 'Utbryter')
    await addEscapeSlide(page)
    const titleBefore = await page.title()
    const urlBefore = page.url()

    await page.getByTestId('present').click()
    await page.keyboard.press('End')
    const pageBefore = await presentedPage(page)
    const frame = await activate(page)

    /* ---- The page around the frame ---- */
    expect(await outcome(frame, 'origin')).toBe('origin:null')
    await expectBlocked(frame, 'parent-document')
    await expectBlocked(frame, 'top-document')
    await expectBlocked(frame, 'frame-element')
    // It does have a parent — the wrapper — which it cannot read either.
    expect(await outcome(frame, 'parent-is-not-self')).toBe('blocked:has-parent')

    /* ---- Storage ---- */
    await expectBlocked(frame, 'local-storage')
    await expectBlocked(frame, 'session-storage')
    await expectBlocked(frame, 'cookie')
    await expectBlocked(frame, 'indexeddb')

    /* ---- Network, by the app's account ---- */
    for (const name of [
      'fetch-external',
      'fetch-slaids-origin',
      'xhr',
      'websocket',
      'image',
      'stylesheet',
      'script-external',
      'font',
      'worker',
    ]) {
      await expectBlocked(frame, name)
    }
    // A beacon is «queued», whatever happens to it: whether it left is
    // measured from outside, below.
    expect(await outcome(frame, 'beacon')).toMatch(/^attempted/)

    /* ---- Code ---- */
    await expectBlocked(frame, 'eval')
    await expectBlocked(frame, 'new-function')

    /* ---- Loosening the policy from inside ---- */
    expect(await outcome(frame, 'csp-weaken')).toBe('attempted')
    await expectBlocked(frame, 'fetch-after-weaken')
    await expectBlocked(frame, 'eval-after-weaken')
    await expectBlocked(frame, 'base-href')

    /* ---- Child frames ---- */
    expect(await outcome(frame, 'subframe-external')).toBe('attempted')
    await expectBlocked(frame, 'subframe-escalation')
    await expectBlocked(frame, 'subframe-parent-document')
    await expectBlocked(frame, 'subframe-storage')
    expect(await outcome(frame, 'subframe-origin')).toBe('origin:null')

    /* ---- Powerful features ---- */
    await expectBlocked(frame, 'get-user-media')
    await expectBlocked(frame, 'clipboard-read')
    // Geolocation answers with an error, or not at all; never with a position.
    expect(await outcome(frame, 'geolocation')).not.toBe('allowed')

    /* ---- Without activation ---- */
    await expectBlocked(frame, 'window-open')
    await expectBlocked(frame, 'top-navigation')
    for (const name of ['form-submit', 'alert', 'download-click', 'postmessage-control']) {
      expect(await outcome(frame, name), name).toBe('attempted')
    }

    /* ---- With a real click ---- */
    for (const id of [
      'ua-window-open',
      'ua-top-navigation',
      'ua-fetch',
      'ua-fullscreen',
      'ua-pointer-lock',
      'ua-alert',
      'ua-form',
    ]) {
      await frame.locator(`#${id}`).click()
    }
    await expectBlocked(frame, 'ua-window-open')
    await expectBlocked(frame, 'ua-top-navigation')
    await expectBlocked(frame, 'ua-fetch')
    await expectBlocked(frame, 'ua-fullscreen')
    await expectBlocked(frame, 'ua-pointer-lock')
    expect(await outcome(frame, 'ua-alert')).toBe('attempted')
    expect(await outcome(frame, 'ua-form')).toBe('attempted')
    // Links and a submit button, which only a click can follow. None of
    // these navigates this frame, so the app is still here afterwards.
    for (const id of ['ua-link-blank', 'ua-link-top', 'ua-download', 'ua-form-submit']) {
      await frame.locator(`#${id}`).click()
      await page.waitForTimeout(150)
    }
    await page.waitForTimeout(1000)
    await expectStillAlive(frame)

    /* ---- Measured from outside ---- */
    expectNothingOut(outside)
    expect(page.url()).toBe(urlBefore)
    expect(await page.title()).toBe(titleBefore)
    expect(await presentedPage(page)).toEqual(pageBefore)
    await expect(page.getByTestId('present-view')).toBeVisible()
    await expect(page.getByTestId('interactive-frame')).toHaveCount(1)
    // Nothing the app posted changed anything, and nothing of the page's own
    // storage was touched.
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => /probe/i.test(key)),
    )
    expect(stored).toEqual([])

    // The way out is still Slaids', and it works.
    await exit(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
  })

  test('rammen kan ikke navigeres — ikke til nettet, og ikke til Slaids selv', async ({ page }) => {
    const outside = await watchOutside(page)
    await createPresentation(page, 'Navigasjon')
    await addEscapeSlide(page)
    const urlBefore = page.url()
    await page.getByTestId('present').click()
    await page.keyboard.press('End')
    const pageBefore = await presentedPage(page)

    // One fresh app per attempt: a refused navigation leaves the browser's
    // block page in the frame, so nothing can be read from it afterwards.
    // What is measured is that no request was made, that no frame reached
    // the URL, that the page around the frame is untouched, and that Slaids'
    // own way out still works.
    for (const id of [
      'nav-location-external',
      'nav-location-slaids',
      'nav-location-replace',
      'nav-meta-refresh',
      'ua-link-self',
      'ua-link-slaids',
    ]) {
      const frame = await activate(page)
      await frame.locator(`#${id}`).click()
      await page.waitForTimeout(700)

      expectNothingOut(outside)
      // Not even reported: a navigation the policy refuses is refused before
      // a request exists, unlike a subresource, which is reported as blocked.
      expect(
        [...outside.reported.keys()].filter((url) => /link-self|link-slaids|location|refresh/.test(url)),
        id,
      ).toEqual([])
      expect(page.url(), id).toBe(urlBefore)
      expect(await presentedPage(page), id).toEqual(pageBefore)
      await expect(page.getByTestId('present-view')).toBeVisible()
      await exit(page)
    }

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('editor')).toBeVisible()
  })

  test('rammen på scenen har nøyaktig sandkassen og policyen som er avtalt', { tag: '@pr' }, async ({ page }) => {
    await createPresentation(page, 'Attributter')
    await addEscapeSlide(page)
    await stage(page).getByRole('button', { name: 'Aktiver miniapp' }).click()
    const frame = page.getByTestId('interactive-frame')
    await expect(frame).toBeVisible()

    // Slaids' own frame: sandbox, referrer policy, permissions, srcdoc — and
    // no src, so nothing is ever fetched from a URL.
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    await expect(frame).toHaveAttribute('allow', /camera 'none'/)
    expect(await frame.getAttribute('src')).toBeNull()

    // Inside it, the wrapper carries the policy and the app frame the same
    // sandbox — read through the wrapper's own document, which is Slaids'
    // markup, sandboxed like the app.
    const wrapper = page.frameLocator('[data-testid="interactive-frame"]')
    await expect(wrapper.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
      'content',
      /default-src 'none'.*connect-src 'none'.*frame-src 'none'.*base-uri 'none'/,
    )
    const inner = wrapper.locator('iframe#app')
    await expect(inner).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(inner).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(await inner.getAttribute('src')).toBeNull()

    // And the app, from its own point of view, is in an opaque origin under
    // the policy: its `fetch` fails and its origin is «null».
    expect(await outcome(app(page), 'origin')).toBe('origin:null')
    await expectBlocked(app(page), 'fetch-external')

    await exit(page)
  })
})
