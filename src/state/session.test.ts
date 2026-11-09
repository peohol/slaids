import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { setSupabaseClient } from '../supabase/client'
import { createPresentation } from '../domain/presentation'
import { lastOpenPresentationKey, readPref, writePref } from './prefs'
import { authSessionStorage } from '../supabase/authStorage'
import { stopSessionWatcher, useSessionStore } from './session'
import { useToasts } from './toast'
import { useEditorStore } from './store'

const URL_KEY = 'VITE_SUPABASE_URL'
const KEY_KEY = 'VITE_SUPABASE_PUBLISHABLE_KEY'
const USER = { id: 'user-1', email: 'peder@example.com' }

type StubSession = { user: { id: string; email?: string } } | null

interface AuthStub {
  session?: StubSession
  getSessionError?: unknown
  /** What `signInWithOtp` answers. */
  requestError?: unknown
  /** What `verifyOtp` answers; a session on success. */
  verifyResult?: { data: { session: unknown }; error: unknown }
  /**
   * The signed-in user's own row in `slaids_users`, as row level security
   * returns it: `null` when they are not on the list.
   */
  accessRow?: { user_id: string; role: string; active: boolean } | null
  /** `slaids_users` could not be read. */
  accessError?: { message: string }
  signOutError?: unknown
  /**
   * The rare path where auth-js returns early and leaves the stored session in
   * place. From 2.110.2 the ordinary failure keeps *removing* it, which is what
   * the default models.
   */
  signOutKeepsSession?: boolean
  /** Emit SIGNED_OUT before `signOut` resolves, as the real SDK does. */
  signOutEmitsEvent?: boolean
}

/** What the last `signOut` call was given, so the scope can be asserted on. */
const signOutCalls: unknown[] = []
/** What the sign-in calls were given. */
const otpCalls: unknown[] = []
const verifyCalls: unknown[] = []
/** The SDK's listener, to send it an event the way another tab's broadcast does. */
let emitAuthEvent: ((event: string, session: StubSession) => void) | null = null
/** How often the access list was read. */
let accessReads = 0

/**
 * A stand-in for auth-js 2.112.4. The detail that matters: `signOut` drops the
 * stored session even when the remote revoke fails, and announces it before its
 * own promise settles.
 */
function fakeClient(stub: AuthStub = {}): SupabaseClient {
  let session: StubSession = stub.session === undefined ? null : stub.session
  let listener: ((event: string, session: StubSession) => void) | null = null
  return {
    auth: {
      onAuthStateChange: (callback: (event: string, session: StubSession) => void) => {
        listener = callback
        emitAuthEvent = callback
        return { data: { subscription: { unsubscribe: () => (listener = null) } } }
      },
      getSession: () =>
        Promise.resolve({ data: { session }, error: stub.getSessionError ?? null }),
      signInWithOtp: (params: unknown) => {
        otpCalls.push(params)
        return Promise.resolve({ data: {}, error: stub.requestError ?? null })
      },
      verifyOtp: (params: unknown) => {
        verifyCalls.push(params)
        const result = stub.verifyResult ?? { data: { session }, error: null }
        if (!result.error) session = (result.data.session ?? null) as StubSession
        return Promise.resolve(result)
      },
      signOut: (options?: unknown) => {
        signOutCalls.push(options)
        if (!stub.signOutKeepsSession) {
          session = null
          if (stub.signOutEmitsEvent) listener?.('SIGNED_OUT', null)
        }
        return Promise.resolve({ error: stub.signOutError ?? null })
      },
    },
    from: (table: string) => {
      expect(table).toBe('slaids_users')
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          expect(value).toBe(session?.user.id)
          return query
        },
        maybeSingle: () => {
          accessReads += 1
          return Promise.resolve({
            data: stub.accessError
              ? null
              : stub.accessRow === undefined
                ? { user_id: session?.user.id, role: 'admin', active: true }
                : stub.accessRow,
            error: stub.accessError ?? null,
          })
        },
      }
      return query
    },
  } as unknown as SupabaseClient
}

function configure(): void {
  vi.stubEnv(URL_KEY, 'https://example.supabase.co')
  vi.stubEnv(KEY_KEY, 'sb_publishable_test')
}

