/**
 * What the agent API will and will not start with.
 *
 * The refusals are the interesting half. Each of them describes a deployment
 * where the API would look like it works while something is badly wrong, and
 * the only useful moment to say so is the first request.
 */

import { describe, expect, it } from 'vitest'
import { MAX_ASSET_BYTES } from '../../domain/constants'
import { DEFAULT_MAX_REQUEST_BYTES, readAgentApiConfig } from './config'

const CONFIGURED = {
  SLAIDS_SUPABASE_URL: 'https://project.supabase.co',
  SLAIDS_SUPABASE_SECRET_KEY: 'sb_secret_abc123',
}

describe('readAgentApiConfig', () => {
  it('bruker servervariablene, og godtar prosjekt-URL-en fra Vite-variabelen', () => {
    const state = readAgentApiConfig({
      // The URL is not a secret, so the one the frontend build already has is a
      // perfectly good source for it. The key is not treated that way.
      VITE_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    })
    expect(state).toMatchObject({
      kind: 'configured',
      config: {
        supabaseUrl: 'https://project.supabase.co',
        secretKey: 'service-role',
        maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES,
      },
    })
  })

  it('sier hva som mangler i stedet for å starte uten lagring', () => {
    expect(readAgentApiConfig({})).toEqual({
      kind: 'unconfigured',
      missing: ['SLAIDS_SUPABASE_URL', 'SLAIDS_SUPABASE_SECRET_KEY'],
    })
    expect(readAgentApiConfig({ SUPABASE_URL: 'https://project.supabase.co' })).toEqual({
      kind: 'unconfigured',
      missing: ['SLAIDS_SUPABASE_SECRET_KEY'],
    })
  })

  it('nekter å starte når hemmeligheten også ligger i en VITE-variabel', () => {
    // By this point the key is in the browser bundle. Starting anyway would be
    // pretending it is not, and the only correct action is to rotate it.
    const state = readAgentApiConfig({
      ...CONFIGURED,
      VITE_SLAIDS_DEBUG_KEY: 'sb_secret_abc123',
    })
    expect(state.kind).toBe('refused')
    expect(state.kind === 'refused' && state.problem).toContain('VITE_SLAIDS_DEBUG_KEY')
  })

  it('nekter en publishable-nøkkel, som uansett ikke kommer forbi RLS', () => {
    expect(
      readAgentApiConfig({ ...CONFIGURED, SLAIDS_SUPABASE_SECRET_KEY: 'sb_publishable_xyz' }).kind,
    ).toBe('refused')
    expect(
      readAgentApiConfig({
        ...CONFIGURED,
        SLAIDS_SUPABASE_SECRET_KEY: 'anon-key',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
      }).kind,
    ).toBe('refused')
  })

  it('nekter å starte mot et annet Supabase-prosjekt enn editoren bruker', () => {
    // The failure this stops is the quiet one: nothing errors, the agent writes
    // decks into a database nobody looks in, and `list_presentations` answers
    // with an empty library that is indistinguishable from a real one.
    const state = readAgentApiConfig({
      ...CONFIGURED,
      VITE_SUPABASE_URL: 'https://gammelt.supabase.co',
    })
    expect(state.kind).toBe('refused')
    const problem = state.kind === 'refused' ? state.problem : ''
    expect(problem).toContain('project')
    expect(problem).toContain('gammelt')
  })

  it('godtar det samme prosjektet skrevet på to måter', () => {
    // A trailing slash is not another project, and neither is a different case
    // in the hostname. The reference is what identifies a project.
    expect(
      readAgentApiConfig({
        ...CONFIGURED,
        VITE_SUPABASE_URL: 'https://PROJECT.supabase.co/',
      }).kind,
    ).toBe('configured')
  })

  it('nekter ikke et eget domene foran det samme prosjektet', () => {
    // A custom domain carries no project reference, so there is nothing to
    // compare it against. Refusing here would take the whole API down over a
    // deployment that is correct — «vet ikke» er ikke «forskjellig».
    expect(
      readAgentApiConfig({
        ...CONFIGURED,
        VITE_SUPABASE_URL: 'https://db.slaids.example',
      }).kind,
    ).toBe('configured')

    expect(
      readAgentApiConfig({
        SLAIDS_SUPABASE_URL: 'https://db.slaids.example',
        SLAIDS_SUPABASE_SECRET_KEY: 'sb_secret_abc123',
        VITE_SUPABASE_URL: 'https://project.supabase.co',
      }).kind,
    ).toBe('configured')
  })

  it('sier ingenting om to verter den ikke kan lese en prosjektreferanse av', () => {
    // A local stack, a proxy, two spellings of the same thing. None of them
    // names a project, so none of them can prove a mismatch.
    expect(
      readAgentApiConfig({
        SLAIDS_SUPABASE_URL: 'http://127.0.0.1:54321',
        SLAIDS_SUPABASE_SECRET_KEY: 'sb_secret_abc123',
        VITE_SUPABASE_URL: 'http://localhost:54321',
      }).kind,
    ).toBe('configured')
  })

  it('har ingenting å sammenligne når Vite-variabelen selv er kilden', () => {
    // Then there is one value, not two, and a check would be comparing it with
    // itself — the shape that always passes and proves nothing.
    expect(
      readAgentApiConfig({
        VITE_SUPABASE_URL: 'https://project.supabase.co',
        SLAIDS_SUPABASE_SECRET_KEY: 'sb_secret_abc123',
      }).kind,
    ).toBe('configured')
  })

  it('klemmer den konfigurerte størrelsesgrensen inn i noe fornuftig', () => {
    const at = (raw: string) =>
      readAgentApiConfig({ ...CONFIGURED, SLAIDS_AGENT_MAX_REQUEST_BYTES: raw })
    expect(at('1000000')).toMatchObject({ config: { maxRequestBytes: 1000000 } })
    expect(at('1')).toMatchObject({ config: { maxRequestBytes: 1024 } })
    expect(at('999999999')).toMatchObject({ config: { maxRequestBytes: MAX_ASSET_BYTES } })
    expect(at('tull')).toMatchObject({ config: { maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES } })
  })
})
