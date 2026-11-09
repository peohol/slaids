// @vitest-environment node
/**
 * Who can reach what, proven against Postgres.
 *
 * Every Slaids table and the asset bucket are tried as each kind of caller the
 * project can produce: the first administrator, a second ordinary Slaids user,
 * an Auth account from another app in the same project, a deactivated user,
 * and `anon`. The rule under test is the one in `IMPLEMENTATION_PLAN.md`
 * § 43.1: an active Slaids user reaches exactly their own rows, and nobody
 * else reaches anything — not by reading, not by writing someone else's
 * `owner_id`, not by moving their own row to someone else.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { LAST_ACTIVE_ADMIN_ERROR, SLAIDS_USERS_TABLE } from '../../src/persistence/slaidsUsers'
import {
  affectedAs,
  as,
  insertAuthUsers,
  migratedDatabase,
  migrationFiles,
  rowsAs,
  type Caller,
} from './database'

const PEDER = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'
const ANNA = '11111111-1111-4111-8111-111111111111'
/** An Auth account another app in the project created. Never added to Slaids. */
const OUTSIDER = '22222222-2222-4222-8222-222222222222'

const peder: Caller = { role: 'authenticated', userId: PEDER }
const anna: Caller = { role: 'authenticated', userId: ANNA }
const outsider: Caller = { role: 'authenticated', userId: OUTSIDER }
const anon: Caller = { role: 'anon' }
const server: Caller = { role: 'service_role' }

/** The owner-scoped tables, each with a minimal row that satisfies its constraints. */
const OWNED_TABLES = [
  'slaids_folders',
  'slaids_presentations',
  'slaids_templates',
  'slaids_assets',
  'slaids_agent_tokens',
  'slaids_agent_audit',
] as const

function libraryFor(owner: string, tag: string): string {
  const hash = (tag.charCodeAt(0) % 16).toString(16).repeat(64)
  return `
    insert into public.slaids_folders (id, owner_id, name) values ('fl_${tag}', '${owner}', 'Mappe ${tag}');
    insert into public.slaids_presentations (id, owner_id, title, folder_id, document)
      values ('pr_${tag}', '${owner}', 'Dekk ${tag}', 'fl_${tag}', '{}'::jsonb);
    insert into public.slaids_templates (id, owner_id, name, template) values ('tp_${tag}', '${owner}', 'Mal ${tag}', '{}'::jsonb);
    insert into public.slaids_assets (id, owner_id, presentation_id, ref, object_path)
      values ('as_${tag}', '${owner}', 'pr_${tag}', '{}'::jsonb, '${owner}/pr_${tag}/as_${tag}');
    insert into public.slaids_agent_tokens (owner_id, name, token_hash, scopes)
      values ('${owner}', 'Token ${tag}', '${hash}', array['presentations:read']);
    insert into public.slaids_agent_audit (owner_id, operation, success) values ('${owner}', 'list_presentations', true);
    insert into storage.objects (bucket_id, name) values ('slaids-assets', '${owner}/pr_${tag}/as_${tag}');
  `
}

/**
 * Another app in the same project: its own table, its own policies, its own
 * bucket. Created before Slaids' migrations, exactly as in production, so the
 * test can show that none of it is touched.
 */
const OTHER_APP = `
  create table public.mdeditz_documents (id text primary key, owner_id uuid, body text);
  alter table public.mdeditz_documents enable row level security;
  create policy mdeditz_documents_own on public.mdeditz_documents
    for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  insert into storage.buckets (id, name) values ('mdeditz', 'mdeditz');
  create policy mdeditz_storage_own on storage.objects
    for select to authenticated using (bucket_id = 'mdeditz' and (storage.foldername(name))[1] = auth.uid()::text);
`

const OTHER_APP_STATE = `
  select 'policy' as kind, policyname || ' ' || roles::text || ' ' || cmd || ' ' ||
         coalesce(qual, '') || ' ' || coalesce(with_check, '') as detail
    from pg_policies where policyname like 'mdeditz\\_%'
  union all
  select 'grant', grantee || ' ' || privilege_type
    from information_schema.role_table_grants where table_name = 'mdeditz_documents'
  union all
  select 'bucket', id || ' ' || coalesce(public::text, '') from storage.buckets where id = 'mdeditz'
  order by 1, 2`

let db: PGlite
let otherAppBefore: unknown[]

