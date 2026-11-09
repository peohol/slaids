// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { LAST_ACTIVE_ADMIN_ERROR } from '../../persistence/slaidsUsers'
import { sessionUserResolver, supabaseAdminUserStore } from './supabase'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'ES256' })}.${encode(claims)}.c2ln`
}

function clientWith(parts: Record<string, unknown>): SupabaseClient {
  return parts as unknown as SupabaseClient
}

describe('hvem en innlogging tilhører', () => {
  const accepting = clientWith({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER } }, error: null })) },
  })

  it('en vanlig nettleserøkt som Supabase godtar', async () => {
    expect(await sessionUserResolver(accepting)(jwt({ sub: USER, role: 'authenticated' }))).toBe(USER)
  })

  it('aldri en OAuth-delegasjon, selv om Supabase godtar tokenet', async () => {
    expect(await sessionUserResolver(accepting)(jwt({ sub: USER, client_id: 'chatgpt' }))).toBeNull()
  })

  it('aldri et token Supabase avviser', async () => {
    const refusing = clientWith({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'invalid JWT' } })) },
    })
    expect(await sessionUserResolver(refusing)(jwt({ sub: USER }))).toBeNull()
  })

  it('aldri et token med en nyttelast som ikke kan leses', async () => {
    expect(await sessionUserResolver(accepting)('a.%%%.c')).toBeNull()
  })
})

describe('brukerregisteret i Supabase', () => {
  function updatingClient(result: { data: unknown; error: { message: string; code?: string } | null }) {
    const select = vi.fn(async () => result)
    const eq = vi.fn(() => ({ select }))
    const update = vi.fn(() => ({ eq }))
    return { client: clientWith({ from: vi.fn(() => ({ update })) }), update, eq }
  }

  it('kjenner igjen databasens nei til å fjerne siste administrator', async () => {
    const { client } = updatingClient({ data: null, error: { message: `${LAST_ACTIVE_ADMIN_ERROR}`, code: 'P0001' } })
    expect(await supabaseAdminUserStore(client).updateMember(USER, { role: 'user' })).toBe('last-admin')
  })

  it('skiller «ingen slik bruker» fra en endring som gikk gjennom', async () => {
    const none = updatingClient({ data: [], error: null })
    expect(await supabaseAdminUserStore(none.client).updateMember(USER, { active: false })).toBe('not-found')
    const one = updatingClient({ data: [{ user_id: USER }], error: null })
    expect(await supabaseAdminUserStore(one.client).updateMember(USER, { active: false })).toBe('updated')
    expect(one.update).toHaveBeenCalledWith({ active: false })
    expect(one.eq).toHaveBeenCalledWith('user_id', USER)
  })

  it('en bruker som allerede står på listen, legges ikke til på nytt', async () => {
    const client = clientWith({
      from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: { message: 'duplicate', code: '23505' } })) })),
    })
    expect(await supabaseAdminUserStore(client).addMember({ userId: USER, role: 'user', createdBy: USER })).toBe(false)
  })

  it('oppretter en Auth-bruker uten passord og med bekreftet adresse', async () => {
    const createUser = vi.fn(async () => ({ data: { user: { id: USER } }, error: null }))
    const client = clientWith({ auth: { admin: { createUser } } })
    expect(await supabaseAdminUserStore(client).createAuthUser('ny@example.no')).toBe(USER)
    expect(createUser).toHaveBeenCalledWith({ email: 'ny@example.no', email_confirm: true })
  })

  it('bruker kontoen som kom i mellomtiden når adressen allerede er registrert', async () => {
    const client = clientWith({
      auth: { admin: { createUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'email_exists' } })) } },
      rpc: vi.fn(async () => ({ data: USER, error: null })),
    })
    expect(await supabaseAdminUserStore(client).createAuthUser('ny@example.no')).toBe(USER)
  })

  it('leser brukerlisten og hopper over rader som ikke kan tolkes', async () => {
    const client = clientWith({
      rpc: vi.fn(async () => ({
        data: [
          { user_id: USER, email: 'a@b.no', role: 'admin', active: true, created_at: '2026-11-09T00:00:00Z', last_sign_in_at: null },
          { user_id: 'x', email: 'c@d.no', role: 'owner', active: true },
        ],
        error: null,
      })),
    })
    expect(await supabaseAdminUserStore(client).list()).toEqual([
      { userId: USER, email: 'a@b.no', role: 'admin', active: true, createdAt: '2026-11-09T00:00:00Z', lastSignInAt: null },
    ])
  })
})
