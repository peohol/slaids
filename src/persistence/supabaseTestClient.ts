/**
 * A hand-rolled stand-in for the Supabase client, for the repository tests.
 *
 * It records the chain a call builds — table, operation, filters, payload — and
 * hands back whatever the test's resolver decides, so a test can assert on the
 * *request* (does the write carry `owner_id` from the session? is the update
 * guarded on the version it read?) and not only on what came back. `rpc` is
 * recorded the same way, so "which statements did this method send?" stays one
 * question with one answer even when one of them is a database function.
 *
 * Test-only: nothing in `src/` imports it, so it never reaches a bundle.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DELETE_FOLDER_FUNCTION, FOLDERS_TABLE, PRESENTATIONS_TABLE } from './supabaseRepository'

export interface QueryRecord {
  table: string
  /**
   * `rpc` is a database function rather than a table statement. It is the same
   * record because the assertions are the same — which one, with what arguments,
   * answering with what — and because a test that counts the statements a method
   * sends has to see it among them.
   */
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
  columns?: string
  values?: unknown
  /**
   * `operator` is absent for the equality filters that make up nearly every
   * statement, and names the PostgREST operator otherwise — `is`, `not.is`,
   * `gte`, `lt` — so a test can tell "deleted_at is null" from
   * "deleted_at = null".
   */
  filters: { column: string; value: unknown; operator?: string }[]
  single: 'none' | 'maybe' | 'one'
}

export interface QueryOutcome {
  data?: unknown
  error?: { message: string; code?: string } | null
}

export type QueryResolver = (record: QueryRecord) => QueryOutcome

export interface StorageCall {
  op: 'upload' | 'download' | 'remove' | 'list'
  bucket: string
  paths: string[]
}

/** What one `storage.list` entry looks like; a prefix has no `id`. */
export interface StorageEntry {
  name: string
  id?: string | null
}

class FakeQuery implements PromiseLike<QueryOutcome> {
  constructor(
    private readonly record: QueryRecord,
    private readonly resolver: QueryResolver,
  ) {}

  select(columns?: string): this {
    this.record.columns = columns
    return this
  }

  insert(values: unknown): this {
    this.record.op = 'insert'
    this.record.values = values
    return this
  }

  upsert(values: unknown): this {
    this.record.op = 'upsert'
    this.record.values = values
    return this
  }

  update(values: unknown): this {
    this.record.op = 'update'
    this.record.values = values
    return this
  }

  delete(): this {
    this.record.op = 'delete'
    return this
  }

  eq(column: string, value: unknown): this {
    this.record.filters.push({ column, value })
    return this
  }

  in(column: string, value: unknown): this {
    this.record.filters.push({ column, value })
    return this
  }

  /** `is null` / `is not null`, recorded as the filters they are. */
  is(column: string, value: unknown): this {
    this.record.filters.push({ column, value, operator: 'is' })
    return this
  }

  not(column: string, operator: string, value: unknown): this {
    this.record.filters.push({ column, value, operator: `not.${operator}` })
    return this
  }

  /** PostgREST's `or=(…)`, recorded whole: the test reads the expression it was given. */
  or(filters: string): this {
    this.record.filters.push({ column: 'or', value: filters, operator: 'or' })
    return this
  }

  gte(column: string, value: unknown): this {
    this.record.filters.push({ column, value, operator: 'gte' })
    return this
  }

  lt(column: string, value: unknown): this {
    this.record.filters.push({ column, value, operator: 'lt' })
    return this
  }

  order(): this {
    return this
  }

  maybeSingle(): this {
    this.record.single = 'maybe'
    return this
  }

  single(): this {
    this.record.single = 'one'
    return this
  }

  then<TResult1 = QueryOutcome, TResult2 = never>(
    onfulfilled?: ((value: QueryOutcome) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const outcome = this.resolver(this.record)
    return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null }).then(
      onfulfilled,
      onrejected,
    )
  }
}

export interface FakeSupabaseOptions {
  /** `null` means "not signed in". Defaults to a signed-in user. */
  session?: { user: { id: string } } | null
  sessionError?: { message: string; status?: number } | null
  resolve?: QueryResolver
  upload?: (path: string) => QueryOutcome
  download?: (path: string) => QueryOutcome
  remove?: (paths: string[]) => QueryOutcome
  list?: (prefix: string) => QueryOutcome
}

export const TEST_OWNER_ID = '11111111-2222-4333-8444-555555555555'

export interface FakeSupabase {
  client: SupabaseClient
  queries: QueryRecord[]
  storageCalls: StorageCall[]
}

export function createFakeSupabase(options: FakeSupabaseOptions = {}): FakeSupabase {
  const queries: QueryRecord[] = []
  const storageCalls: StorageCall[] = []
  const resolve: QueryResolver = options.resolve ?? (() => ({ data: null, error: null }))
  const session =
    options.session === undefined ? { user: { id: TEST_OWNER_ID } } : options.session

  const client = {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session }, error: options.sessionError ?? null }),
    },
    from: (table: string) => {
      const record: QueryRecord = { table, op: 'select', filters: [], single: 'none' }
      queries.push(record)
      return new FakeQuery(record, resolve)
    },
    // A database function. `table` carries its name so a resolver can switch on
    // the same field it switches on for statements, and the arguments go in
    // `values` for the same reason they do for an insert: they are the payload.
    rpc: (name: string, args: unknown) => {
      const record: QueryRecord = { table: name, op: 'rpc', values: args, filters: [], single: 'none' }
      queries.push(record)
      const outcome = resolve(record)
      return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null })
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          storageCalls.push({ op: 'upload', bucket, paths: [path] })
          const outcome = options.upload?.(path) ?? { data: { path }, error: null }
          return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null })
        },
        download: (path: string) => {
          storageCalls.push({ op: 'download', bucket, paths: [path] })
          const outcome = options.download?.(path) ?? { data: new Blob(['x']), error: null }
          return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null })
        },
        remove: (paths: string[]) => {
          storageCalls.push({ op: 'remove', bucket, paths })
          const outcome = options.remove?.(paths) ?? { data: [], error: null }
          return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null })
        },
        list: (prefix: string) => {
          storageCalls.push({ op: 'list', bucket, paths: [prefix] })
          const outcome = options.list?.(prefix) ?? { data: [], error: null }
          return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null })
        },
      }),
    },
  }

  return { client: client as unknown as SupabaseClient, queries, storageCalls }
}

