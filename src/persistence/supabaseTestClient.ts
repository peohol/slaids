/**
 * A hand-rolled stand-in for the Supabase client, for the repository tests.
 *
 * It records the chain a call builds — table, operation, filters, payload — and
 * hands back whatever the test's resolver decides, so a test can assert on the
 * *request* (does the write carry `owner_id` from the session? is the update
 * guarded on the version it read?) and not only on what came back.
 *
 * Test-only: nothing in `src/` imports it, so it never reaches a bundle.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface QueryRecord {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  columns?: string
  values?: unknown
  filters: { column: string; value: unknown }[]
  single: 'none' | 'maybe' | 'one'
}

export interface QueryOutcome {
  data?: unknown
  error?: { message: string; code?: string } | null
}

export type QueryResolver = (record: QueryRecord) => QueryOutcome

export interface StorageCall {
  op: 'upload' | 'download' | 'remove'
  bucket: string
  paths: string[]
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
      }),
    },
  }

  return { client: client as unknown as SupabaseClient, queries, storageCalls }
}
