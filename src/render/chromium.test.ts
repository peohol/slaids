// @vitest-environment node
/**
 * The rasterizer: finding a browser, and telling the truth about what it drew.
 *
 * The resolution order is the part of this subsystem most likely to be wrong in
 * exactly one environment, so it is checked as a value rather than observed in
 * production: an override that is actually an override, the bundled serverless
 * build next, and a legible refusal at the end rather than a stack trace from
 * inside a launcher.
 *
 * Then the one claim a rasterizer makes that is not visible in its output:
 * `fontsReady`. A preview drawn in the fallback face is still worth looking at
 * for composition, but an agent judging whether a line is too long has to know
 * the glyphs are not the deck's. Getting that wrong is silent, which is why it
 * is measured here against a real browser rather than reasoned about.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../domain/constants'
import {
  CHROMIUM_EXECUTABLE_VAR,
  PreviewBrowserUnavailableError,
  chromiumRasterizer,
  resolveExecutable,
} from './chromium'
import { pngPixelSize } from './rasterize'

/** Something that exists and is executable on any POSIX machine. */
const REAL_EXECUTABLE = '/bin/sh'

describe('hvilken Chromium som brukes', () => {
  it('lar variabelen overstyre alt annet', async () => {
    const resolved = await resolveExecutable({ [CHROMIUM_EXECUTABLE_VAR]: REAL_EXECUTABLE })

    expect(resolved.executablePath).toBe(REAL_EXECUTABLE)
    // A browser that is not the serverless build gets the plain flag list: its
    // own is written for the environment it was built for.
    expect(resolved.args).toContain('--no-sandbox')
    expect(resolved.args).not.toContain('--single-process')
  })

  it('sier tydelig fra når variabelen peker på noe som ikke finnes', async () => {
    // An override that silently fell through to the next candidate would render
    // with a browser nobody asked for, which is worse than not rendering.
    await expect(
      resolveExecutable({ [CHROMIUM_EXECUTABLE_VAR]: '/finnes/ikke/chromium' }),
    ).rejects.toThrow(PreviewBrowserUnavailableError)
  })

  it('finner den innebygde serverless-buildet uten noen konfigurasjon', async () => {
    // `@sparticuz/chromium` is an ordinary dependency, and this is what makes
    // the preview work on Vercel with nothing set: the same path production
    // takes, taken here.
    const resolved = await resolveExecutable({})

    expect(resolved.executablePath.length).toBeGreaterThan(0)
    // Its own flag list, not ours.
    expect(resolved.args).toContain('--single-process')
  })
})

/* ------------------------------------------------------------------ *
 * What the picture is actually drawn with
 * ------------------------------------------------------------------ */

const BROWSER_TIMEOUT_MS = 180_000
const rasterize = chromiumRasterizer()

/** A page that mentions a family and defines no face for it. */
function documentFor(family: string, faceCss = ''): string {
  return `<!doctype html><html><head><style>
${faceCss}
html, body { margin: 0; width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; background: #fff; }
p { font-family: '${family}', sans-serif; font-size: 40px; }
</style></head><body><p>Slaids</p></body></html>`
}

afterAll(async () => {
  // The rasterizer holds a browser for the life of the closure.
  await rasterize({
    html: '<!doctype html><html><body></body></html>',
    width: 1,
    height: 1,
    scale: 1,
    fontFamilies: [],
  }).catch(() => undefined)
})

describe('fontsReady sier hva bildet faktisk er tegnet med', () => {
  // Every family reaching the rasterizer comes from `webFontsFor`, so it always
  // arrives as an `@font-face`. A system stack contributes no families at all —
  // which is what makes counting declared faces the right question here, and
  // why the empty case answers immediately.

  it(
    'er usant når familien ikke er definert i det hele tatt',
    async () => {
      // The regression this exists for: `document.fonts.check()` answers `true`
      // for a family with no `@font-face` — nothing matches, so nothing is
      // pending. A preview drawn in the fallback face would otherwise have
      // reported `fontsReady: true`, which is the one thing it must not say.
      const raster = await rasterize({
        html: documentFor('SlaidsFinnesIkke'),
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        scale: 0.25,
        fontFamilies: ['SlaidsFinnesIkke'],
      })

      expect(raster.fontsReady).toBe(false)
      expect(raster.warnings[0]).toContain('SlaidsFinnesIkke')
      // And it still drew something: a missing face is a caveat, not a failure.
      expect(pngPixelSize(raster.bytes)).toEqual({ width: 400, height: 225 })
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'er usant når familien er deklarert, men filen ikke lot seg laste',
    async () => {
      // The other half of the answer, and the reason it is two questions rather
      // than one swapped for the other: here the family *is* declared, so
      // counting faces alone would say yes. `check()` is what says no.
      const raster = await rasterize({
        html: documentFor(
          'SlaidsØdelagt',
          "@font-face { font-family: 'SlaidsØdelagt'; src: url(data:font/woff2;base64,AAAA) format('woff2'); }",
        ),
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        scale: 0.25,
        fontFamilies: ['SlaidsØdelagt'],
      })

      expect(raster.fontsReady).toBe(false)
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'er sant uten å vente på noe når temaet ikke bruker webfonter',
    async () => {
      const raster = await rasterize({
        html: documentFor('Arial'),
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        scale: 0.25,
        fontFamilies: [],
      })

      expect(raster.fontsReady).toBe(true)
      expect(raster.warnings).toEqual([])
    },
    BROWSER_TIMEOUT_MS,
  )
})
