/**
 * The share toggle's behaviour, without a browser.
 *
 * The rules that matter: publishing waits for the save, a failed save publishes
 * nothing, a second press while one operation is in flight does nothing, and
 * the switch only moves when the server said it did.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPresentation } from '../domain/presentation'
import type { SharedPresentationSnapshot } from '../domain/sharing'
import { setSharingOverride } from '../persistence/activeRepository'
import type { ShareState, SharingRepository } from '../persistence/repository'
import { useSharingStore } from './sharing'
import { useEditorStore } from './store'

const TOKEN_A = 'aaaaaaaa-1111-4222-8333-444455556666'
const TOKEN_B = 'bbbbbbbb-1111-4222-8333-444455556666'

interface FakeSharing extends SharingRepository {
  published: SharedPresentationSnapshot[]
  calls: string[]
}

function fakeSharing(initial: ShareState, tokens = [TOKEN_A, TOKEN_B]): FakeSharing {
  let state = initial
  let next = 0
  const fake: FakeSharing = {
    published: [],
    calls: [],
    readShareState: async () => {
      fake.calls.push('read')
      return state
    },
    enableSharing: async (_id, snapshot) => {
      fake.calls.push('enable')
      fake.published.push(snapshot)
      state = { shared: true, token: tokens[next++ % tokens.length] }
      return state
    },
    disableSharing: async () => {
      fake.calls.push('disable')
      state = { shared: false, token: null }
      return state
    },
  }
  return fake
}

const presentation = createPresentation({ title: 'Å dele' })

beforeEach(() => {
  useSharingStore.setState(useSharingStore.getInitialState(), true)
  useEditorStore.getState().setPresentation(presentation)
})

afterEach(() => {
  setSharingOverride(null)
  useEditorStore.getState().setPresentation(null)
})

describe('deling – status', () => {
  it('er utilgjengelig uten en offentlig backend', async () => {
    // Ingen override og ingen Supabase-konfigurasjon: lokal modus.
    await useSharingStore.getState().load(presentation.id)
    expect(useSharingStore.getState().status).toBe('unsupported')
    expect(useSharingStore.getState().shared).toBe(false)
  })

  it('leser status fra backend', async () => {
    setSharingOverride(fakeSharing({ shared: true, token: TOKEN_A }))
    await useSharingStore.getState().load(presentation.id)
    expect(useSharingStore.getState()).toMatchObject({
      status: 'ready',
      shared: true,
      token: TOKEN_A,
    })
  })

  it('påstår ingenting når statusen ikke kunne leses', async () => {
    const fake = fakeSharing({ shared: false, token: null })
    fake.readShareState = () => Promise.reject(new Error('Supabase svarte ikke'))
    setSharingOverride(fake)

    await useSharingStore.getState().load(presentation.id)

    expect(useSharingStore.getState().status).toBe('error')
    expect(useSharingStore.getState().shared).toBe(false)
    expect(useSharingStore.getState().error).toMatch(/svarte ikke/)
  })
})

describe('deling – publisering', () => {
  it('lagrer først, og publiserer det som faktisk ble lagret', async () => {
    const fake = fakeSharing({ shared: false, token: null })
    setSharingOverride(fake)
    await useSharingStore.getState().load(presentation.id)

    const order: string[] = []
    await useSharingStore.getState().enable(async () => {
      order.push('flush')
      return true
    })
    order.push(...fake.calls.filter((call) => call === 'enable'))

    expect(order).toEqual(['flush', 'enable'])
    expect(fake.published[0]?.title).toBe('Å dele')
    expect(useSharingStore.getState()).toMatchObject({ shared: true, token: TOKEN_A, busy: false })
  })

  it('publiserer ingenting når lagringen ikke gikk igjennom', async () => {
    const fake = fakeSharing({ shared: false, token: null })
    setSharingOverride(fake)
    await useSharingStore.getState().load(presentation.id)

    await useSharingStore.getState().enable(async () => false)

    expect(fake.published).toHaveLength(0)
    expect(useSharingStore.getState()).toMatchObject({ shared: false, token: null, busy: false })
    expect(useSharingStore.getState().error).toMatch(/ikke lagret/i)
  })

  it('lar ikke to trykk starte to operasjoner', async () => {
    const fake = fakeSharing({ shared: false, token: null })
    setSharingOverride(fake)
    await useSharingStore.getState().load(presentation.id)

    let release = (): void => {}
    const held = new Promise<boolean>((resolve) => {
      release = () => resolve(true)
    })

    const first = useSharingStore.getState().enable(() => held)
    // Mens den første venter på lagringen: alt annet skal være en no-op.
    await useSharingStore.getState().enable(async () => true)
    await useSharingStore.getState().disable()
    release()
    await first

    expect(fake.calls).toEqual(['read', 'enable'])
  })

  it('flipper ikke bryteren når Supabase feiler', async () => {
    const fake = fakeSharing({ shared: false, token: null })
    fake.enableSharing = () => Promise.reject(new Error('Ingen forbindelse'))
    setSharingOverride(fake)
    await useSharingStore.getState().load(presentation.id)

    await useSharingStore.getState().enable(async () => true)

    expect(useSharingStore.getState()).toMatchObject({ shared: false, busy: false })
    expect(useSharingStore.getState().error).toMatch(/Ingen forbindelse/)
  })
})

describe('deling – avslåing og ny lenke', () => {
  it('slår av og gir en ny lenke ved neste aktivering', async () => {
    const fake = fakeSharing({ shared: false, token: null })
    setSharingOverride(fake)
    await useSharingStore.getState().load(presentation.id)

    await useSharingStore.getState().enable(async () => true)
    const first = useSharingStore.getState().token

    await useSharingStore.getState().disable()
    expect(useSharingStore.getState()).toMatchObject({ shared: false, token: null })

    await useSharingStore.getState().enable(async () => true)
    const second = useSharingStore.getState().token

    expect(first).toBe(TOKEN_A)
    expect(second).toBe(TOKEN_B)
    expect(second).not.toBe(first)
  })

  it('overlever ikke at editoren bytter presentasjon', async () => {
    setSharingOverride(fakeSharing({ shared: true, token: TOKEN_A }))
    await useSharingStore.getState().load(presentation.id)
    expect(useSharingStore.getState().shared).toBe(true)

    useSharingStore.getState().reset()
    expect(useSharingStore.getState()).toMatchObject({
      presentationId: null,
      status: 'idle',
      shared: false,
      token: null,
    })
  })

  it('bruker ikke et sent svar på en annen presentasjon', async () => {
    const fake = fakeSharing({ shared: true, token: TOKEN_A })
    let resolveRead = (state: ShareState): void => void state
    fake.readShareState = () =>
      new Promise<ShareState>((resolve) => {
        resolveRead = resolve
      })
    setSharingOverride(fake)

    const pending = useSharingStore.getState().load(presentation.id)
    // Editoren har gått videre til noe annet før svaret kom.
    useSharingStore.getState().reset()
    resolveRead({ shared: true, token: TOKEN_A })
    await pending

    expect(useSharingStore.getState()).toMatchObject({ status: 'idle', shared: false })
  })
})