/** One row of a stand-in table. */
export type FakeRow = Record<string, unknown>
type Row = FakeRow

function matches(row: Row, filters: QueryRecord['filters']): boolean {
  return filters.every((filter) => {
    const stored = row[filter.column]
    // `is null` is true of a column that was never set, as it is in Postgres.
    if (filter.operator === 'is') return (stored ?? null) === filter.value
    if (filter.operator === 'not.is') return (stored ?? null) !== filter.value
    // Timestamps compare as instants, whatever precision either side wrote.
    if (filter.operator === 'gte') return timestamp(stored) >= timestamp(filter.value)
    if (filter.operator === 'lt') return timestamp(stored) < timestamp(filter.value)
    return Array.isArray(filter.value) ? filter.value.includes(stored) : stored === filter.value
  })
}

function timestamp(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN
}

function numberish(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

/**
 * A small stand-in for Postgres behind the fake client: several owners' rows in
 * one set of tables, as a server-side client with a secret key sees them.
 *
 * The claims it serves are about *stored state*: it has a primary key on `id`,
 * it raises `23505` when one is taken, and filters actually filter. A test that
 * only asserted "the right method was called" could not tell an upsert that
 * takes a row over from an insert that refuses to — and with no row level
 * security narrowing anything, what stops one owner reaching another's rows is
 * only what the code under test sends.
 *
 * One `id` primary key per table, and a unique violation when it is taken.
 */
export function createFakeDatabase(seed: Record<string, Row[]>): {
  tables: Record<string, Row[]>
  resolve: QueryResolver
} {
  const tables: Record<string, Row[]> = {}
  for (const [table, rows] of Object.entries(seed)) tables[table] = rows.map((row) => ({ ...row }))

  const resolve: QueryResolver = (record) => {
    const rows = (tables[record.table] ??= [])
    const hit = rows.filter((row) => matches(row, record.filters))

    switch (record.op) {
      case 'select':
        return { data: record.single === 'none' ? hit : (hit[0] ?? null) }
      case 'insert': {
        const incoming = (Array.isArray(record.values) ? record.values : [record.values]) as Row[]
        for (const row of incoming) {
          // A row without an `id` gets one from the database, as an audit row does.
          if (row.id !== undefined && rows.some((existing) => existing.id === row.id)) {
            return {
              error: { message: 'duplicate key value violates unique constraint', code: '23505' },
            }
          }
        }
        rows.push(...incoming.map((row) => ({ ...row })))
        return { data: record.single === 'none' ? incoming : incoming[0] }
      }
      case 'update': {
        for (const row of hit) Object.assign(row, record.values as Row)
        return { data: hit }
      }
      case 'upsert': {
        // Never reached by the paths under test — asserted below — but honest
        // about what it would do if one came back: take the row over.
        const incoming = (Array.isArray(record.values) ? record.values : [record.values]) as Row[]
        for (const row of incoming) {
          const existing = rows.find((entry) => entry.id === row.id)
          if (existing) Object.assign(existing, row)
          else rows.push({ ...row })
        }
        return { data: incoming }
      }
      case 'delete':
        for (const row of hit) rows.splice(rows.indexOf(row), 1)
        return { data: hit }
      case 'rpc':
        return callFunction(record)
    }
  }

  /**
   * The database functions, modelled.
   *
   * A stand-in and not a proof: what Postgres actually does is in
   * `supabase/migrations/`, and `slaids_delete_folder.sql` is checked
   * separately for the properties this model assumes. What it *is* good for is
   * the half a resolver can answer — that the repository sends the right call
   * with the right arguments, and that the library ends up in the state the
   * contract promises — which is the coverage that would otherwise have been
   * lost by moving the work into SQL.
   */
  function callFunction(record: QueryRecord): QueryOutcome {
    if (record.table !== DELETE_FOLDER_FUNCTION) {
      return { error: { message: `could not find the function ${record.table}`, code: 'PGRST202' } }
    }
    const { p_folder_id: folderId, p_owner_id: owner } = record.values as {
      p_folder_id: string
      p_owner_id: string
    }
    const presentations = (tables[PRESENTATIONS_TABLE] ??= [])
    const folders = (tables[FOLDERS_TABLE] ??= [])

    // Both places the folder is named, cleared together — and only for rows
    // this owner may touch, which is what the function's own filter does.
    const moved: Row[] = []
    for (const row of presentations) {
      if (row.folder_id !== folderId || row.owner_id !== owner) continue
      row.folder_id = null
      row.document = { ...(row.document as object), folderId: null }
      row.version = numberish(row.version) + 1
      moved.push({ presentation_id: row.id, version: row.version })
    }

    for (const folder of [...folders]) {
      if (folder.id === folderId && folder.owner_id === owner) {
        folders.splice(folders.indexOf(folder), 1)
      }
    }
    return { data: moved }
  }

  return { tables, resolve }
}
