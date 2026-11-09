import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AccessStatus } from '../../state/session'
import { gateView } from './AuthGate'
import { SignInView } from './SignInView'

const ACCESS: (AccessStatus | null)[] = [null, 'checking', 'member', 'no-access', 'deactivated']

describe('gateView', () => {
  it('slipper bare gjennom lokal modus og aktive medlemmer', () => {
    expect(gateView('disabled', null)).toBe('app')
    expect(gateView('signed-in', 'member')).toBe('app')
  })

  it('slipper aldri inn en innlogget Auth-bruker som ikke er aktivt medlem', () => {
    expect(gateView('signed-in', 'no-access')).toBe('no-access')
    expect(gateView('signed-in', 'deactivated')).toBe('deactivated')
    // Mens listen spørres, og hvis svaret mangler, vises ingenting av appen.
    expect(gateView('signed-in', 'checking')).toBe('loading')
    expect(gateView('signed-in', null)).toBe('loading')
  })

  it('viser aldri appen uten sesjon når Supabase er konfigurert', () => {
    for (const access of ACCESS) {
      expect(gateView('signed-out', access)).toBe('sign-in')
      expect(gateView('loading', access)).toBe('loading')
      expect(gateView('unavailable', access)).toBe('unavailable')
      expect(gateView('misconfigured', access)).toBe('misconfigured')
    }
  })

  it('åpner appen for nøyaktig én kombinasjon i Supabase-modus', () => {
    const statuses = ['loading', 'signed-in', 'signed-out', 'unavailable', 'misconfigured'] as const
    const open = statuses.flatMap((status) =>
      ACCESS.filter((access) => gateView(status, access) === 'app').map((access) => [status, access]),
    )
    expect(open).toEqual([['signed-in', 'member']])
  })
})

describe('innloggingsskjermen', () => {
  it('ber om e-post og kode, aldri passord, og tilbyr ingen registrering', () => {
    const markup = renderToStaticMarkup(<SignInView />)

    expect(markup).toContain('data-testid="sign-in-email"')
    expect(markup).toContain('data-testid="sign-in-remember"')
    expect(markup).toContain('Hold meg innlogget på denne enheten')
    expect(markup).not.toContain('type="password"')
    expect(markup).not.toMatch(/passord:|registrer|opprett konto|ny bruker/i)
  })

  it('lar «hold meg innlogget» være et aktivt valg, ikke standard', () => {
    const markup = renderToStaticMarkup(<SignInView />)
    expect(markup).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*data-testid="sign-in-remember"/)
  })
})
