// @vitest-environment node
/**
 * The public endpoint, end to end, with only the database stood in.
 *
 * `access.test.ts` holds the rules one at a time. This file runs the function
 * itself — the real `index.ts`, handed a fake Supabase client in place of the
 * service-role one and a captured `Deno.serve` in place of the runtime — so the
 * claims are about what a visitor holding a link actually gets back:
 *
 *  - a published deck, a shared folder, and a file the deck shows all answer
 *    while their owner is an active Slaids user;
 *  - all of them answer the generic 404 once an administrator deactivates the
 *    owner, and come back unchanged on reactivation — nothing was unpublished;
 *  - the owner's id is read to ask that question and never sent.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SLAIDS_USERS_TABLE } from '../../../src/persistence/slaidsUsers'
import {
  ASSETS_TABLE,
  FOLDERS_TABLE,
  PRESENTATIONS_TABLE,
} from '../../../src/persistence/supabaseRepository'
import {
  createFakeDatabase,
  createFakeSupabase,
  type FakeRow,
  type FakeSupabase,
} from '../../../src/persistence/supabaseTestClient'
import { NOT_FOUND_STATUS, USERS_TABLE } from './access'

const OWNER = '0b6c3c1e-4d4e-4f7a-9b55-2f0a6f3b9c01'
const DECK_TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'
const FOLDER_TOKEN = '9a8b7c6d-1111-4222-8333-444455556666'
const ASSET = 'a_figur'

const SNAPSHOT = { format: 'slaids-shared', title: 'Delt dekk', assets: [{ id: ASSET, mimeType: 'image/png' }] }

let tables: Record<string, FakeRow[]>
let fake: FakeSupabase
let serve: ((request: Request) => Response | Promise<Response>) | null = null

function seed(): Record<string, FakeRow[]> {
  return {
    [SLAIDS_USERS_TABLE]: [{ user_id: OWNER, role: 'user', active: true }],
    [FOLDERS_TABLE]: [
      { id: 'fl_delt', owner_id: OWNER, name: 'Delt mappe', is_shared: true, share_token: FOLDER_TOKEN },
    ],
    [PRESENTATIONS_TABLE]: [
      {
        id: 'p_delt',
        owner_id: OWNER,
        folder_id: 'fl_delt',
        share_token: DECK_TOKEN,
        is_shared: true,
        is_published: true,
        deleted_at: null,
        slide_count: 1,
        shared_document: SNAPSHOT,
        // `title:shared_document->>title` is a computed column the stand-in
        // cannot compute; the folder listing reads it under this name.
        title: SNAPSHOT.title,
      },
    ],
    [ASSETS_TABLE]: [
      { id: ASSET, owner_id: OWNER, presentation_id: 'p_delt', object_path: `${OWNER}/p_delt/${ASSET}` },
    ],
  }
}

// The client is built once, at import, as on Supabase. It forwards to whichever
// stand-in the current test installed, so each test gets a fresh database.
vi.mock('npm:@supabase/supabase-js@2', () => ({
  createClient: () =>
    new Proxy({}, { get: (_target, key) => (fake.client as unknown as Record<PropertyKey, unknown>)[key] }),
}))

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => ({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] },
    serve: (handler: (request: Request) => Response | Promise<Response>) => {
      serve = handler
    },
  })
  fake = createFakeSupabase({ session: null })
  // Through a variable, so the type checker does not follow it: the entry point
  // is Deno code (`npm:` specifiers, `.ts` extensions) and is type-checked by
  // Deno, not by this project's `tsc`.
  const entry = './index.ts'
  await import(/* @vite-ignore */ entry)
})

beforeEach(() => {
  const database = createFakeDatabase(seed())
  tables = database.tables
  fake = createFakeSupabase({ session: null, resolve: database.resolve })
})

function get(query: string): Promise<Response> {
  if (!serve) throw new Error('Funksjonen startet ikke.')
  return Promise.resolve(serve(new Request(`https://project.functions.supabase.co/slaids-share${query}`)))
}

function setActive(active: boolean): void {
  tables[SLAIDS_USERS_TABLE][0].active = active
}

const LINKS = [
  `?token=${DECK_TOKEN}`,
  `?token=${DECK_TOKEN}&asset=${ASSET}`,
  `?folder=${FOLDER_TOKEN}`,
  `?folder=${FOLDER_TOKEN}&presentation=p_delt`,
  `?folder=${FOLDER_TOKEN}&presentation=p_delt&asset=${ASSET}`,
]

describe('slaids-share og eierens status', () => {
  it('leser tilgangslisten Slaids selv bruker', () => {
    expect(USERS_TABLE).toBe(SLAIDS_USERS_TABLE)
  })

  it('svarer på alle lenkene mens eieren er aktiv, uten å sende eierens id', async () => {
    for (const link of LINKS) {
      const response = await get(link)
      expect(response.status, link).toBe(200)
      if (response.headers.get('Content-Type')?.startsWith('application/json')) {
        expect(await response.text(), link).not.toContain(OWNER)
      }
    }
  })

  it('svarer 404 på alle lenkene mens eieren er deaktivert, og som før etter reaktivering', async () => {
    setActive(false)
    for (const link of LINKS) {
      const response = await get(link)
      expect(response.status, link).toBe(NOT_FOUND_STATUS)
      expect(await response.json()).toEqual({ error: 'not_found' })
    }
    // No file was fetched for a deactivated owner.
    expect(fake.storageCalls).toEqual([])

    setActive(true)
    for (const link of LINKS) expect((await get(link)).status, link).toBe(200)
  })

  it('svarer 404 når eieren ikke står på tilgangslisten i det hele tatt', async () => {
    tables[SLAIDS_USERS_TABLE].splice(0)
    for (const link of LINKS) expect((await get(link)).status, link).toBe(NOT_FOUND_STATUS)
  })

  it('svarer 404 når tilgangslisten ikke kan leses', async () => {
    const database = createFakeDatabase(seed())
    fake = createFakeSupabase({
      session: null,
      resolve: (record) =>
        record.table === SLAIDS_USERS_TABLE ? { error: { message: 'nede' } } : database.resolve(record),
    })
    for (const link of LINKS) expect((await get(link)).status, link).toBe(NOT_FOUND_STATUS)
  })
})
