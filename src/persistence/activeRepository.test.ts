import { afterEach, describe, expect, it, vi } from 'vitest'
import { DexieSlaidsRepository } from './dexieRepository'
import { SupabaseSlaidsRepository } from './supabaseRepository'
import type { SlaidsRepository } from './repository'
import { SupabaseConfigurationError } from '../supabase/config'
import { resolveRepository, setRepositoryOverride, storageMode } from './activeRepository'

const URL_KEY = 'VITE_SUPABASE_URL'
const KEY_KEY = 'VITE_SUPABASE_PUBLISHABLE_KEY'

afterEach(() => {
  vi.unstubAllEnvs()
  setRepositoryOverride(null)
})

describe('valg av lagring', () => {
  it('bruker Dexie når Supabase ikke er konfigurert', () => {
    vi.stubEnv(URL_KEY, '')
    vi.stubEnv(KEY_KEY, '')

    expect(storageMode()).toBe('local')
    expect(resolveRepository()).toBeInstanceOf(DexieSlaidsRepository)
  })

  it('bruker Supabase når begge variablene finnes', () => {
    vi.stubEnv(URL_KEY, 'https://example.supabase.co')
    vi.stubEnv(KEY_KEY, 'sb_publishable_test')

    expect(storageMode()).toBe('supabase')
    expect(resolveRepository()).toBeInstanceOf(SupabaseSlaidsRepository)
  })

  it.each([
    ['bare URL', 'https://example.supabase.co', ''],
    ['bare nøkkel', '', 'sb_publishable_test'],
  ])('nekter å velge noe lager når bare halve oppsettet finnes (%s)', (_label, url, key) => {
    vi.stubEnv(URL_KEY, url)
    vi.stubEnv(KEY_KEY, key)

    expect(storageMode()).toBe('misconfigured')
    // The whole point: a deployment mistake must never end up writing
    // production data into the browser where nobody knows to look for it.
    expect(() => resolveRepository()).toThrow(SupabaseConfigurationError)
    let resolved: unknown
    try {
      resolved = resolveRepository()
    } catch {
      resolved = null
    }
    expect(resolved).not.toBeInstanceOf(DexieSlaidsRepository)
  })

  it('navngir variabelen som mangler', () => {
    vi.stubEnv(URL_KEY, 'https://example.supabase.co')
    vi.stubEnv(KEY_KEY, '')
    expect(() => resolveRepository()).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('lar heller ikke fasaden skrive lokalt ved halv konfigurasjon', async () => {
    vi.stubEnv(URL_KEY, '')
    vi.stubEnv(KEY_KEY, 'sb_publishable_test')

    const { repository } = await import('./activeRepository')
    await expect(repository.listPresentations()).rejects.toBeInstanceOf(SupabaseConfigurationError)
  })

  it('lar en test overstyre valget', () => {
    const stub = {} as SlaidsRepository
    setRepositoryOverride(stub)
    expect(resolveRepository()).toBe(stub)
    setRepositoryOverride(null)
    expect(resolveRepository()).not.toBe(stub)
  })

  it('sender fasadekallene videre til den aktive implementasjonen', async () => {
    const calls: string[] = []
    setRepositoryOverride({
      listPresentations: async () => {
        calls.push('listPresentations')
        return []
      },
      deleteAsset: async (id: string) => {
        calls.push(`deleteAsset:${id}`)
      },
    } as unknown as SlaidsRepository)

    const { repository } = await import('./activeRepository')
    await repository.listPresentations()
    await repository.deleteAsset('a1')

    expect(calls).toEqual(['listPresentations', 'deleteAsset:a1'])
  })
})
