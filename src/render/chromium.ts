/**
 * The rasterizer: a real Chromium, laying the document out and photographing it.
 *
 * A browser is a heavy thing to put behind an API call, and the alternatives
 * were considered and rejected for the same reason each time. A vector
 * rasterizer (resvg and friends) cannot draw HTML at all. An HTML-to-SVG
 * layout engine (satori, and therefore `@vercel/og`) understands a subset of
 * flexbox and no stylesheets, so the preview would have to be re-expressed as
 * inline styles it recognises — which is precisely the "separat agentrenderer"
 * `IMPLEMENTATION_PLAN.md` §44 forbids, and precisely the thing that would
 * quietly stop matching the editor. And measuring text without a shaper is how
 * a preview ends up disagreeing with the fit rules it is supposed to
 * illustrate.
 *
 * So the browser is the honest cost of visual parity: the same engine the
 * author's own browser is, running the same stylesheet over the same markup.
 * What Slaids owns is the part that keeps it robust rather than merely working
 * on one machine:
 *
 *  - **finding an executable.** Four candidates, in order of how specific they
 *    are, so a deployment can override and a serverless deployment needs no
 *    configuration at all. Nothing is downloaded at runtime.
 *  - **reusing it.** One browser per warm instance, re-launched when the
 *    previous one is gone. A serverless function that launched Chromium per
 *    request would spend most of its life launching Chromium.
 *  - **waiting for the right things.** The document's fonts, by name, with a
 *    deadline — and reporting honestly when they did not arrive, rather than
 *    photographing the fallback face and calling it the deck.
 *  - **failing legibly.** No executable is `PREVIEW_UNAVAILABLE`, which tells an
 *    agent to stop asking; anything else is `PREVIEW_FAILED`, which tells it to
 *    try again.
 */

import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import serverlessChromium from '@sparticuz/chromium'
import { SYMBOL_FALLBACK_WEB_FONT, webFontWeights } from '../domain/fonts'
import type { RasterImage, RasterRequest, SlideRasterizer } from './rasterize'
import { pngPixelSize } from './rasterize'

/**
 * Where to look for a Chromium, most specific first.
 *
 * `SLAIDS_CHROMIUM_EXECUTABLE` is the override a deployment or a test sets, and
 * it comes first so it is actually an override. `@sparticuz/chromium` is the
 * serverless answer — a Chromium build shipped inside the dependency and
 * inflated into the function's own `/tmp`, which is what makes this work on
 * Vercel with no extra configuration and no runtime download. The Playwright
 * variable is next because this repository's e2e suite already uses it for a
 * pre-installed browser, and the well-known paths are the ordinary developer
 * machine.
 */
export const CHROMIUM_EXECUTABLE_VAR = 'SLAIDS_CHROMIUM_EXECUTABLE'

const SYSTEM_CHROMIUM_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
] as const

/**
 * Flags for a Chromium that is not a user's browser.
 *
 * Only used when the executable did not come from `@sparticuz/chromium`, which
 * publishes its own list for the environment it is built for. The sandbox is
 * off because a serverless container and a CI container both lack the kernel
 * features it needs; nothing untrusted is loaded — the document is built by
 * this process and fetches only a font stylesheet.
 */
const PLAIN_CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--font-render-hinting=none',
] as const

/** No browser anywhere. A fact about the installation, not about the request. */
export class PreviewBrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreviewBrowserUnavailableError'
  }
}

export interface ChromiumRasterizerOptions {
  /** The process environment. A parameter so a test never has to mutate one. */
  env?: Record<string, string | undefined>
  /** How long to wait for the document to load. */
  loadTimeoutMs?: number
  /**
   * How long to wait for web fonts.
   *
   * The same eight seconds `src/ui/fonts.ts` waits in the browser, and for the
   * same reason: a font service that never answers must not turn one preview
   * into a hung request.
   */
  fontTimeoutMs?: number
}

const DEFAULT_LOAD_TIMEOUT_MS = 15_000
const DEFAULT_FONT_TIMEOUT_MS = 8_000

/**
 * A Chromium-backed rasterizer, with the browser shared between calls.
 *
 * The closure holds the browser rather than a module-level variable so two
 * rasterizers (a test's and the deployment's) cannot end up sharing one.
 */