beforeAll(async () => {
  const before = await migratedDatabase(OTHER_APP, { migrations: [] })
  otherAppBefore = (await before.query(OTHER_APP_STATE)).rows
  await before.close()

  db = await migratedDatabase(
    OTHER_APP +
      insertAuthUsers([
        { id: PEDER, email: 'Peder.Holman@gmail.com' },
        { id: ANNA, email: 'anna@example.no' },
        { id: OUTSIDER, email: 'outsider@example.no' },
      ]),
  )
  // Anna is added the way the administration server adds a user, and both
  // libraries exist before any test reads them.
  await db.exec(`
    insert into public.slaids_users (user_id, role, created_by) values ('${ANNA}', 'user', '${PEDER}');
    ${libraryFor(PEDER, 'p')}
    ${libraryFor(ANNA, 'a')}
  `)
}, 60_000)

async function setActive(userId: string, active: boolean): Promise<void> {
  await db.query(`update public.slaids_users set active = $2 where user_id = $1`, [userId, active])
}

describe('bootstrap', () => {
  it('gjør den eksisterende eieren til aktiv administrator, uten å flytte data', async () => {
    const rows = await rowsAs(db, server, `select user_id, role, active from public.slaids_users where user_id = $1`, [PEDER])
    expect(rows).toEqual([{ user_id: PEDER, role: 'admin', active: true }])
  })

  it('kan kjøres på nytt uten å endre noe', async () => {
    const file = migrationFiles().find((name) => name.includes('multi_user'))
    expect(file).toBeDefined()
    await db.query(`update public.slaids_users set role = 'admin' where user_id = $1`, [ANNA])
    try {
      await db.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', file!), 'utf8'))
      expect(
        await rowsAs(db, server, `select user_id, role, active from public.slaids_users order by user_id`),
      ).toEqual([
        { user_id: ANNA, role: 'admin', active: true },
        { user_id: PEDER, role: 'admin', active: true },
      ])
    } finally {
      await db.query(`update public.slaids_users set role = 'user' where user_id = $1`, [ANNA])
    }
  })

  it('gir ingen administrator når e-posten ikke stemmer med UUID-en', async () => {
    const other = await migratedDatabase(insertAuthUsers([{ id: PEDER, email: 'someone@else.no' }]))
    expect((await other.query(`select * from public.${SLAIDS_USERS_TABLE}`)).rows).toEqual([])
    await other.close()
  }, 60_000)
})

describe('hver bruker sitt eget bibliotek', () => {
  it.each(OWNED_TABLES)('%s: ser bare egne rader', async (table) => {
    const own = await rowsAs<{ owner_id: string }>(db, peder, `select owner_id from public.${table}`)
    expect(own.length).toBeGreaterThan(0)
    expect(new Set(own.map((row) => row.owner_id))).toEqual(new Set([PEDER]))

    const annas = await rowsAs<{ owner_id: string }>(db, anna, `select owner_id from public.${table}`)
    expect(annas.length).toBeGreaterThan(0)
    expect(new Set(annas.map((row) => row.owner_id))).toEqual(new Set([ANNA]))
  })

  it.each(OWNED_TABLES.filter((table) => table !== 'slaids_agent_audit'))(
    '%s: kan verken endre eller slette en annens rader',
    async (table) => {
      expect(await affectedAs(db, anna, `update public.${table} set owner_id = owner_id where owner_id = $1`, [PEDER])).toBe(0)
      expect(await affectedAs(db, anna, `delete from public.${table} where owner_id = $1`, [PEDER])).toBe(0)
    },
  )

  it.each(['slaids_folders', 'slaids_presentations', 'slaids_templates'] as const)(
    '%s: kan ikke flytte en egen rad over til en annen eier',
    async (table) => {
      await expect(
        affectedAs(db, anna, `update public.${table} set owner_id = $1 where owner_id = $2`, [PEDER, ANNA]),
      ).rejects.toThrow(/row-level security/)
    },
  )

  it('kan ikke opprette rader i en annens navn', async () => {
    await expect(
      affectedAs(db, anna, `insert into public.slaids_presentations (id, owner_id, title, document) values ('pr_x', $1, 'x', '{}')`, [PEDER]),
    ).rejects.toThrow(/row-level security/)
    await expect(
      affectedAs(db, anna, `insert into public.slaids_agent_tokens (owner_id, name, token_hash, scopes) values ($1, 'x', $2, array['presentations:read'])`, [PEDER, 'e'.repeat(64)]),
    ).rejects.toThrow(/row-level security/)
  })

  it('kan ikke arkivere sin presentasjon i en annens mappe', async () => {
    await expect(
      affectedAs(db, anna, `update public.slaids_presentations set folder_id = 'fl_p' where id = 'pr_a'`),
    ).rejects.toThrow(/foreign key/)
  })

  it('kan ikke slette en annens mappe gjennom databasefunksjonen', async () => {
    await as(db, anna, (tx) => tx.query(`select * from public.slaids_delete_folder('fl_p', $1)`, [PEDER]))
    expect(await rowsAs(db, server, `select id from public.slaids_folders where id = 'fl_p'`)).toHaveLength(1)
  })

  it('en ny bruker begynner med et tomt bibliotek og kan lage sitt eget', async () => {
    const NEW = '33333333-3333-4333-8333-333333333333'
    await db.exec(`
      ${insertAuthUsers([{ id: NEW, email: 'ny@example.no' }])}
      insert into public.slaids_users (user_id) values ('${NEW}');
    `)
    const fresh: Caller = { role: 'authenticated', userId: NEW }
    for (const table of OWNED_TABLES) {
      expect(await rowsAs(db, fresh, `select 1 from public.${table}`)).toEqual([])
    }
    expect(
      await affectedAs(db, fresh, `insert into public.slaids_presentations (id, owner_id, title, document) values ('pr_new', $1, 'Nytt', '{}')`, [NEW]),
    ).toBe(1)
  })
})

