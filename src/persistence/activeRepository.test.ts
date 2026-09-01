import { afterEach, describe, expect, it, vi } from 'vitest'
import { DexieSlaidsRepository } from './dexieRepository'
import { SupabaseSlaidsRepository } from './supabaseRepository'
import type { SlaidsRepository } from './repository'
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

  it('regner et halvkonfigurert bygg som ukonfigurert', () => {
    // Half a configuration would fail in the middle of a save instead of here.
    vi.stubEnv(URL_KEY, 'https://example.supabase.co')
    vi.stubEnv(KEY_KEY, '')

    expect(storageMode()).toBe('local')
    expect(resolveRepository()).toBeInstanceOf(DexieSlaidsRepository)
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
