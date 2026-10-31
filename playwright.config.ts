import { defineConfig, devices } from '@playwright/test'

/**
 * Sandboxes and CI images sometimes ship a pre-installed Chromium that does not
 * match this Playwright version's expected build. Point
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at it to run the suite without downloading.
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

/** The specs that reach into a miniapp's frame; see the project below. */
const INTERACTIVE_SPECS = /interactive(-security|-authoring)?\.spec\.ts$/

/**
 * The compact-workspace suite, run once per shape of surface.
 *
 * It is kept apart from the desktop suite rather than merged into it because
 * the two ask different questions of the same app: the desktop specs are the
 * regression net for the roomy layout, and these are about what happens when
 * there is no room — and about proving that «no room» is decided by the
 * window, not by a user agent.
 */
const COMPACT_SPECS = /compact\.spec\.ts$/

/**
 * A miniapp's app runs in a sandboxed frame inside another sandboxed frame.
 * Chromium puts sandboxed frames in their own process
 * (IsolateSandboxedIframes), and Playwright then misses the inner frame most of
 * the time — the app runs, but the runner cannot reach into it. With that one
 * feature off the frames stay in the page's process and every locator works.
 * The sandbox and the Content Security Policy the security spec measures are
 * enforced by the renderer either way; the process boundary is an extra layer
 * on top of them, not the thing under test.
 */
const frameReachableLaunch = {
  ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
  args: ['--disable-features=IsolateSandboxedIframes'],
}

/**
 * Where the built app is served. Named as an address rather than `localhost`:
 * on a GitHub runner `localhost` resolves to `::1` first, so a preview bound to
 * it is never reached at `127.0.0.1`, and the run times out waiting for it.
 * Both are passed to `vite preview`, so this is the one place they are set
 * for a test run.
 */
const HOST = '127.0.0.1'
const PORT = 4173
const APP_URL = `http://${HOST}:${PORT}`

/**
 * A modern phone, in both orientations.
 *
 * Written out rather than taken from `devices[...]`: what the compact layout
 * reacts to is the size of the window and the kind of pointer, and naming both
 * here says exactly what is being tested. The device descriptors would also
 * bring a user agent string along, and a suite that passed because of one
 * would be proving the opposite of what this feature promises.
 */
const PHONE_PORTRAIT = { width: 412, height: 892 }
const PHONE_LANDSCAPE = { width: 892, height: 412 }

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  /*
   * Never retried, locally or in CI: a test that passes on its second attempt
   * is a red test, and a retry would report it green. `.github/workflows/e2e.yml`
   * and `docs/E2E_CI.md` rely on that.
   */
  retries: 0,
  /*
   * In CI a failure has to be readable without the runner: `github` puts the
   * message on the failing line of the spec in the pull request, and the HTML
   * report — screenshot, log and trace per failed test — is uploaded with the
   * run.
   */
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: APP_URL,
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    deviceScaleFactor: 1,
    /*
     * The app follows the operating system's appearance by default, and a
     * browser left to itself reports a light one. The suite pins dark — the
     * appearance its visual baselines were drawn in — and checks light where it
     * says so (`appearance.spec.ts`, and the light runs in the accessibility
     * and visual specs).
     */
    colorScheme: 'dark',
    ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [INTERACTIVE_SPECS, COMPACT_SPECS],
    },
    {
      name: 'chromium-interactive',
      testMatch: INTERACTIVE_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: frameReachableLaunch,
      },
    },
    /*
     * A phone held upright: the content-first workspace, where the slide is a
     * preview and the text is the working surface.
     */
    {
      name: 'phone-portrait',
      testMatch: COMPACT_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: PHONE_PORTRAIT,
        isMobile: true,
        hasTouch: true,
        launchOptions: frameReachableLaunch,
      },
    },
    /* The same phone on its side: the visual editing surface. */
    {
      name: 'phone-landscape',
      testMatch: COMPACT_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: PHONE_LANDSCAPE,
        isMobile: true,
        hasTouch: true,
        launchOptions: frameReachableLaunch,
      },
    },
    /*
     * A narrow desktop window with a mouse and no touch at all.
     *
     * The point of this project is the promise that compact is a fact about
     * the window: if any of it were decided by a user agent or by a touch
     * capability, this is the run that would fail.
     */
    {
      name: 'compact-mouse',
      testMatch: COMPACT_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 900, height: 760 },
        isMobile: false,
        hasTouch: false,
        launchOptions: frameReachableLaunch,
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host ${HOST} --port ${PORT}`,
    url: APP_URL,
    // Always build: reusing a server would silently test a stale bundle.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
