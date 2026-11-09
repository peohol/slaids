/**
 * `scripts/vercel-ignore-build.sh` against a real Git repository.
 *
 * The rule: a production build runs only when its commit is not older than
 * the branch's last successful deployment (`VERCEL_GIT_PREVIOUS_SHA`), so a
 * late, older build can never replace a newer one on the live domains. On
 * Vercel the clone is shallow and the repository private, so a previous
 * deployment missing from the history counts as newer. Previews and a
 * branch's first deployment always build.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, 'scripts', 'vercel-ignore-build.sh')
const MISSING = 'f'.repeat(40)

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Slaids',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Slaids',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

let repo = ''
/** Three commits on one line of history, oldest first. */
const commits: string[] = []

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
    encoding: 'utf8',
  }).trim()
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'vercel-ignore-'))
  git('init', '-q')
  for (const name of ['first', 'second', 'third']) {
    git('commit', '-q', '--allow-empty', '-m', name)
    commits.push(git('rev-parse', 'HEAD'))
  }
})

afterAll(() => rmSync(repo, { recursive: true, force: true }))

/** Runs the guard for `head`; true when the build goes ahead. */
function builds(env: Record<string, string>): boolean {
  const head = env.VERCEL_GIT_COMMIT_SHA
  if (head && head !== MISSING) git('checkout', '-q', head)
  try {
    execFileSync('sh', [SCRIPT], {
      cwd: repo,
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: 'pipe',
    })
    return false
  } catch (error) {
    return (error as { status: number }).status === 1
  }
}

function production(head: string, previous: string, extra: Record<string, string> = {}) {
  return builds({
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_SHA: head,
    VERCEL_GIT_PREVIOUS_SHA: previous,
    ...extra,
  })
}

describe('Vercels byggevakt for produksjon', () => {
  it('bygger en commit som er nyere enn forrige produksjonsbygg', () => {
    expect(production(commits[2], commits[1])).toBe(true)
    expect(production(commits[2], commits[0])).toBe(true)
  })

  it('hopper over en commit som er eldre enn forrige produksjonsbygg', () => {
    expect(production(commits[1], commits[2])).toBe(false)
    expect(production(commits[0], commits[2])).toBe(false)
  })

  it('hopper over når forrige produksjonsbygg ikke finnes i historikken (nyere enn klonen)', () => {
    expect(production(commits[2], MISSING)).toBe(false)
  })

  it('bygger samme commit på nytt, og bygger første gang uten forrige bygg', () => {
    expect(production(commits[2], commits[2])).toBe(true)
    expect(production(commits[2], '')).toBe(true)
  })

  it('kan overstyres for ett bygg når produksjonen har falt for langt bak', () => {
    expect(production(commits[2], MISSING, { SLAIDS_ALLOW_OLDER_BUILD: '1' })).toBe(true)
  })

  it.each(['preview', 'development'])('bygger alltid %s', (env) => {
    expect(
      builds({ VERCEL_ENV: env, VERCEL_GIT_COMMIT_SHA: commits[0], VERCEL_GIT_PREVIOUS_SHA: commits[2] }),
    ).toBe(true)
  })

  it('er koblet inn som Vercels ignoreCommand', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      ignoreCommand?: string
    }
    expect(config.ignoreCommand).toBe('sh scripts/vercel-ignore-build.sh')
  })
})
