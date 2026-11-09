/**
 * The public surface.
 *
 * Two things are checked here, and they are the two that matter: a share link
 * is reachable without a session, and what it reaches has no editor in it.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '../../App'
import { Root } from '../../Root'
import { QR_PAGE_ID, deckPages } from '../../domain/pages'
import { createPresentation } from '../../domain/presentation'
import { buildSharedSnapshot } from '../../domain/sharing'
import { gateView } from '../auth/AuthGate'
import { PresentationPlayer } from '../present/PresentationPlayer'
import { DeckPageView } from '../slide/DeckPageView'
import { SharedPresentationView } from './SharedPresentationView'

const TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'
const SHARE_URL = `https://slaids.example/s/${TOKEN}`

/** Every part of the workspace that must never appear on a shared page. */
const EDITOR_TESTIDS = [
  'top-toolbar',
  'filmstrip',
  'inspector',
  'editor',
  'status-bar',
  'library',
  'share-toggle',
  'add-slide',
]

describe('Root', () => {
  it('monterer den delte visningen for /s/<token>, ikke arbeidsområdet', () => {
    // Selve avgjørelsen, ikke et avtrykk av den: det som gjør at delingen aldri
    // krever innlogging er at `App` — og dermed `AuthGate` — ikke er i treet.
    expect(Root({ pathname: `/s/${TOKEN}` }).type).toBe(SharedPresentationView)
    expect(Root({ pathname: '/' }).type).toBe(App)
    expect(Root({ pathname: '/bibliotek' }).type).toBe(App)
  })

  it('holder en ødelagt delingsadresse på den offentlige siden', () => {
    // Poenget: en anonym mottaker av en avkortet lenke skal aldri havne på
    // eierens innloggingsskjerm.
    expect(Root({ pathname: '/s/ikke-et-token' }).type).toBe(SharedPresentationView)
    expect(Root({ pathname: '/s/' }).type).toBe(SharedPresentationView)
    expect(Root({ pathname: '/s' }).type).toBe(SharedPresentationView)
  })

  it('svarer lokalt på et ugyldig token, uten å spørre serveren', () => {
    const calls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input))
      return Promise.reject(new Error('skal ikke kalles'))
    }) as typeof globalThis.fetch
    try {
      const markup = renderToStaticMarkup(<Root pathname="/s/ikke-et-token" />)
      expect(markup).toContain('data-testid="shared-not-found"')
      expect(markup).toContain('Denne delingslenken er ikke aktiv')
      expect(markup).not.toContain('auth-')
      expect(markup).not.toContain('shared-loading')
    } finally {
      globalThis.fetch = original
    }
    expect(calls).toEqual([])
  })

  it('viser den delte visningen uten et eneste auth-steg', () => {
    const markup = renderToStaticMarkup(<Root pathname={`/s/${TOKEN}`} />)

    expect(markup).toContain('data-testid="shared-loading"')
    expect(markup).not.toContain('auth-')
    expect(markup).not.toContain('sign-in')
  })

  it('lar arbeidsområdet være portet som før', () => {
    // Porten selv er dekket av `gateView`; her er poenget bare at
    // arbeidsområdet fortsatt går gjennom den, og at ingenting av
    // delingsvisningen er blandet inn i det.
    expect(gateView('signed-out', null)).toBe('sign-in')
    expect(gateView('loading', null)).toBe('loading')

    const markup = renderToStaticMarkup(<Root pathname="/" />)
    expect(markup).not.toContain('shared-')
    expect(markup).not.toContain('qr-page')
  })
})

describe('den delte visningen', () => {
  const deck = buildSharedSnapshot(createPresentation({ title: 'Delt dekk' }))

  it('viser presentasjonen og ingenting fra editoren', () => {
    const markup = renderToStaticMarkup(
      <PresentationPlayer deck={deck} shareUrl={SHARE_URL} onExit={null} />,
    )

    expect(markup).toContain('data-testid="present-view"')
    for (const testid of EDITOR_TESTIDS) {
      expect(markup).not.toContain(`data-testid="${testid}"`)
    }
  })

  it('har ingen vei tilbake til editoren, og ingen chrome over sliden', () => {
    // Siden er hele skjermen: ingen teller, ingen avslutt-knapp, ingenting
    // tegnet oppå. Veien ut er Escape, og den finnes bare der `onExit` gjør
    // det — som er nøyaktig det den delte visningen ikke sender med.
    const shared = renderToStaticMarkup(
      <PresentationPlayer deck={deck} shareUrl={SHARE_URL} onExit={null} />,
    )
    const local = renderToStaticMarkup(
      <PresentationPlayer deck={deck} shareUrl={SHARE_URL} onExit={() => {}} />,
    )

    for (const markup of [shared, local]) {
      expect(markup).not.toContain('present__exit')
      expect(markup).not.toContain('present__hud')
      expect(markup).not.toContain('<button')
    }
  })
})

describe('QR-siden', () => {
  it('viser lenken og en skannbar kode', () => {
    const pages = deckPages(createPresentation({ title: 'Med QR' }), { shareUrl: SHARE_URL })
    const qr = pages.at(-1)
    expect(qr?.kind).toBe('qr')
    if (qr?.kind !== 'qr') return
    expect(qr.id).toBe(QR_PAGE_ID)

    const markup = renderToStaticMarkup(<DeckPageView page={qr} />)
    expect(markup).toContain('data-testid="qr-page"')
    expect(markup).toContain('Se presentasjonen')
    expect(markup).toContain(SHARE_URL)
    expect(markup).toContain('<svg')
  })
})