export function chromiumRasterizer(options: ChromiumRasterizerOptions = {}): SlideRasterizer {
  const env = options.env ?? (process.env as Record<string, string | undefined>)
  const loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
  const fontTimeoutMs = options.fontTimeoutMs ?? DEFAULT_FONT_TIMEOUT_MS

  let launched: Browser | null = null
  let launching: Promise<Browser> | null = null

  async function browser(): Promise<Browser> {
    // `connected` is false for a browser that crashed or was reaped between two
    // invocations of a warm function, which is the case a cached handle has to
    // survive: the alternative is one dead handle poisoning every later request.
    if (launched?.connected) return launched
    if (!launching) {
      launching = launch(env).finally(() => {
        launching = null
      })
    }
    launched = await launching
    return launched
  }

  return async function rasterize(request: RasterRequest): Promise<RasterImage> {
    const page = await (await browser()).newPage()
    try {
      await page.setViewport({
        width: request.width,
        height: request.height,
        // The whole of the scaling. Layout happens at the logical size the
        // design space is defined in, and only the sampling density changes —
        // so a preview at half size is the same slide, not a stretched one.
        deviceScaleFactor: request.scale,
      })
      await page.setContent(request.html, { waitUntil: 'load', timeout: loadTimeoutMs })

      const fontsReady = await waitForFonts(page, request.fontFamilies, fontTimeoutMs)
      await settleImages(page)

      const shot = await page.screenshot({ type: 'png', captureBeyondViewport: false })
      const bytes = new Uint8Array(shot)
      const size = pngPixelSize(bytes)

      return {
        bytes,
        // What the file actually says, not what the arithmetic expected: a
        // preview that reports a size the picture does not have is worse than
        // no size at all, because an agent uses it to reason about the crop.
        width: size?.width ?? Math.round(request.width * request.scale),
        height: size?.height ?? Math.round(request.height * request.scale),
        fontsReady,
        warnings: fontsReady
          ? []
          : [
              `Webfontene (${request.fontFamilies.join(', ')}) var ikke klare da bildet ble tatt, så teksten er tegnet med reservefonten. Selve komposisjonen er riktig, men linjelengder kan avvike.`,
            ],
      }
    } finally {
      await page.close().catch(() => undefined)
    }
  }
}

/**
 * Wait for the faces, then say whether they are there.
 *
 * `document.fonts.load` is asked for each weight explicitly, exactly as
 * `src/ui/fonts.ts` does in the browser, because `fonts.ready` only settles the
 * loads the page happened to trigger — a slide with no bold text never requests
 * weight 700, and a check for it would then be false forever. Every authored
 * web-font stylesheet also carries `Noto Sans Symbols 2`; that face is checked
 * here too, but only at its real regular weight.
 *
 * The readiness answer is two questions, not one, and the second is the one
 * that is easy to miss. `document.fonts.check()` answers "is every face that
 * *matches* this font loaded" — so a family the document never defined at all
 * has no matching face, nothing is pending, and it answers **true**. Measured,
 * not assumed: a page whose only mention of a family is a `font-family`
 * declaration reports `check: true` with `document.fonts.size === 0`.
 *
 * That is exactly the state a failed stylesheet produces. When the process-side
 * fetch could not inline a family, the document falls back to linking it
 * (`fonts.ts`), and if that link fails too there are no `@font-face` rules —
 * Chromium then draws the fallback face while `check()` cheerfully agrees. So
 * the families are counted as well as checked, which covers every reason the
 * faces could be missing rather than only the one this file could observe.
 */
