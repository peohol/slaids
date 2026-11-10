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

/** The migration whose name carries this fragment, or `''` when there is none. */
function migrationNamed(fragment: string): string {
  return (
    readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .find((name) => name.includes(fragment)) ?? ''
  )
}

const file = migrationNamed('delete_folder')

describe(DELETE_FOLDER_FUNCTION, () => {
  const sql = file ? statementsIn(file) : ''

  it('finnes som en migrasjon som kan kjøres på nytt', () => {
    expect(file).not.toBe('')
    // `AGENTS.md`'s rule for every Slaids migration, and what makes a file safe
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

/**
 * The trash and the size column.
 *
 * Less is at stake than in the folder function — two columns and a backfill —
 * but the backfill has one property that would break an open editor if it were
 * lost: it must not touch `document`, or the touch trigger bumps every row's
 * `version` and every deck open at the time refuses its next autosave as a lost
 * race. That is the kind of edit somebody makes to "keep the two in sync".
 */
describe('søppelkassen og lagringsstørrelsen', () => {
  const migration = migrationNamed('trash_and_size')
  const sql = migration ? statementsIn(migration) : ''

  it('finnes som en migrasjon som kan kjøres på nytt', () => {
    expect(migration).not.toBe('')
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+deleted_at\s+timestamptz/i)
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+byte_size\s+bigint\s+not\s+null\s+default\s+0/i)
    expect(sql).toMatch(/drop\s+constraint\s+if\s+exists\s+slaids_presentations_byte_size_check/i)
    expect(sql).toMatch(/check\s*\(\s*byte_size\s*>=\s*0\s*\)/i)
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists\s+slaids_presentations_\w+/i)
    for (const created of sql.match(/create\s+index\s+if\s+not\s+exists\s+(\S+)/gi) ?? []) {
      expect(created).toMatch(/slaids_/i)
    }
  })

  it('fyller inn byte_size uten å røre dokumentet, så versjonen står stille', () => {
    const update = sql.match(/update\s+public\.slaids_presentations[\s\S]*?;/i)?.[0] ?? ''
    expect(update).not.toBe('')
    const assigned = update.match(/\bset\s+([\s\S]*?)\bwhere\b/i)?.[1] ?? ''
    // Exactly one column on the left-hand side of the SET list.
    expect(assigned.match(/\b\w+\s*=(?!=)/g)).toEqual(['byte_size ='])
    // Only the rows the client has not written yet, and from the document.
    expect(update).toMatch(/where\s+p\.byte_size\s*=\s*0/i)
    expect(assigned).toMatch(/octet_length\(p\.document::text\)/i)
    expect(assigned).toMatch(/byteSize/)
  })

  it('rører ikke tilgangen, og gir anon ingenting', () => {
    expect(sql).not.toMatch(/create\s+policy|alter\s+policy|grant\s+/i)
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.slaids_presentations\s+from\s+anon/i)
  })
})

/**
 * Folder sharing.
 *
 * What a shared folder may show is decided in the database, so these are the
 * properties that keep it from showing more: the flag the public reads is
 * derived and never taken from a client, it is derived only from a folder of
 * the *same* owner, a deck that stops being published loses its copy in the
 * same statement, and nobody but the owner gains any access at all.
 */
describe('deling av mapper', () => {
  const migration = migrationNamed('folder_sharing')
  const sql = migration ? statementsIn(migration) : ''
  const touch =
    sql.match(/create\s+or\s+replace\s+function\s+public\.slaids_presentations_touch\(\)[\s\S]*?\$\$;/i)?.[0] ?? ''
  const folderTouch =
    sql.match(/create\s+or\s+replace\s+function\s+public\.slaids_folders_share_touch\(\)[\s\S]*?\$\$;/i)?.[0] ?? ''

  it('finnes som en migrasjon som kan kjøres på nytt', () => {
    expect(migration).not.toBe('')
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+is_shared\s+boolean\s+not\s+null\s+default\s+false/i)
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+share_token\s+uuid\s+not\s+null/i)
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+is_published\s+boolean\s+not\s+null\s+default\s+false/i)
    expect(sql).toMatch(/drop\s+trigger\s+if\s+exists\s+slaids_folders_share_touch/i)
    expect(sql).toMatch(/drop\s+constraint\s+if\s+exists\s+slaids_presentations_share_state_check/i)
    for (const created of sql.match(/create\s+(?:unique\s+)?index\s+if\s+not\s+exists\s+(\S+)/gi) ?? []) {
      expect(created).toMatch(/slaids_/i)
    }
    for (const created of sql.match(/create\s+or\s+replace\s+function\s+(\S+)/gi) ?? []) {
      expect(created).toMatch(/public\.slaids_/i)
    }
  })

  it('utleder is_published fra raden selv og fra en delt mappe med samme eier', () => {
    expect(touch).not.toBe('')
    expect(touch).toMatch(/new\.is_published\s*:=\s*new\.is_shared\s+or\s+exists/i)
    expect(touch).toMatch(/f\.id\s*=\s*new\.folder_id/i)
    expect(touch).toMatch(/f\.owner_id\s*=\s*new\.owner_id/i)
    expect(touch).toMatch(/and\s+f\.is_shared/i)
  })

  it('dropper kopien til en rad som ikke er publisert, i samme skriving', () => {
    expect(touch).toMatch(/if\s+not\s+new\.is_published\s+then\s+new\.shared_document\s*:=\s*null/i)
  })

  it('lar versjonsregelen stå: bare dokumentendringer flytter versjonen', () => {
    expect(touch).toMatch(/new\.document\s+is\s+distinct\s+from\s+old\.document/i)
    expect(touch).not.toMatch(/is_published\s+is\s+distinct/i)
    expect(touch).toMatch(/new\.version\s*:=\s*old\.version\s*;/i)
  })

  it('når presentasjonene i mappen når delingen endres, og bare eierens', () => {
    expect(folderTouch).toMatch(/update\s+public\.slaids_presentations/i)
    expect(folderTouch).toMatch(/p\.folder_id\s*=\s*new\.id/i)
    expect(folderTouch).toMatch(/p\.owner_id\s*=\s*new\.owner_id/i)
    // Bare flagget: ingen dokumentkolonne, så ingen versjon flytter seg.
    const assigned =
      folderTouch.match(/update\s+public\.slaids_presentations\s+p\s+set\s+([\s\S]*?)\bwhere\b/i)?.[1] ?? ''
    expect(assigned.match(/\b\w+\s*=(?!=)/g)).toEqual(['is_published ='])
    expect(sql).toMatch(/after\s+update\s+of\s+is_shared\s+on\s+public\.slaids_folders/i)
  })

  it('binder delingen sammen med kopien i en CHECK', () => {
    expect(sql).toMatch(/not\s+is_shared\s+or\s+\(is_published\s+and\s+shared_document\s+is\s+not\s+null\)/i)
    expect(sql).toMatch(/is_published\s+or\s+shared_document\s+is\s+null/i)
  })

  it('gir ingen ny tilgang til noen, og kjører som kalleren', () => {
    expect(sql).not.toMatch(/create\s+policy|alter\s+policy|grant\s+/i)
    expect(sql).not.toMatch(/security\s+definer/i)
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.slaids_folders\s+from\s+anon/i)
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.slaids_presentations\s+from\s+anon/i)
    for (const fn of ['slaids_presentations_touch', 'slaids_folders_share_touch']) {
      for (const role of ['public', 'anon', 'authenticated']) {
        expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\(\\)\\s+from\\s+${role}`, 'i'))
      }
    }
  })
})
