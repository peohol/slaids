/**
 * A real Postgres with Slaids' migrations applied, for testing access rules.
 *
 * Row level security is the rule that keeps one user's decks away from
 * another's, and a rule written in SQL is only tested by running it in
 * Postgres. PGlite is Postgres compiled to WebAssembly: the same planner, the
 * same policies, the same `security definer` semantics, with nothing to install
 * and nothing listening on a port, so it runs identically here and in CI.
 *
 * What PGlite does not have is Supabase, so the few things Slaids' migrations
 * rely on are stubbed below, each the way Supabase defines it: the three API
 * roles, `auth.users` and `auth.uid()`, the Storage tables and
 * `storage.foldername()`, and Supabase's default privileges — which hand every
 * new public table and function to `anon` and `authenticated`, and are exactly
 * what a migration has to revoke. Everything after the stub is the repository's
 * own `supabase/migrations/`, in filename order, unchanged.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
-- Supabase's own definition: the subject of the request's JWT.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
-- Supabase's own definition: every path segment but the file name.
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`

/** Every migration file, in the order the deploy script applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

export interface AuthUser {
  id: string
  email: string
}

let stubbed: Promise<Blob> | undefined

/**
 * Datakatalogen til en ny database med bare Supabase-stubben, laget én gang per
 * testfil. Å starte PGlite fra bunnen (initdb) tar over et sekund; å laste en
 * kopi av en ferdig katalog tar en brøkdel. Hver database starter likevel fra
 * nøyaktig samme tilstand som før, og ingen deler noe med en annen.
 */
function stubbedDataDir(): Promise<Blob> {
  stubbed ??= (async () => {
    const template = new PGlite()
    await template.exec(SUPABASE_STUB)
    const dump = await template.dumpDataDir('none')
    await template.close()
    return dump
  })()
  return stubbed
}

/**
 * A fresh database: the Supabase stub, then `beforeMigrations` (the Auth users
 * and any other app's objects that exist before Slaids' migrations run, exactly
 * as in production), then every migration — or only `migrations`, to see the
 * database as it was before them.
 */
export async function migratedDatabase(
  beforeMigrations = '',
  options: { migrations?: readonly string[] } = {},
): Promise<PGlite> {
  const db = new PGlite({ loadDataDir: await stubbedDataDir() })
  if (beforeMigrations) await db.exec(beforeMigrations)
  for (const file of options.migrations ?? migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
  return db
}

export function insertAuthUsers(users: readonly AuthUser[]): string {
  return users
    .map((user) => `insert into auth.users (id, email) values ('${user.id}', '${user.email}');`)
    .join('\n')
}

/** Who a statement runs as: an API role, and for `authenticated` whose JWT. */
export type Caller =
  | { role: 'anon' }
  | { role: 'service_role' }
  | { role: 'authenticated'; userId: string }

/**
 * Run `work` as `caller`, the way PostgREST does — `set local role` plus the
 * request's JWT claims — inside a transaction that is always rolled back unless
 * `commit` is set. A test reads the database as one user at a time, and nothing
 * one test does as a user leaks into the next unless it says so.
 */
export async function as<T>(
  db: PGlite,
  caller: Caller,
  work: (tx: Transaction) => Promise<T>,
  options: { commit?: boolean } = {},
): Promise<T> {
  let result: T | undefined
  let failure: unknown = null
  await db
    .transaction(async (tx) => {
      const claims = caller.role === 'authenticated' ? { sub: caller.userId, role: caller.role } : { role: caller.role }
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
      await tx.exec(`set local role ${caller.role}`)
      try {
        result = await work(tx)
      } catch (error) {
        failure = error
      }
      if (failure || !options.commit) await tx.rollback()
    })
    .catch((error: unknown) => {
      failure ??= error
    })
  if (failure) throw failure
  return result as T
}

/** The rows a query returns, as `caller`. */
export async function rowsAs<T = Record<string, unknown>>(
  db: PGlite,
  caller: Caller,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return as(db, caller, async (tx) => (await tx.query<T>(sql, params)).rows)
}

/** How many rows a statement touched, as `caller`. */
export async function affectedAs(
  db: PGlite,
  caller: Caller,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  return as(db, caller, async (tx) => (await tx.query(sql, params)).affectedRows ?? 0)
}
