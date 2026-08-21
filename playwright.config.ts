import { defineConfig, devices } from '@playwright/test'

/**
 * Sandboxes and CI images sometimes ship a pre-installed Chromium that does not
 * match this Playwright version's expected build. Point
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at it to run the suite without downloading.
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    // Always build: reusing a server would silently test a stale bundle.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
