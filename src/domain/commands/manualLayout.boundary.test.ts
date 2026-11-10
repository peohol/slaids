/**
 * The hand-made geometry commands stay in the editor's hands.
 *
 * `manualLayout.ts` is the one way a zone can be stored smaller than its
 * content needs at normal size, and the rule is that only a person's own drag
 * or size button can take it: an agent asked to do the same is refused. That
 * rule is only as good as the module graph, and an import that crossed it
 * would compile, pass every other test and quietly hand an agent operation the
 * way around the fit guard. So it is checked here, mechanically.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as commands from './index'
import * as manual from './manualLayout'

const ROOT = join(process.cwd(), 'src')
/** The only part of the app that may resize a zone by hand: the editor's UI. */
const ALLOWED = [join(ROOT, 'ui', 'editor')]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [full] : []
  })
}

function importsManualLayout(file: string): boolean {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/\bfrom\s+'([^']+)'/g)].some((match) => /(^|\/)manualLayout$/.test(match[1]))
}

describe('menneskelig soneredigering', () => {
  it('importeres bare av editorens grensesnitt', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter(importsManualLayout)
      .filter((file) => !ALLOWED.some((directory) => file.startsWith(directory + '/')))
      .map((file) => relative(process.cwd(), file))
    expect(offenders).toEqual([])
  })

  it('er ikke en del av kommandoflaten Agent Core og API-ene bygger på', () => {
    const exported = Object.keys(manual)
    expect(exported.length).toBeGreaterThan(0)
    expect(Object.keys(commands).filter((name) => exported.includes(name))).toEqual([])
  })

  it('er faktisk i bruk der den er tillatt, så testen over vokter noe', () => {
    const users = sourceFiles(ALLOWED[0]).filter((file) => !/\.test\.tsx?$/.test(file)).filter(importsManualLayout)
    expect(users.length).toBeGreaterThan(0)
  })
})
