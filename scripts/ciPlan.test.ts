// @vitest-environment node
/**
 * `scripts/ci-plan.mjs`: når en CI-kjøring kan vise til en kontroll som
 * allerede er gjort, og når den ikke kan det.
 *
 * Regelen er asymmetrisk med vilje. Å kjøre en kontroll én gang for mye koster
 * minutter; å hoppe over en som trengtes, slipper utestet kode inn på `main`.
 * Testene under holder derfor hver snarvei til nøyaktig sitt tilfelle, og
 * sjekker at alt annet kjører.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decide,
  isMarkdownOnly,
  testedTreeArtifact,
  trustedMarker,
  type MarkerArtifact,
  type PlanFacts,
} from './ci-plan.mjs'

const SCRIPT = join(process.cwd(), 'scripts', 'ci-plan.mjs')
const REPO_ID = 42

function marker(overrides: Partial<MarkerArtifact> = {}): MarkerArtifact {
  return {
    name: testedTreeArtifact('abc'),
    expired: false,
    workflow_run: { id: 7, repository_id: REPO_ID, head_repository_id: REPO_ID },
    ...overrides,
  }
}

function facts(overrides: Partial<PlanFacts>): PlanFacts {
  return {
    workflow: 'tester',
    event: 'pull_request',
    markdownOnly: false,
    testedMarker: null,
    passedNightly: null,
    ...overrides,
  }
}

const NIGHT = { id: 9, html_url: 'https://github.com/x/y/actions/runs/9' }

describe('isMarkdownOnly', () => {
  it('gjelder bare når hver endret fil er Markdown', () => {
    expect(isMarkdownOnly(['README.md', 'docs/E2E_CI.md'], [])).toBe(true)
    expect(isMarkdownOnly(['README.md', 'src/app.ts'], [])).toBe(false)
    expect(isMarkdownOnly(['docs/bilde.png'], [])).toBe(false)
  })

  it('gjelder ikke en tom endring', () => {
    expect(isMarkdownOnly([], [])).toBe(false)
  })

  it('gjelder ikke når kode importerer Markdown', () => {
    expect(isMarkdownOnly(['docs/a.md'], ['src/help.ts'])).toBe(false)
  })
})

describe('trustedMarker', () => {
  it('godtar en markør fra en kjøring i dette repoet', () => {
    expect(trustedMarker([marker()], REPO_ID)).not.toBeNull()
  })

  it('godtar ikke en markør fra en fork eller et annet repo', () => {
    const fork = marker({ workflow_run: { id: 7, repository_id: REPO_ID, head_repository_id: 99 } })
    const other = marker({ workflow_run: { id: 7, repository_id: 99, head_repository_id: 99 } })
    expect(trustedMarker([fork, other], REPO_ID)).toBeNull()
  })

  it('godtar ikke en utløpt markør eller en uten kjøring', () => {
    expect(trustedMarker([marker({ expired: true }), marker({ workflow_run: null })], REPO_ID)).toBeNull()
  })
})

describe('decide', () => {
  it('hopper over et push som allerede er testet i en PR', () => {
    expect(decide(facts({ event: 'push', testedMarker: marker() })).run).toBe(false)
  })

  it('tester et push som ikke er testet', () => {
    expect(decide(facts({ event: 'push' })).run).toBe(true)
  })

  it('tester alltid en PR i «Tester», også når den bare endrer Markdown', () => {
    expect(decide(facts({ markdownOnly: true, testedMarker: marker() })).run).toBe(true)
  })

  it('hopper over en natt der hele suiten allerede har bestått på commiten', () => {
    const decision = decide(facts({ workflow: 'nettlesertester', event: 'schedule', passedNightly: NIGHT }))
    expect(decision.run).toBe(false)
    expect(decision.reason).toContain(NIGHT.html_url)
  })

  it('kjører en natt uten en bestått kjøring av samme commit', () => {
    expect(decide(facts({ workflow: 'nettlesertester', event: 'schedule' })).run).toBe(true)
  })

  it('hopper over nettlesertestene for en PR med bare Markdown', () => {
    expect(decide(facts({ workflow: 'nettlesertester', markdownOnly: true })).run).toBe(false)
    expect(decide(facts({ workflow: 'nettlesertester' })).run).toBe(true)
  })

  it('kjører alltid en kjøring startet for hånd', () => {
    const manual = facts({
      workflow: 'nettlesertester',
      event: 'workflow_dispatch',
      markdownOnly: true,
      passedNightly: NIGHT,
    })
    expect(decide(manual).run).toBe(true)
  })
})

/**
 * Hele skriptet mot et ekte Git-repo, slik en PR-kjøring ser det: HEAD er en
 * flettecommit, og forelderen er `main`.
 */
describe('skriptet på en PR', () => {
  let repo = ''

  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true })
    repo = ''
  })

  function git(...args: string[]) {
    execFileSync('git', args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Slaids',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Slaids',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    })
  }

  function write(path: string, content: string) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), content)
  }

  /**
   * Lager `main` med `base`, og en PR som endrer `change` og omdøper filene i
   * `renames`. Svarer `kjor`.
   */
  function plan(
    base: Record<string, string>,
    change: Record<string, string>,
    renames: Record<string, string> = {},
  ): string {
    repo = mkdtempSync(join(tmpdir(), 'slaids-ci-plan-'))
    git('init', '-q', '-b', 'main')
    for (const [path, content] of Object.entries(base)) write(path, content)
    git('add', '-A')
    git('commit', '-q', '-m', 'main')
    git('checkout', '-q', '-b', 'pr')
    for (const [path, content] of Object.entries(change)) write(path, content)
    for (const [from, to] of Object.entries(renames)) git('mv', from, to)
    git('add', '-A')
    git('commit', '-q', '-m', 'pr')
    git('checkout', '-q', 'main')
    git('merge', '-q', '--no-ff', '-m', 'flett', 'pr')

    const output = join(repo, '.output')
    execFileSync('node', [SCRIPT, 'nettlesertester'], {
      cwd: repo,
      env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '' },
    })
    return /kjor=(\w+)/.exec(readFileSync(output, 'utf8'))?.[1] ?? ''
  }

  const BASE = { 'README.md': '# Slaids\n', 'src/app.ts': 'export const app = 1\n' }

  it('hopper over nettlesertestene når bare Markdown er endret', () => {
    expect(plan(BASE, { 'README.md': '# Slaids, endret\n' })).toBe('false')
  })

  it('kjører når kode er endret', () => {
    expect(plan(BASE, { 'README.md': '# Ny\n', 'src/app.ts': 'export const app = 2\n' })).toBe('true')
  })

  it('kjører når en kodefil omdøpes til Markdown', () => {
    expect(plan(BASE, {}, { 'src/app.ts': 'src/app.md' })).toBe('true')
  })

  it('kjører når kode importerer Markdown, også bare for å lese den som tekst', () => {
    const base = { ...BASE, 'src/help.ts': "import doc from '../docs/hjelp.md?raw'\nexport default doc\n" }
    expect(plan(base, { 'docs/hjelp.md': 'Ny hjelp\n' })).toBe('true')
  })
})
