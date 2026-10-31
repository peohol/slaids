// @vitest-environment node
/**
 * The pull-request browser check, held to what `docs/E2E_CI.md` says it is.
 *
 * The `@pr` tags in the specs are the selection; the workflow runs exactly
 * them, and the document lists the files they are in so a reviewer can see
 * what a green check covers. Those three drift apart silently, so this reads
 * all of them and fails when they disagree.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const read = (path: string) => readFileSync(root(path), 'utf8')

const PR_TAG = '@pr'

function taggedSpecs(): string[] {
  return readdirSync(root('e2e'))
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) => read(`e2e/${name}`).includes(`tag: '${PR_TAG}'`))
    .sort()
}

function documentedSpecs(): string[] {
  const doc = read('docs/E2E_CI.md')
  const table = /<!-- e2e-pr-files:start -->([\s\S]*?)<!-- e2e-pr-files:end -->/.exec(doc)
  if (!table) throw new Error('docs/E2E_CI.md mangler tabellen over PR-utvalget.')
  return [...table[1].matchAll(/^\| `([^`]+\.spec\.ts)` \|/gm)].map((match) => match[1]).sort()
}

describe('PR-utvalget av nettlesertestene', () => {
  it('dokumentet nevner nøyaktig filene som har tester merket @pr', () => {
    expect(taggedSpecs().length).toBeGreaterThan(0)
    expect(documentedSpecs()).toEqual(taggedSpecs())
  })

  it('arbeidsflyten kjører utvalget med samme tag', () => {
    expect(read('.github/workflows/e2e.yml')).toContain(`--grep ${PR_TAG}`)
  })
})