describe('filer i Storage', () => {
  it('hver bruker ser bare filene under sin egen UUID', async () => {
    expect(await rowsAs(db, peder, `select name from storage.objects`)).toEqual([{ name: `${PEDER}/pr_p/as_p` }])
    expect(await rowsAs(db, anna, `select name from storage.objects`)).toEqual([{ name: `${ANNA}/pr_a/as_a` }])
  })

  it('kan ikke legge filer i en annens mappe, eller endre og slette dem', async () => {
    await expect(
      affectedAs(db, anna, `insert into storage.objects (bucket_id, name) values ('slaids-assets', $1)`, [`${PEDER}/pr_p/stolen`]),
    ).rejects.toThrow(/row-level security/)
    expect(await affectedAs(db, anna, `delete from storage.objects where name like $1`, [`${PEDER}/%`])).toBe(0)
    expect(await affectedAs(db, anna, `insert into storage.objects (bucket_id, name) values ('slaids-assets', $1)`, [`${ANNA}/pr_a/new`])).toBe(1)
  })

  it('en filrad kan bare peke på eierens egen fil', async () => {
    await expect(
      db.query(
        `insert into public.slaids_assets (id, owner_id, presentation_id, ref, object_path) values ('as_steal', $1, 'pr_a', '{}', $2)`,
        [ANNA, `${PEDER}/pr_p/as_p`],
      ),
    ).rejects.toThrow(/slaids_assets_object_path_check/)
  })
})