beforeEach(() => {
  signOutCalls.length = 0
  otpCalls.length = 0
  verifyCalls.length = 0
  accessReads = 0
  stopSessionWatcher()
  authSessionStorage.reset()
  useSessionStore.setState({
    status: 'loading',
    userId: null,
    email: null,
    error: null,
    access: null,
    role: null,
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
    writePref(lastOpenPresentationKey(USER.id), 'p1')

    await useSessionStore.getState().start()

    // Opening a session is not leaving one: there is no previous user whose
    // traces need clearing, and the preference must survive.
    expect(readPref<string | null>(lastOpenPresentationKey(USER.id), null)).toBe('p1')
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

describe('innlogging med engangskode', () => {
  it('ber om en kode uten å kunne opprette en konto', async () => {
    configure()
    setSupabaseClient(fakeClient())

    const outcome = await useSessionStore.getState().requestCode(' Peder@Example.com ')

    expect(outcome).toEqual({ ok: true })
    expect(otpCalls).toEqual([
      { email: 'peder@example.com', options: { shouldCreateUser: false } },
    ])
    // Å be om en kode logger ingen inn.
    expect(useSessionStore.getState().userId).toBeNull()
  })

  it('sier forståelig fra om en adresse uten konto', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        requestError: {
          name: 'AuthApiError',
          status: 422,
          code: 'otp_disabled',
          message: 'Signups not allowed for otp',
        },
      }),
    )

    const outcome = await useSessionStore.getState().requestCode('ukjent@example.com')

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.failure.kind).toBe('unknown-email')
      expect(outcome.failure.message).toMatch(/administrator/)
    }
  })

  it('logger inn med koden og slipper inn et aktivt medlem', async () => {
    configure()
    setSupabaseClient(fakeClient({ verifyResult: { data: { session: { user: USER } }, error: null } }))

    const outcome = await useSessionStore.getState().verifyCode(' peder@example.com ', '123456', false)

    expect(outcome).toEqual({ ok: true })
    expect(verifyCalls).toEqual([{ email: 'peder@example.com', token: '123456', type: 'email' }])
    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-in')
    expect(state.access).toBe('member')
    expect(state.role).toBe('admin')
  })

  it('velger lagring før økten lagres: enheten når brukeren vil huskes, ellers fanen', async () => {
    configure()
    setSupabaseClient(fakeClient({ verifyResult: { data: { session: { user: USER } }, error: null } }))

    await useSessionStore.getState().verifyCode('peder@example.com', '123456', true)
    expect(authSessionStorage.persistence()).toBe('device')

    await useSessionStore.getState().signOut()
    // Utlogging glemmer valget, så neste innlogging velger på nytt.
    expect(authSessionStorage.persistence()).toBeNull()

    await useSessionStore.getState().verifyCode('peder@example.com', '123456', false)
    expect(authSessionStorage.persistence()).toBe('tab')
  })

  it('slipper ikke inn på feil eller utløpt kode', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        verifyResult: {
          data: { session: null },
          error: {
            name: 'AuthApiError',
            status: 403,
            code: 'otp_expired',
            message: 'Token has expired or is invalid',
          },
        },
      }),
    )

    const outcome = await useSessionStore.getState().verifyCode('peder@example.com', '000000', false)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure.kind).toBe('invalid-code')
    expect(useSessionStore.getState().status).not.toBe('signed-in')
  })
})

