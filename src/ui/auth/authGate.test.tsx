import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { gateView } from './AuthGate'
import { SignInView } from './SignInView'

describe('gateView', () => {
  it('slipper bare gjennom lokal modus og innlogget bruker', () => {
    expect(gateView('disabled')).toBe('app')
    expect(gateView('signed-in')).toBe('app')
  })

  it('viser aldri appen uten sesjon når Supabase er konfigurert', () => {
    expect(gateView('signed-out')).toBe('sign-in')
    expect(gateView('loading')).toBe('loading')
    expect(gateView('unavailable')).toBe('unavailable')
  })
})

describe('innloggingsskjermen', () => {
  it('tilbyr innlogging og ingen registrering', () => {
    const markup = renderToStaticMarkup(<SignInView />)

    expect(markup).toContain('data-testid="sign-in-email"')
    expect(markup).toContain('data-testid="sign-in-password"')
    expect(markup).toContain('Logg inn')
    expect(markup).not.toMatch(/registrer|opprett konto|ny bruker/i)
  })
})
