// @vitest-environment node
/**
 * The SQL the repository depends on.
 *
 * `supabaseRepository.test.ts` models `slaids_delete_folder` in its resolver so
 * the repository's own half stays testable — which call, which arguments, what
 * the library looks like afterwards. What a model cannot do is prove that the
 * function in `supabase/migrations/` behaves that way, and here that is not a
 * convenience: the whole reason the folder deletion moved into the database is
 * that the transaction and the lock *are* the correctness. A migration edited
 * into three separate statements would pass every other test in this repository
 * and silently reintroduce the race the function exists to close.
 *
 * So this asserts the properties that make it correct, against the file itself.
 * Same posture as `server/agent/deployment.test.ts`: check the deployment
 * artefact, not only the code that assumes it.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DELETE_FOLDER_FUNCTION } from './supabaseRepository'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

/** One migration's SQL, with comment lines dropped so a mention cannot pass for a statement. */
function statementsIn(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
}

const file =
  readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .find((name) => name.includes('delete_folder')) ?? ''

describe(DELETE_FOLDER_FUNCTION, () => {
  const sql = file ? statementsIn(file) : ''

  it('finnes som en migrasjon som kan kjøres på nytt', () => {
    expect(file).not.toBe('')
    // `CLAUDE.md`'s rule for every Slaids migration, and what makes a file safe
    // to re-run in the SQL editor or against a database whose ledger is
    // incomplete.
    expect(sql).toMatch(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${DELETE_FOLDER_FUNCTION}`, 'i'),
    )
    // The project is shared with two other apps, so Slaids only ever creates
    // objects under its own prefix.
    for (const created of sql.match(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\S+)/gi) ?? []) {
      expect(created).toMatch(/public\.slaids_/i)
    }
  })

  it('tar argumentene repositoryet faktisk sender', () => {
    // Named arguments on both sides; a rename on either would be a runtime
    // failure behind a green build.
    expect(sql).toMatch(/p_folder_id\s+text/i)
    expect(sql).toMatch(/p_owner_id\s+uuid/i)
  })

  it('låser mapperaden først, som er det som lukker kappløpet', () => {
    // A foreign key check takes `FOR KEY SHARE` on the parent row it references,
    // and `FOR UPDATE` conflicts with it. Without this, a concurrent write can
    // file a presentation into the folder between the emptying and the delete,
    // and that row's document is then left naming a folder that is gone. It is
    // the single most load-bearing statement in the file.
    expect(sql).toMatch(/from\s+public\.slaids_folders[\s\S]*?for\s+update/i)
    // And it comes first: locking afterwards would lock nothing in time.
    expect(sql.search(/for\s+update/i)).toBeLessThan(
      sql.search(/update\s+public\.slaids_presentations/i),
    )
  })

  it('tømmer begge stedene mappen står skrevet, i den samme setningen', () => {
    // The column the library filters on, and the field inside the document —
    // one statement, so there is no state in which the two disagree.
    const update = sql.match(/update\s+public\.slaids_presentations[\s\S]*?returning[^;]*/i)?.[0] ?? ''
    expect(update).toMatch(/folder_id\s*=\s*null/i)
    expect(update).toMatch(/jsonb_set\([\s\S]*folderId/i)
    // And it hands back what the caller needs to keep its version cache honest.
    expect(update).toMatch(/returning\s+p\.id,\s*p\.version/i)
  })

  it('fjerner mappen etter at den er tømt, og rører bare eierens egne rader', () => {
    expect(sql.search(/delete\s+from\s+public\.slaids_folders/i)).toBeGreaterThan(
      sql.search(/update\s+public\.slaids_presentations/i),
    )
    // Every statement carries the owner. The server-side client holds a secret
    // key and has no row level security to fall back on.
    for (const statement of sql.split(';')) {
      if (!/(update|delete\s+from|from)\s+public\.slaids_(folders|presentations)/i.test(statement)) {
        continue
      }
      expect(statement).toMatch(/owner_id\s*=\s*p_owner_id/i)
    }
  })

  it('gir anon ingenting, og kjører som kalleren og ikke som eieren', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function[\s\S]*?from\s+public/i)
    expect(sql).toMatch(/revoke\s+all\s+on\s+function[\s\S]*?from\s+anon/i)
    expect(sql).toMatch(/grant\s+execute\s+on\s+function[\s\S]*?to\s+authenticated/i)
    expect(sql).toMatch(/grant\s+execute\s+on\s+function[\s\S]*?to\s+service_role/i)
    // `security definer` would take row level security out of the picture in the
    // browser and leave the owner argument as the only limit — and that argument
    // is the caller's to choose.
    expect(sql).not.toMatch(/security\s+definer/i)
  })
})
