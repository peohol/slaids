/**
 * `scripts/vercel-ignore-build.sh`, with `git` replaced by a shim.
 *
 * The rule: a production build runs only while its commit is still the tip of
 * its branch, so a late, older build can never replace a newer one on the live
 * domains. Previews always build, and when the tip cannot be read the build
 * runs as it would without the guard.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, 'scripts', 'vercel-ignore-build.sh')
const TIP = 'c9787aabdf8dddf2edab9e0be53df3566c656439'
const OLDER = '65b8da4e8470838da859d1cd6e9fabc3d97ccca5'

let workspace: string | null = null

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true })
  workspace = null
})

/** Runs the guard. `remoteTip` is what `git ls-remote` reports; null = unreachable. */
function run(env: Record<string, string>, remoteTip: string | null) {
  workspace = mkdtempSync(join(tmpdir(), 'vercel-ignore-'))
  const calls = join(workspace, 'calls')
  const shim = join(workspace, 'git')
  writeFileSync(
    shim,
    [
      '#!/bin/sh',
      `echo "$@" >> "${calls}"`,
      remoteTip === null ? 'exit 128' : `printf '%s\\trefs/heads/main\\n' "${remoteTip}"`,
    ].join('\n'),
  )
  chmodSync(shim, 0o755)
  let status = 0
  try {
    execFileSync('sh', [SCRIPT], {
      env: {
        PATH: `${workspace}:${process.env.PATH ?? ''}`,
        VERCEL_GIT_REPO_OWNER: 'peohol',
        VERCEL_GIT_REPO_SLUG: 'slaids',
        VERCEL_GIT_COMMIT_REF: 'main',
        ...env,
      },
      stdio: 'pipe',
    })
  } catch (error) {
    status = (error as { status: number }).status
  }
  let gitCalls = ''
  try {
    gitCalls = readFileSync(calls, 'utf8')
  } catch {
    // git was never called
  }
  return { build: status !== 0, gitCalls }
}

describe('Vercels byggevakt for produksjon', () => {
  it('bygger produksjon når committen er tuppen av grenen', () => {
    const result = run({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: TIP }, TIP)
    expect(result.build).toBe(true)
    expect(result.gitCalls).toContain('ls-remote https://github.com/peohol/slaids.git refs/heads/main')
  })

  it('hopper over et eldre produksjonsbygg som kommer for sent', () => {
    expect(run({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: OLDER }, TIP).build).toBe(false)
  })

  it('bygger som før når tuppen ikke kan leses', () => {
    expect(run({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: OLDER }, null).build).toBe(true)
  })

  it.each(['preview', 'development'])('bygger alltid %s uten å spørre GitHub', (env) => {
    const result = run({ VERCEL_ENV: env, VERCEL_GIT_COMMIT_SHA: OLDER }, TIP)
    expect(result.build).toBe(true)
    expect(result.gitCalls).toBe('')
  })

  it('er koblet inn som Vercels ignoreCommand', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      ignoreCommand?: string
    }
    expect(config.ignoreCommand).toBe('sh scripts/vercel-ignore-build.sh')
  })
})
