/**
 * `scripts/deploy-migrations.sh`, with the database replaced by a recorder.
 *
 * The invariant under test is small and easy to lose: **`--dry-run` changes
 * nothing.** It is the kind of promise that decays quietly — someone adds a
 * bootstrap step, puts it before the early exit, and the flag keeps printing
 * "nothing was run" while having already created a table. That is exactly what
 * happened once, which is why it is pinned here.
 *
 * No Postgres is needed. A `psql` shim earlier on `PATH` records every
 * statement the script asks for, so the test can assert on the SQL itself —
 * which is where the promise actually lives.
 */

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// Vitest runs from the repo root; `import.meta.url` is not a file URL under the
// jsdom environment this suite shares with the rest.
const SCRIPT = join(process.cwd(), 'scripts', 'deploy-migrations.sh')

/** Anything that could change the database. Deliberately broad. */
const MUTATING = /\b(create|alter|drop|grant|revoke|insert|update|delete|truncate|comment on)\b/i

let workspace: string | null = null

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true })
  workspace = null
})

interface Run {
  status: number
  stdout: string
  /** Every statement the script handed to psql, in order. */
  sql: string[]
}

/**
 * Run the script with a fake `psql`.
 *
 * `ledgerExists` is what the shim answers the existence probe with, so both
 * cases can be driven: a database that already knows Slaids, and one that has
 * never seen it.
 */
function runScript(args: string[], options: { ledgerExists: boolean; applied?: string[] }): Run {
  workspace = mkdtempSync(join(tmpdir(), 'slaids-deploy-'))
  const log = join(workspace, 'statements.log')
  const shim = join(workspace, 'psql')

  // Records what it is asked to run, then answers plausibly. `-f` names a file
  // of statements, `-c` carries one inline, and everything else comes on stdin.
  writeFileSync(
    shim,
    `#!/usr/bin/env bash
set -uo pipefail
statement=""
expect=""
for arg in "$@"; do
  case "$expect" in
    file) statement="$(cat "$arg")"; expect="seen"; continue ;;
    cmd)  statement="$arg"; expect="seen"; continue ;;
  esac
  case "$arg" in
    -f) expect="file" ;;
    -c) expect="cmd" ;;
  esac
done
# Only a call that named neither can be reading a heredoc.
if [[ "$expect" == "" ]]; then statement="$(cat)"; fi
printf '%s\\n---\\n' "$statement" >> ${JSON.stringify(log)}
if [[ "$statement" == *to_regclass* ]]; then
  echo ${options.ledgerExists ? 't' : 'f'}
elif [[ "$statement" == *"select version from"* ]]; then
${(options.applied ?? []).map((version) => `  echo ${version}`).join('\n') || '  true'}
fi
exit 0
`,
    'utf8',
  )
  chmodSync(shim, 0o755)

  // A non-zero exit is a result to assert on here, not a test failure, so the
  // script's own output is kept either way.
  const { status, stdout } = (() => {
    try {
      return {
        status: 0,
        stdout: execFileSync('bash', [SCRIPT, ...args], {
          env: {
            ...process.env,
            PATH: `${workspace}:${process.env.PATH ?? ''}`,
            SLAIDS_DB_URL: 'postgresql://fake/db',
          },
          encoding: 'utf8',
        }),
      }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string }
      return { status: failure.status ?? 1, stdout: failure.stdout ?? '' }
    }
  })()

  const sql = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n---\n')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : []
  return { status, stdout, sql }
}

// Windows has no bash to run the script with; the invariant is unchanged there.
const onPosix = process.platform === 'win32' ? describe.skip : describe

onPosix('deploy-migrations.sh --dry-run', () => {
  it('endrer ingenting, heller ikke mot en base som aldri har sett Slaids', () => {
    const run = runScript(['--dry-run'], { ledgerExists: false })

    expect(run.status).toBe(0)
    // Den ville kjørt noe — så dette er ikke en tom kjøring som ikke beviser noe.
    expect(run.stdout).toContain('Migrasjoner som skal kjøres')
    expect(run.stdout).toContain('slaids_sharing.sql')

    const mutations = run.sql.filter((statement) => MUTATING.test(statement))
    expect(mutations).toEqual([])
    // Og spesielt: ingen ledger ble opprettet for å kunne svare på spørsmålet.
    expect(run.sql.join('\n')).not.toContain('create table')
  })

  it('leser en ledger som allerede finnes, uten å røre den', () => {
    const run = runScript(['--dry-run'], {
      ledgerExists: true,
      applied: ['20260831090315', '20260831090506', '20260902061716'],
    })

    expect(run.status).toBe(0)
    // Den siste er ikke registrert, så den – og bare den – gjenstår.
    expect(run.stdout).toContain('20260902084500_slaids_sharing.sql')
    expect(run.stdout).not.toContain('20260831090315_slaids_initial_storage.sql')
    expect(run.sql.filter((statement) => MUTATING.test(statement))).toEqual([])
  })

  it('sier ikke at ingenting skjedde hvis noe skjedde', () => {
    const run = runScript(['--dry-run'], { ledgerExists: false })
    expect(run.stdout).toMatch(/ingenting i databasen ble endret/)
  })
})

onPosix('deploy-migrations.sh (ekte kjøring)', () => {
  it('bootstrapper ledgeren før den kjører migrasjoner', () => {
    const run = runScript([], { ledgerExists: false })

    expect(run.status).toBe(0)
    const joined = run.sql.join('\n')
    expect(joined).toContain('create table if not exists public.slaids_migrations')
    expect(joined).toContain('enable row level security')
    expect(joined).toContain('revoke all on table public.slaids_migrations from anon')

    // Rekkefølgen er poenget: ledgeren finnes før den første migrasjonen kjører.
    const bootstrapAt = run.sql.findIndex((statement) => statement.includes('create table if not exists'))
    const firstMigrationAt = run.sql.findIndex((statement) =>
      statement.includes('insert into public.slaids_migrations'),
    )
    expect(bootstrapAt).toBeGreaterThanOrEqual(0)
    expect(firstMigrationAt).toBeGreaterThan(bootstrapAt)
  })

  it('registrerer hver migrasjon den kjører i Slaids egen historikk', () => {
    const run = runScript([], { ledgerExists: false })
    const recorded = run.sql
      .flatMap((statement) => [...statement.matchAll(/insert into public\.slaids_migrations \(version, name\) values \('(\d+)'/g)])
      .map((match) => match[1])

    // Derived from the directory rather than written out: a list copied here
    // goes stale on the next migration, and the claim being made is "every one
    // of them, in filename order", not "these four".
    const versions = readdirSync(join(process.cwd(), 'supabase', 'migrations'))
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => file.split('_')[0])

    expect(versions.length).toBeGreaterThan(0)
    expect(recorded).toEqual(versions)
  })

  it('rører aldri den delte historikken', () => {
    for (const args of [['--dry-run'], []]) {
      const run = runScript(args, { ledgerExists: false })
      expect(run.sql.join('\n')).not.toContain('supabase_migrations')
    }
  })
})
