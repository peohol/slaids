// @vitest-environment node
/**
 * The driver and the browser have to be the same Chromium.
 *
 * `puppeteer-core` speaks the Chrome DevTools Protocol, and each release is
 * built against one specific Chrome build — `PUPPETEER_REVISIONS.chrome`.
 * `@sparticuz/chromium` ships an actual Chromium, and its version *is* the
 * Chromium version (its own README: `MajorChromiumVersion.MinorChromiumIncrement
 * .PatchLevel`, explicitly **not** semver, breaking changes at the patch level).
 * Nothing in either package checks the other, and a mismatch does not fail at
 * install, at build, or at launch — it fails later, on whichever CDP command the
 * two versions disagree about, in production, on one code path.
 *
 * That drift already happened once here: `puppeteer-core@25.10.0` (Chrome 152)
 * was installed against `@sparticuz/chromium@149`, three majors apart, and every
 * test passed. So the pairing is pinned rather than ranged, and checked here
 * rather than assumed.
 *
 * Four links, and the chain is only worth as much as its ends:
 *
 *   package.json pins → the driver's target → the shipped package → the binary
 *
 * The last one is the one that cannot be argued with: the browser is asked what
 * it is. The first is what stops `npm install` from quietly changing any of the
 * others — a caret on a package that does not follow semver is an invitation.
 *
 * Deliberately a dependency test rather than a runtime check. Production code
 * reading `PUPPETEER_REVISIONS` — which Puppeteer marks `@internal` and does not
 * publish types for — would be building the preview on something that can move
 * without notice. A test may read it, because a test that stops being able to is
 * supposed to fail.
 */

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import serverlessChromium from '@sparticuz/chromium'

const run = promisify(execFile)

/**
 * The Chromium major this repository is wired for, and the driver that speaks
 * it.
 *
 * To move it: pick the `@sparticuz/chromium` major you want, look up the
 * `puppeteer-core` release whose `PUPPETEER_REVISIONS.chrome` has that same
 * major (https://pptr.dev/chromium-support), pin both, and change these two
 * lines. Every assertion below then re-derives the pairing from the packages
 * themselves, so a wrong guess here does not pass.
 */
const CHROMIUM_MAJOR = 149
const PUPPETEER_CORE_VERSION = '25.1.0'

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
}

/** An exact version: no caret, no tilde, no range. */
const EXACT = /^\d+\.\d+\.\d+$/

/** Chrome's own four-part build number, as `PUPPETEER_REVISIONS` states it. */
const CHROME_BUILD = /^\d+\.\d+\.\d+\.\d+$/

function majorOf(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10)
}

/**
 * The Chrome build this `puppeteer-core` was made for.
 *
 * Exported at runtime from the package's public entry point, though not in its
 * published types — hence the read-and-validate rather than an import with a
 * cast. If it ever stops being there, this throws with something to act on,
 * which is the whole point: a guard that cannot verify must not pass.
 */
async function puppeteerTargetChrome(): Promise<string> {
  const module = (await import('puppeteer-core')) as unknown as {
    PUPPETEER_REVISIONS?: { chrome?: unknown }
  }
  const chrome = module.PUPPETEER_REVISIONS?.chrome
  if (typeof chrome !== 'string' || !CHROME_BUILD.test(chrome)) {
    throw new Error(
      'Fant ikke PUPPETEER_REVISIONS.chrome i puppeteer-core. Den er `@internal`, ' +
        'så den kan ha flyttet seg: finn hvilken Chrome-versjon denne puppeteer-core ' +
        'er bygget mot, og oppdater denne testen — ikke fjern den.',
    )
  }
  return chrome
}

describe('nettleseren og driveren er den samme Chromium', () => {
  it('pinner begge eksakt, uten område', () => {
    // `@sparticuz/chromium` says outright that it does not follow semver, so a
    // caret is a licence to swap the browser under the driver. `puppeteer-core`
    // does follow semver, and that is exactly the problem: a minor bump moves it
    // to the next Chrome.
    expect(packageJson.dependencies['@sparticuz/chromium']).toMatch(EXACT)
    expect(packageJson.dependencies['puppeteer-core']).toMatch(EXACT)
    expect(packageJson.dependencies['puppeteer-core']).toBe(PUPPETEER_CORE_VERSION)
    expect(majorOf(packageJson.dependencies['@sparticuz/chromium'])).toBe(CHROMIUM_MAJOR)
  })

  it('driveren er bygget mot den samme majoren som nettleseren', async () => {
    const target = await puppeteerTargetChrome()

    // The assertion that matters: three majors apart is what shipped before, and
    // it looked exactly like this line passing would have looked.
    expect(majorOf(target)).toBe(CHROMIUM_MAJOR)
  })

  it('den faktiske binæren er den majoren også', async () => {
    // Not a version string about a browser — the browser. The package's version
    // schema *claims* to be the Chromium version; this is that claim checked.
    //
    // One caveat worth knowing rather than guarding: `executablePath()` returns
    // an already-inflated `/tmp/chromium` if one is there, so a machine that
    // changed versions without clearing `/tmp` reads the old binary. On the
    // platform this ships to every instance starts with an empty `/tmp`, and
    // locally `rm /tmp/chromium` is the fix.
    const executable = await serverlessChromium.executablePath()
    const { stdout } = await run(executable, ['--version'])

    const reported = /(\d+)\.\d+\.\d+/.exec(stdout)
    if (!reported) throw new Error(`Chromium svarte «${stdout.trim()}», uten et versjonsnummer.`)
    expect(Number(reported[1])).toBe(CHROMIUM_MAJOR)
  }, 120_000)
})
