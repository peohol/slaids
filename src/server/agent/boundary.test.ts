/**
 * The server layer stays on the server, and the browser stays out of the app.
 *
 * `src/server/` holds code that runs with a key that bypasses row level
 * security. It is never imported by the app, and the reason to check that
 * mechanically rather than by habit is that the failure is silent: an import
 * from a UI file would compile, pass every test, and quietly pull the API's
 * internals — its status table, its token rules, its whole operation registry —
 * into the bundle every visitor downloads.
 *
 * The dependency goes the other way and only the other way: the server imports
 * the domain, the persistence layer and Agent Core, because those are the same
 * rules the editor runs under.
 *
 * `src/render/` is the one deliberate hole in that wall, and this file is where
 * the hole is nailed to a fixed size. A rendered preview has to be drawn by
 * Slaids' own renderer (`IMPLEMENTATION_PLAN.md` §44, phase 5), which means
 * React, the app's stylesheets and a real browser — everything the rest of
 * `src/server/` is forbidden to touch. So the dependency exists, in exactly one
 * file, at the deployment seam where every other injection also becomes real;
 * and it points one way, because `src/render/` is server-only too. A UI import
 * of it would put `puppeteer-core` in the browser bundle.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src')
const SERVER_DIR = join(ROOT, 'server')
const RENDER_DIR = join(ROOT, 'render')

/**
 * The one file allowed to join the two, and it is the deployment seam.
 *
 * Named rather than pattern-matched: a rule that says "some file in
 * `src/server/`" is a rule that grows a second such file without anybody
 * noticing, and then the browser dependency is spread across the layer that was
 * built not to have one.
 */
const PREVIEW_SEAM = join(SERVER_DIR, 'agent', 'index.ts')

/** Packages that only exist to drive a real browser. */
const BROWSER_PACKAGES = ['puppeteer-core', '@sparticuz/chromium']

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [full] : []
  })
}

/**
 * The files that end up in something somebody downloads or deploys.
 *
 * Both rules below are about a *bundle*: the browser's, which must not contain
 * the API's internals, and the browser's again, which must not contain a
 * browser driver. A test file is in neither — nothing imports it, so it is not
 * in any module graph a bundler walks — and a test that reaches across the
 * boundary is how the boundary gets checked in the first place. So the rules
 * exclude them, and stay sharp for everything that ships.
 */
function shipped(files: string[]): string[] {
  return files.filter((file) => !/\.test\.tsx?$/.test(file))
}

/** Every module specifier a file imports or re-exports. */
function specifiersIn(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1])
}

function relativeNames(files: string[]): string[] {
  return files.map((file) => relative(process.cwd(), file))
}

describe('grensen mellom app og server', () => {
  it('importeres aldri fra resten av src/', () => {
    const offenders = shipped(sourceFiles(ROOT))
      .filter((file) => !file.startsWith(SERVER_DIR))
      .filter((file) => specifiersIn(file).some((specifier) => /(^|\/)server\//.test(specifier)))

    expect(relativeNames(offenders)).toEqual([])
  })

  it('finnes i det hele tatt, så testen over ikke er tom', () => {
    expect(sourceFiles(SERVER_DIR).length).toBeGreaterThan(0)
  })

  it('importerer ikke React eller noe annet fra UI-laget', () => {
    // A server file that reached into `src/ui` would be a server file that
    // needs a DOM, which is the shape of every "works locally, 500 in
    // production" bug this layer could have. The preview needs exactly that,
    // which is why it lives behind `src/render/` and is checked separately
    // below rather than let through here.
    const offenders = shipped(sourceFiles(SERVER_DIR)).filter((file) =>
      specifiersIn(file).some(
        (specifier) =>
          specifier === 'react' ||
          specifier === 'react-dom' ||
          specifier.startsWith('react-dom/') ||
          /(^|\/)ui\//.test(specifier),
      ),
    )

    expect(relativeNames(offenders)).toEqual([])
  })
})

describe('previewrendereren', () => {
  it('trekkes inn i serverlaget fra nøyaktig én fil', () => {
    const offenders = shipped(sourceFiles(SERVER_DIR))
      .filter((file) => file !== PREVIEW_SEAM)
      .filter((file) => specifiersIn(file).some((specifier) => /(^|\/)render\//.test(specifier)))

    expect(relativeNames(offenders)).toEqual([])
  })

  it('trekkes faktisk inn der, så regelen over ikke er tom', () => {
    expect(specifiersIn(PREVIEW_SEAM).some((specifier) => /(^|\/)render\//.test(specifier))).toBe(
      true,
    )
  })

  it('importeres aldri av appen', () => {
    // The browser already has the real thing on screen. An import from the UI
    // would be a `puppeteer-core` in the bundle every visitor downloads, which
    // is the same silent failure as the rule above, in the other direction.
    const offenders = shipped(sourceFiles(ROOT))
      .filter((file) => !file.startsWith(RENDER_DIR) && !file.startsWith(SERVER_DIR))
      .filter((file) => specifiersIn(file).some((specifier) => /(^|\/)render\//.test(specifier)))

    expect(relativeNames(offenders)).toEqual([])
  })

  it('er det eneste stedet en nettleser importeres', () => {
    const offenders = shipped(sourceFiles(ROOT))
      .filter((file) => !file.startsWith(RENDER_DIR))
      .filter((file) =>
        specifiersIn(file).some((specifier) => BROWSER_PACKAGES.includes(specifier)),
      )

    expect(relativeNames(offenders)).toEqual([])
  })

  it('importerer dem, så testen over ikke er tom', () => {
    const importing = sourceFiles(RENDER_DIR).filter((file) =>
      specifiersIn(file).some((specifier) => BROWSER_PACKAGES.includes(specifier)),
    )

    expect(importing.length).toBeGreaterThan(0)
  })
})