describe('flere faner', () => {
  it('tar ikke over en annen fanes innlogging som ikke ligger i egen lagring', async () => {
    vi.useFakeTimers()
    try {
      configure()
      // Denne fanen har ingen økt lagret – den andre fanen logget inn uten å
      // bli husket, altså i sin egen sessionStorage.
      setSupabaseClient(fakeClient({ session: null }))
      await useSessionStore.getState().start()

      emitAuthEvent?.('SIGNED_IN', { user: USER })
      await vi.runAllTimersAsync()

      expect(useSessionStore.getState().status).toBe('signed-out')
      expect(useSessionStore.getState().userId).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('følger en hendelse når økten faktisk ligger i lagringen', async () => {
    vi.useFakeTimers()
    try {
      configure()
      const stub: AuthStub = { session: null }
      setSupabaseClient(fakeClient(stub))
      await useSessionStore.getState().start()

      // Husket innlogging i en annen fane: økten ligger i den felles lagringen.
      setSupabaseClient(fakeClient({ session: { user: USER } }))
      emitAuthEvent?.('SIGNED_IN', { user: USER })
      await vi.runAllTimersAsync()

      expect(useSessionStore.getState().status).toBe('signed-in')
      expect(useSessionStore.getState().access).toBe('member')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('tilgangslisten', () => {
  it('slipper ikke inn en Auth-bruker som ikke står på listen', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER }, accessRow: null }))

    await useSessionStore.getState().start()

    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-in')
    expect(state.access).toBe('no-access')
    expect(state.role).toBeNull()
  })

  it('skiller en deaktivert konto fra en som aldri hadde tilgang', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        session: { user: USER },
        accessRow: { user_id: USER.id, role: 'admin', active: false },
      }),
    )

    await useSessionStore.getState().start()

    const state = useSessionStore.getState()
    expect(state.access).toBe('deactivated')
    // En deaktivert administrator er ikke administrator.
    expect(state.role).toBeNull()
  })

  it('oppdager deaktivering i en økt som allerede er åpen', async () => {
    configure()
    const row = { user_id: USER.id, role: 'user', active: true }
    setSupabaseClient(fakeClient({ session: { user: USER }, accessRow: row }))
    await useSessionStore.getState().start()
    expect(useSessionStore.getState().access).toBe('member')

    row.active = false
    await useSessionStore.getState().refreshAccess()

    expect(useSessionStore.getState().access).toBe('deactivated')
  })

  it('stopper appen hvis den første tilgangssjekken ikke får svar', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER }, accessError: { message: 'nede' } }))

    await useSessionStore.getState().start()

    const state = useSessionStore.getState()
    expect(state.status).toBe('unavailable')
    expect(state.error).toMatch(/tilgang/)
  })

  it('kaster ikke et medlem ut fordi en ny sjekk ikke fikk svar', async () => {
    configure()
    const stub: AuthStub = { session: { user: USER } }
    setSupabaseClient(fakeClient(stub))
    await useSessionStore.getState().start()

    stub.accessError = { message: 'nettverksbrudd' }
    await useSessionStore.getState().refreshAccess()

    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-in')
    expect(state.access).toBe('member')
  })

  it('deler én forespørsel når flere ber om sjekk samtidig', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER } }))
    await useSessionStore.getState().start()
    accessReads = 0

    await Promise.all([
      useSessionStore.getState().refreshAccess(),
      useSessionStore.getState().refreshAccess(),
    ])

    expect(accessReads).toBe(1)
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
  it('logger bare ut i denne nettleseren, ikke på andre enheter', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER } }))
    await useSessionStore.getState().start()

    await useSessionStore.getState().signOut()

    // The default global scope would revoke every refresh token the user has.
    expect(signOutCalls).toEqual([{ scope: 'local' }])
    expect(useSessionStore.getState().status).toBe('signed-out')
  })

  it('følger SDK-en når serveren ikke bekreftet utloggingen', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        session: { user: USER },
        signOutError: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
      }),
    )
    await useSessionStore.getState().start()
    useEditorStore.getState().setPresentation(createPresentation({ title: 'Hemmelig' }))
    writePref(lastOpenPresentationKey(USER.id), 'p1')

    await useSessionStore.getState().signOut()

    // auth-js fjerner den lagrede sesjonen også når revoke-kallet feiler. Å bli
    // stående som innlogget ville satt storen i strid med SDK-en, og reloaden
    // ville avgjort den striden mot oss.
    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-out')
    expect(state.userId).toBeNull()
    // Og da må brukerens data være borte fra skjermen, akkurat som ellers.
    expect(useEditorStore.getState().presentation).toBeNull()
    expect(readPref<string | null>(lastOpenPresentationKey(USER.id), null)).toBeNull()
  })

  it('tåler at SIGNED_OUT kommer før signOut-løftet er ferdig', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        session: { user: USER },
        signOutError: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
        signOutEmitsEvent: true,
      }),
    )
    await useSessionStore.getState().start()
    useEditorStore.getState().setPresentation(createPresentation({ title: 'Hemmelig' }))

    await useSessionStore.getState().signOut()

    expect(useSessionStore.getState().status).toBe('signed-out')
    expect(useEditorStore.getState().presentation).toBeNull()
  })

  it('blir stående innlogget bare hvis SDK-en faktisk beholdt sesjonen', async () => {
    configure()
    setSupabaseClient(
      fakeClient({
        session: { user: USER },
        signOutError: { name: 'AuthApiError', status: 500, message: 'boom' },
        signOutKeepsSession: true,
      }),
    )
    await useSessionStore.getState().start()

    await useSessionStore.getState().signOut()

    // Samme regel, motsatt utfall: storen speiler SDK-en, ikke feilen.
    expect(useSessionStore.getState().status).toBe('signed-in')
    expect(useToasts.getState().toasts.at(-1)?.message).toMatch(/fortsatt innlogget/)
  })

  it('lar ingenting fra forrige bruker bli liggende', async () => {
    configure()
    setSupabaseClient(fakeClient({ session: { user: USER } }))
    await useSessionStore.getState().start()

    useEditorStore.getState().setPresentation(createPresentation({ title: 'Hemmelig' }))
    writePref(lastOpenPresentationKey(USER.id), 'p1')

    await useSessionStore.getState().signOut()

    const state = useSessionStore.getState()
    expect(state.status).toBe('signed-out')
    expect(state.userId).toBeNull()
    expect(state.email).toBeNull()
    expect(useEditorStore.getState().presentation).toBeNull()
    expect(readPref<string | null>(lastOpenPresentationKey(USER.id), null)).toBeNull()
  })
})

describe('sist åpne presentasjon', () => {
  it('huskes per bruker, så neste bruker i samme nettleser ikke får den', () => {
    expect(lastOpenPresentationKey('a')).not.toBe(lastOpenPresentationKey('b'))
    expect(lastOpenPresentationKey(null)).not.toBe(lastOpenPresentationKey('a'))
  })
})