describe('Auth-kontoer som ikke er Slaids-brukere', () => {
  it.each([
    ['en konto fra en annen app', outsider],
    ['anon', anon],
  ] as const)('%s får ingenting, heller ikke sine egne rader', async (_label, caller) => {
    for (const table of OWNED_TABLES) {
      const rows = await rowsAs(db, caller, `select 1 from public.${table}`).catch(() => [])
      expect(rows).toEqual([])
    }
    expect(await rowsAs(db, caller, `select 1 from storage.objects`).catch(() => [])).toEqual([])
  })

  it('en konto fra en annen app kan ikke lage Slaids-data, selv med sin egen UUID', async () => {
    await expect(
      affectedAs(db, outsider, `insert into public.slaids_presentations (id, owner_id, title, document) values ('pr_o', $1, 'x', '{}')`, [OUTSIDER]),
    ).rejects.toThrow(/row-level security/)
    await expect(
      affectedAs(db, outsider, `insert into public.slaids_agent_tokens (owner_id, name, token_hash, scopes) values ($1, 'x', $2, array['presentations:read'])`, [OUTSIDER, 'f'.repeat(64)]),
    ).rejects.toThrow(/row-level security/)
    await expect(
      affectedAs(db, outsider, `insert into storage.objects (bucket_id, name) values ('slaids-assets', $1)`, [`${OUTSIDER}/pr_o/x`]),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('deaktivering', () => {
  it('stenger all tilgang med en gang, også for en økt som allerede finnes, og reaktivering gir alt tilbake', async () => {
    await setActive(ANNA, false)
    try {
      for (const table of OWNED_TABLES) {
        expect(await rowsAs(db, anna, `select 1 from public.${table}`)).toEqual([])
      }
      expect(await rowsAs(db, anna, `select 1 from storage.objects`)).toEqual([])
      await expect(
        affectedAs(db, anna, `insert into public.slaids_folders (id, owner_id, name) values ('fl_late', $1, 'x')`, [ANNA]),
      ).rejects.toThrow(/row-level security/)
      expect(await affectedAs(db, anna, `delete from public.slaids_presentations where owner_id = $1`, [ANNA])).toBe(0)
      // The user can still see that they are deactivated — which is what lets
      // the app say so instead of showing an empty library.
      expect(await rowsAs(db, anna, `select active from public.slaids_users`)).toEqual([{ active: false }])
    } finally {
      await setActive(ANNA, true)
    }
    expect(await rowsAs(db, anna, `select id from public.slaids_presentations`)).toEqual([{ id: 'pr_a' }])
  })
})

describe('tilgangslisten selv', () => {
  it('en innlogget bruker ser bare sin egen rad', async () => {
    expect(await rowsAs(db, anna, `select user_id, role from public.slaids_users`)).toEqual([{ user_id: ANNA, role: 'user' }])
    expect(await rowsAs(db, outsider, `select user_id from public.slaids_users`)).toEqual([])
  })

  it.each([
    ['gi seg selv administratorrolle', `update public.slaids_users set role = 'admin' where user_id = '${ANNA}'`],
    ['reaktivere seg selv', `update public.slaids_users set active = true where user_id = '${ANNA}'`],
    ['legge seg selv til', `insert into public.slaids_users (user_id) values ('${OUTSIDER}')`],
    ['fjerne andre', `delete from public.slaids_users where user_id = '${PEDER}'`],
  ])('ingen nettleser kan %s', async (_label, sql) => {
    for (const caller of [anna, outsider, peder, anon]) {
      await expect(affectedAs(db, caller, sql)).rejects.toThrow(/permission denied/)
    }
  })

  it.each(['slaids_admin_list_users()', `slaids_auth_user_id_by_email('anna@example.no')`])(
    '%s kan bare kalles av serveren',
    async (call) => {
      for (const caller of [peder, anna, anon]) {
        await expect(rowsAs(db, caller, `select * from public.${call}`)).rejects.toThrow(/permission denied/)
      }
      expect((await rowsAs(db, server, `select * from public.${call}`)).length).toBeGreaterThan(0)
    },
  )

  it('serveren får e-post, rolle og status for hver Slaids-bruker, og bare dem', async () => {
    const rows = await rowsAs<{ user_id: string; email: string; role: string; active: boolean }>(
      db,
      server,
      `select user_id, email, role, active from public.slaids_admin_list_users()`,
    )
    expect(rows.map((row) => row.user_id)).not.toContain(OUTSIDER)
    expect(rows).toContainEqual({ user_id: PEDER, email: 'Peder.Holman@gmail.com', role: 'admin', active: true })
  })

  it('finner en eksisterende Auth-konto uansett store og små bokstaver', async () => {
    expect(
      await rowsAs(db, server, `select public.slaids_auth_user_id_by_email($1) as id`, ['  PEDER.holman@gmail.com ']),
    ).toEqual([{ id: PEDER }])
    expect(
      await rowsAs(db, server, `select public.slaids_auth_user_id_by_email($1) as id`, ['ingen@example.no']),
    ).toEqual([{ id: null }])
  })
})

describe('det finnes alltid en aktiv administrator', () => {
  it.each([
    ['fjerne rollen', `update public.slaids_users set role = 'user' where user_id = '${PEDER}'`],
    ['deaktivere', `update public.slaids_users set active = false where user_id = '${PEDER}'`],
    ['slette', `delete from public.slaids_users where user_id = '${PEDER}'`],
  ])('den siste aktive administratoren kan ikke %s', async (_label, sql) => {
    await expect(affectedAs(db, server, sql)).rejects.toThrow(LAST_ACTIVE_ADMIN_ERROR)
  })

  it('heller ikke ved å slette Auth-kontoen', async () => {
    await expect(db.query(`delete from auth.users where id = $1`, [PEDER])).rejects.toThrow(LAST_ACTIVE_ADMIN_ERROR)
  })

  it('med to aktive administratorer kan den ene fjernes, men da ikke den andre', async () => {
    await as(db, server, async (tx) => {
      await tx.query(`update public.slaids_users set role = 'admin' where user_id = $1`, [ANNA])
      await tx.query(`update public.slaids_users set role = 'user' where user_id = $1`, [PEDER])
      await expect(tx.query(`update public.slaids_users set active = false where user_id = $1`, [ANNA])).rejects.toThrow(
        LAST_ACTIVE_ADMIN_ERROR,
      )
    })
  })

  it('en deaktivert administrator teller ikke', async () => {
    await as(db, server, async (tx) => {
      await tx.query(`update public.slaids_users set role = 'admin', active = false where user_id = $1`, [ANNA])
      await expect(tx.query(`update public.slaids_users set role = 'user' where user_id = $1`, [PEDER])).rejects.toThrow(
        LAST_ACTIVE_ADMIN_ERROR,
      )
    })
  })

  it('vanlige brukere kan endres fritt', async () => {
    expect(await affectedAs(db, server, `update public.slaids_users set active = false where user_id = $1`, [ANNA])).toBe(1)
  })
})

describe('policyene som helhet', () => {
  it('rører ikke andre appers tabeller, policyer, tilgang eller buckets', async () => {
    expect(otherAppBefore.length).toBeGreaterThan(8)
    expect((await db.query(OTHER_APP_STATE)).rows).toEqual(otherAppBefore)
  })

  it('ingen Slaids-policy er lenger festet til én fast bruker, og alle krever en aktiv Slaids-bruker', async () => {
    const policies = await rowsAs<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }>(
      db,
      server,
      `select tablename, policyname, qual, with_check from pg_policies
        where (schemaname = 'public' and tablename like 'slaids\\_%')
           or (schemaname = 'storage' and policyname like 'slaids\\_%')`,
    )
    expect(policies.length).toBeGreaterThan(20)
    for (const policy of policies) {
      const text = `${policy.qual ?? ''} ${policy.with_check ?? ''}`
      expect(text, policy.policyname).not.toMatch(/dab4f04f/)
      if (policy.tablename === SLAIDS_USERS_TABLE) continue
      if (policy.qual !== null) expect(policy.qual, policy.policyname).toContain('slaids_is_active_user()')
      if (policy.with_check !== null) expect(policy.with_check, policy.policyname).toContain('slaids_is_active_user()')
    }
  })

  it('hver Slaids-tabell har row level security på', async () => {
    const tables = await rowsAs<{ relname: string; relrowsecurity: boolean }>(
      db,
      server,
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'
          and relname like 'slaids\\_%' and relname <> 'slaids_migrations'`,
    )
    expect(tables.length).toBeGreaterThanOrEqual(OWNED_TABLES.length + 1)
    for (const table of tables) expect(table.relrowsecurity, table.relname).toBe(true)
  })
})

describe('tilbakerulling', () => {
  it('setter hver policy tilbake nøyaktig slik den var før migrasjonen', async () => {
    const users = insertAuthUsers([{ id: PEDER, email: 'peder.holman@gmail.com' }])
    const policies = `select schemaname, tablename, policyname, qual, with_check from pg_policies
      where policyname like 'slaids\\_%' order by 1, 2, 3`
    const multiUser = migrationFiles().find((name) => name.includes('multi_user'))!
    const before = await migratedDatabase(users, {
      migrations: migrationFiles().filter((name) => name < multiUser),
    })
    const expected = (await before.query(policies)).rows
    await before.close()

    const rolledBack = await migratedDatabase(users)
    await rolledBack.exec('create table public.slaids_migrations (version text primary key, name text)')
    await rolledBack.exec(
      readFileSync(join(process.cwd(), 'supabase', 'rollback', multiUser.replace('.sql', '.down.sql')), 'utf8'),
    )
    const after = (await rolledBack.query<{ policyname: string }>(policies)).rows
    // The access list's own policy stays with the table it guards.
    expect(after.filter((row) => row.policyname !== 'slaids_users_select_own')).toEqual(expected)
    await rolledBack.close()
  }, 60_000)
})
