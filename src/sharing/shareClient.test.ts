/**
 * The public client.
 *
 * What matters here is what it does *not* do: it carries no key and no session,
 * it treats every refusal alike, and it never lets an unvalidated body through
 * to the renderer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPresentation } from '../domain/presentation'
import { buildSharedSnapshot } from '../domain/sharing'
import { fetchSharedSnapshot, shareFunctionUrl, sharedAssetUrl } from './shareClient'

const TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'
const PROJECT_URL = 'https://project.supabase.co'

function configure(): void {
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
}

function respondWith(outcome: { status?: number; body?: unknown } | Error): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      if (outcome instanceof Error) return Promise.reject(outcome)
      const status = outcome.status ?? 200
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(outcome.body),
      } as Response)
    }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('endepunktet', () => {
  it('finnes bare når Slaids er satt opp mot Supabase', () => {
    expect(shareFunctionUrl()).toBeNull()
    expect(sharedAssetUrl(TOKEN, 'a_1')).toBeNull()

    configure()
    expect(shareFunctionUrl()).toBe(`${PROJECT_URL}/functions/v1/slaids-share`)
  })

  it('bygger en asset-adresse av token og fil-id, og ingenting annet', () => {
    configure()
    const url = sharedAssetUrl(TOKEN, 'a_1')
    expect(url).toBe(`${PROJECT_URL}/functions/v1/slaids-share?token=${TOKEN}&asset=a_1`)
    // Ingen nøkkel, ingen eier, ingen Storage-sti.
    expect(url).not.toContain('key')
    expect(url).not.toContain('owner')
  })
})

describe('fetchSharedSnapshot', () => {
  beforeEach(configure)

  it('leser og validerer et snapshot', async () => {
    const snapshot = buildSharedSnapshot(createPresentation({ title: 'Delt' }))
    respondWith({ body: JSON.parse(JSON.stringify(snapshot)) })

    const outcome = await fetchSharedSnapshot(TOKEN)

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.snapshot.title).toBe('Delt')
  })

  it('sender ingen legitimasjon', async () => {
    respondWith({ status: 404, body: { error: 'not_found' } })
    await fetchSharedSnapshot(TOKEN)

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(String(call[0])).toContain(`token=${TOKEN}`)
    const init = call[1] as RequestInit
    const headers = (init.headers ?? {}) as Record<string, string>
    expect(Object.keys(headers).map((key) => key.toLowerCase())).toEqual(['accept'])
  })

  it('behandler en ukjent, tilbakekalt eller slettet presentasjon likt', async () => {
    respondWith({ status: 404, body: { error: 'not_found' } })
    expect(await fetchSharedSnapshot(TOKEN)).toEqual({ kind: 'not-found' })
  })

  it('slipper ikke et uvalidert svar videre til rendereren', async () => {
    respondWith({ body: { format: 'noe-annet', slides: [{ id: 'x' }] } })
    const outcome = await fetchSharedSnapshot(TOKEN)
    expect(outcome.kind).toBe('unavailable')
  })

  it('sier fra når nettet svikter, i stedet for å vise en tom presentasjon', async () => {
    respondWith(new Error('offline'))
    const outcome = await fetchSharedSnapshot(TOKEN)
    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return
    expect(outcome.message).toMatch(/kontakt/i)
  })

  it('sier fra i en installasjon uten deling', async () => {
    vi.unstubAllEnvs()
    const outcome = await fetchSharedSnapshot(TOKEN)
    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return
    expect(outcome.message).toMatch(/ikke satt opp for deling/i)
  })
})
