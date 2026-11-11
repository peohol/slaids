/**
 * Det en person gjør, blir i appens grensesnitt.
 *
 * `manualLayout.ts` er veien rundt fit-sjekken: en person får lov til å gjøre
 * innholdet for stort for plassen (det tegnes mindre), en agent blir avvist.
 * Regelen er ikke bedre enn modulgrafen, og en import som krysset den, ville
 * kompilert, bestått alle andre tester og stille gitt en agentoperasjon veien
 * rundt fit-sjekken. Derfor kontrolleres den her, mekanisk.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as commands from './index'
import * as manual from './manualLayout'

const ROOT = join(process.cwd(), 'src')
/** Den eneste delen av appen der en person handler selv: grensesnittet. */
const ALLOWED = [join(ROOT, 'ui')]

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

describe('menneskelige endringer', () => {
  it('importeres bare av appens grensesnitt', () => {
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
