import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthError, SupabaseClient } from '@supabase/supabase-js'
import { setSupabaseClient } from '../supabase/client'
import { createPresentation } from '../domain/presentation'
import { LAST_OPEN_PRESENTATION_KEY, readPref, writePref } from './prefs'
import { describeAuthError, stopSessionWatcher, useSessionStore } from './session'
import { useEditorStore } from './store'

const URL_KEY = 'VITE_SUPABASE_URL'
const KEY_KEY = 'VITE_SUPABASE_PUBLISHABLE_KEY'
const USER = { id: 'user-1', email: 'peder@example.com' }

interface AuthStub {
  session?: { user: { id: string; email?: string } } | null
  getSessionError?: unknown
  signInResult?: { data: { session: unknown }; error: unknown }
  signOutError?: unknown
}

/** What the last `signOut` call was given, so the scope can be asserted on. */
const signOutCalls: unknown[] = []

function fakeClient(stub: AuthStub = {}): SupabaseClient {
  const session = stub.session === undefined ? null : stub.session
  return {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () =>
        Promise.resolve({ data: { session }, error: stub.getSessionError ?? null }),
      signInWithPassword: () =>
        Promise.resolve(stub.signInResult ?? { data: { session }, error: null }),
      signOut: (options?: unknown) => {
        signOutCalls.push(options)
        return Promise.resolve({ error: stub.signOutError ?? null })
      },
    },
  } as unknown as SupabaseClient
}

function configure(): void {
  vi.stubEnv(URL_KEY, 'https://example.supabase.co')
  vi.stubEnv(KEY_KEY, 'sb_publishable_test')
}

beforeEach(() => {
  signOutCalls.length = 0
  stopSessionWatcher()
  useSessionStore.setState({
    status: 'loading',
    userId: null,
    email: null,
    error: null,
    signingIn: false,
    signInError: null,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  setSupabaseClient(null)
  stopSessionWatcher()
})

describe('auth-gating', () => {
  it('slår seg av helt når Supabase ikke er konfigurert', async () => {
    vi.stubEnv(URL_KEY, '')
    vi.stubEnv(KEY_KEY, '')
    // No client is set: local mode must not even reach for one.
    await useSessionStore.getState().start()

    expect(useSessionStore.getState().status).toBe('disabled')
  })

  it('krever innlogging når Supabase er konfigurert men ingen er logget inn', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: null }))

    await useSessionStore.getState().start()

    expect(useSessionStore.getState().status).toBe('signed-out')
  })

  it('slipper gjennom en lagret sesjon etter reload', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER } }))

    await useSessionStore.getState().start()

    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-in')
    expect(state.userId).toBe(USER.id)
    expect(state.email).toBe(USER.email)
  })

  it('lar en reload beholde hvilken presentasjon som var åpen', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER } }))
    writePref(LAST_OPEN_PRESENTATION_KEY, 'p1')

    await useSessionStore.getState().start()

    // Opening a session is not leaving one: there is no previous user whose
    // traces need clearing, and the preference must survive.
    expect(readPref<string | null>(LAST_OPEN_PRESENTATION_KEY, null)).toBe('p1')
  })

  it('viser en forståelig feil når Supabase er konfigurert men utilgjengelig', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        session: null,
        getSessionError: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
      }),
    )

    await useSessionStore.getState().start()

    const state = useSessionStore.getState()
    expect(state.status).toBe('unavailable')
    expect(state.error).toMatch(/Fikk ikke kontakt med Supabase/)
  })

  it('beholder en gyldig sesjon selv om oppfriskningen feilet', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        session: { user: USER },
        getSessionError: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
      }),
    )

    await useSessionStore.getState().start()

    expect(useSessionStore.getState().status).toBe('signed-in')
  })
})

describe('innlogging', () => {
  it('logger inn med e-post og passord', async () => {
    configure()
    setSupabaseClient(
      fakeClient({ signInResult: { data: { session: { user: USER } }, error: null } }),
    )

    await useSessionStore.getState().signIn(' peder@example.com ', 'hemmelig')

    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-in')
    expect(state.signingIn).toBe(false)
    expect(state.signInError).toBeNull()
  })

  it('sier fra om feil passord uten å slippe brukeren inn', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        signInResult: {
          data: { session: null },
          error: { name: 'AuthApiError', status: 400, message: 'Invalid login credentials' },
        },
      }),
    )

    await useSessionStore.getState().signIn('peder@example.com', 'feil')

    const state = useSessionStore.getState()
    expect(state.status).not.toBe('signed-in')
    expect(state.signInError).toBe('Feil e-post eller passord.')
  })

  it('skiller nettverksfeil fra feil passord', () => {
    expect(
      describeAuthError({ name: 'AuthRetryableFetchError', message: 'x' } as AuthError),
    ).toMatch(/Fikk ikke kontakt/)
    expect(
      describeAuthError({ name: 'AuthApiError', status: 400, message: 'Invalid login credentials' } as AuthError),
    ).toBe('Feil e-post eller passord.')
  })
})

describe('konfigurasjonsfeil', () => {
  it('stopper appen når bare halve Supabase-oppsettet finnes', async () => {
    vi.stubEnv(URL_KEY, 'https://example.supabase.co')
    vi.stubEnv(KEY_KEY, '')

    await useSessionStore.getState().start()

    const state = useSessionStore.getState()
    // Not `disabled`: local mode here would mean production writing to
    // IndexedDB because a deploy variable went missing.
    expect(state.status).toBe('misconfigured')
    expect(state.error).toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/)
  })
})

describe('utlogging', () => {
  it('logger bare ut av Slaids, ikke av Huskis på andre enheter', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER } }))
    await useSessionStore.getState().start()

    await useSessionStore.getState().signOut()

    // The default global scope would revoke every refresh token the user has.
    expect(signOutCalls).toEqual([{ scope: 'local' }])
    expect(useSessionStore.getState().status).toBe('signed-out')
  })

  it('hevder ikke at sesjonen er borte når utloggingen feilet', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        session: { user: USER },
        signOutError: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
      }),
    )
    await useSessionStore.getState().start()
    writePref(LAST_OPEN_PRESENTATION_KEY, 'p1')

    await useSessionStore.getState().signOut()

    // The SDK leaves the stored session in place on failure, so it comes back
    // on the next reload. Showing the sign-in screen would be a lie.
    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-in')
    expect(state.userId).toBe(USER.id)
    expect(readPref<string | null>(LAST_OPEN_PRESENTATION_KEY, null)).toBe('p1')
  })

  it('lar ingenting fra forrige bruker bli liggende', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER } }))
    await useSessionStore.getState().start()

    useEditorStore.getState().setPresentation(createPresentation({ title: 'Hemmelig' }))
    writePref(LAST_OPEN_PRESENTATION_KEY, 'p1')

    await useSessionStore.getState().signOut()

    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-out')
    expect(state.userId).toBeNull()
    expect(state.email).toBeNull()
    expect(useEditorStore.getState().presentation).toBeNull()
    expect(readPref<string | null>(LAST_OPEN_PRESENTATION_KEY, null)).toBeNull()
  })
})