async function waitForFonts(page: Page, families: string[], timeoutMs: number): Promise<boolean> {
  if (families.length === 0) return true
  const names = [...new Set([...families, SYMBOL_FALLBACK_WEB_FONT])]
  const wanted = names.flatMap((name) =>
    webFontWeights(name).map((weight) => ({ name, spec: `${weight} 16px "${name}"` })),
  )
  return page.evaluate(
    async (faces: Array<{ name: string; spec: string }>, deadline: number) => {
      const loads = Promise.all(
        faces.map(({ spec }) => document.fonts.load(spec).catch(() => undefined)),
      ).then(() => document.fonts.ready)
      await Promise.race([loads, new Promise((resolve) => setTimeout(resolve, deadline))])

      // Chromium reports `FontFace.family` unquoted; the strip is for engines
      // that serialise the authored string instead.
      const declared = new Set(
        [...document.fonts].map((face) => face.family.replace(/^["']|["']$/g, '')),
      )
      return (
        faces.every(({ name }) => declared.has(name)) &&
        faces.every(({ spec }) => document.fonts.check(spec))
      )
    },
    wanted,
    timeoutMs,
  )
}

/**
 * Let the pictures finish.
 *
 * The `load` event already waits for them to *load*, and a `data:` URL cannot be
 * slow about it — but decoding is a separate step, and a screenshot taken
 * between the two catches an image that is present, sized and not yet painted.
 * `decode()` is what waits for that step.
 *
 * It is called for every image, including the ones that already report
 * `complete`. Skipping those was this function doing nothing at all: after
 * `waitUntil: 'load'` every image in a preview document is complete — measured,
 * not assumed — so the guard excluded precisely the images the call exists for.
 * A rejection is tolerated rather than fatal: a picture that cannot be decoded
 * is a broken slide, not a broken preview, and the picture should show it.
 */
async function settleImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)))
  })
}

async function launch(env: Record<string, string | undefined>): Promise<Browser> {
  const resolved = await resolveExecutable(env)
  try {
    return await puppeteer.launch({
      executablePath: resolved.executablePath,
      args: resolved.args,
      headless: true,
    })
  } catch (error) {
    throw new Error(
      `Kunne ikke starte Chromium fra ${resolved.executablePath}: ${messageOf(error)}`,
      { cause: error },
    )
  }
}

interface ResolvedExecutable {
  executablePath: string
  args: string[]
}

/**
 * The first candidate that exists, with the flags that belong to it.
 *
 * `@sparticuz/chromium` is asked for its own `args` because it is a build made
 * for a specific environment and knows what that environment needs; anything
 * else gets the plain list above. Guessing one set for both is how a browser
 * that launches locally fails to launch in a container.
 */
export async function resolveExecutable(
  env: Record<string, string | undefined>,
): Promise<ResolvedExecutable> {
  const override = env[CHROMIUM_EXECUTABLE_VAR]?.trim()
  if (override) {
    if (!(await isExecutable(override))) {
      throw new PreviewBrowserUnavailableError(
        `${CHROMIUM_EXECUTABLE_VAR} peker på ${override}, som ikke finnes eller ikke kan kjøres.`,
      )
    }
    return { executablePath: override, args: [...PLAIN_CHROMIUM_ARGS] }
  }

  const serverless = await serverlessExecutable()
  if (serverless) return serverless

  const playwright = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim()
  if (playwright && (await isExecutable(playwright))) {
    return { executablePath: playwright, args: [...PLAIN_CHROMIUM_ARGS] }
  }

  for (const candidate of SYSTEM_CHROMIUM_PATHS) {
    if (await isExecutable(candidate)) {
      return { executablePath: candidate, args: [...PLAIN_CHROMIUM_ARGS] }
    }
  }

  throw new PreviewBrowserUnavailableError(
    `Fant ingen Chromium å rendre med. Sett ${CHROMIUM_EXECUTABLE_VAR} til en Chromium-binær, eller installer @sparticuz/chromium (som er en vanlig avhengighet og normalt gjør dette unødvendig).`,
  )
}

/**
 * The bundled serverless build, inflated on first use.
 *
 * Memoised because inflating tens of megabytes into `/tmp` is not something to
 * do per request, and swallowed on failure because this is a *candidate*: a
 * machine the build does not support should fall through to the next one rather
 * than fail the whole resolution.
 */
let serverlessResolved: Promise<ResolvedExecutable | null> | null = null

function serverlessExecutable(): Promise<ResolvedExecutable | null> {
  if (!serverlessResolved) {
    serverlessResolved = serverlessChromium
      .executablePath()
      .then(async (path) =>
        path && (await isExecutable(path))
          ? { executablePath: path, args: [...serverlessChromium.args] }
          : null,
      )
      .catch(() => null)
  }
  return serverlessResolved
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'ukjent feil'
}
