import { defineConfig, devices } from '@playwright/test'

/**
 * Sandboxes and CI images sometimes ship a pre-installed Chromium that does not
 * match this Playwright version's expected build. Point
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at it to run the suite without downloading.
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

/** The specs that reach into a miniapp's frame; see the project below. */
const INTERACTIVE_SPECS = /interactive(-security|-authoring)?\.spec\.ts$/

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    deviceScaleFactor: 1,
    ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: INTERACTIVE_SPECS },
    {
      // The interactive slide's app runs in a sandboxed frame inside another
      // sandboxed frame. Chromium puts sandboxed frames in their own process
      // (IsolateSandboxedIframes), and Playwright then misses the inner frame
      // most of the time — the app runs, but the runner cannot reach into it.
      // With that one feature off the frames stay in the page's process and
      // every locator works. The sandbox and the Content Security Policy the
      // security spec measures are enforced by the renderer either way; the
      // process boundary is an extra layer on top of them, not the thing under
      // test.
      name: 'chromium-interactive',
      testMatch: INTERACTIVE_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
          args: ['--disable-features=IsolateSandboxedIframes'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    // Always build: reusing a server would silently test a stale bundle.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
