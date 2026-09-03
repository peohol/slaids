/**
 * The server layer stays on the server.
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
 */

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src')
const SERVER_DIR = join(ROOT, 'server')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [full] : []
  })
}

/** Every module specifier a file imports or re-exports. */
function specifiersIn(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1])
}

describe('grensen mellom app og server', () => {
  it('importeres aldri fra resten av src/', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => !file.startsWith(SERVER_DIR))
      .filter((file) => specifiersIn(file).some((specifier) => /(^|\/)server\//.test(specifier)))
      .map((file) => relative(process.cwd(), file))

    expect(offenders).toEqual([])
  })

  it('finnes i det hele tatt, så testen over ikke er tom', () => {
    expect(sourceFiles(SERVER_DIR).length).toBeGreaterThan(0)
  })

  it('importerer ikke React eller noe annet fra UI-laget', () => {
    // A server file that reached into `src/ui` would be a server file that
    // needs a DOM, which is the shape of every "works locally, 500 in
    // production" bug this layer could have.
    const offenders = sourceFiles(SERVER_DIR)
      .filter((file) =>
        specifiersIn(file).some(
          (specifier) => specifier === 'react' || /(^|\/)ui\//.test(specifier),
        ),
      )
      .map((file) => relative(process.cwd(), file))

    expect(offenders).toEqual([])
  })
})
