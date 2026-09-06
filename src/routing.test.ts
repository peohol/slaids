import { describe, expect, it } from 'vitest'
import { newShareToken } from './domain/ids'
import {
  AGENT_API_BASE_PATH,
  AGENT_API_PATH_PARAM,
  OAUTH_CONSENT_PATH,
  SHARE_PATH_PREFIX,
  agentApiUrl,
  isShareToken,
  parseRoute,
  shareUrl,
} from './routing'

const TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'

describe('parseRoute', () => {
  it('sender vanlige adresser til arbeidsområdet', () => {
    for (const path of ['/', '/bibliotek', '/settings', '/share/' + TOKEN, '/x/' + TOKEN, '/sok']) {
      expect(parseRoute(path)).toEqual({ kind: 'workspace' })
    }
  })

  it('kjenner igjen en delingslenke', () => {
    expect(parseRoute(`${SHARE_PATH_PREFIX}${TOKEN}`)).toEqual({ kind: 'shared', token: TOKEN })
    expect(parseRoute(`${SHARE_PATH_PREFIX}${TOKEN}/`)).toEqual({ kind: 'shared', token: TOKEN })
    expect(parseRoute(`${SHARE_PATH_PREFIX}${TOKEN.toUpperCase()}`)).toEqual({
      kind: 'shared',
      token: TOKEN,
    })
  })

  it('holder en ødelagt delingsadresse på den offentlige siden', () => {
    // En lenke som er avkortet i en chat, eller skrevet av med et tegn for lite,
    // tilhører den som fikk den. De skal møte «lenken er ikke aktiv» – ikke
    // eierens innlogging.
    for (const junk of ['abc', `${TOKEN}extra`, `${TOKEN.slice(0, 20)}`, 'noe/mer', '../../etc/passwd']) {
      expect(parseRoute(`${SHARE_PATH_PREFIX}${junk}`)).toEqual({ kind: 'shared', token: null })
    }
  })

  it('behandler en avkortet delingsadresse som en delingsadresse', () => {
    expect(parseRoute('/s/')).toEqual({ kind: 'shared', token: null })
    expect(parseRoute('/s')).toEqual({ kind: 'shared', token: null })
  })

  it('kjenner igjen samtykkesiden, og bare den', () => {
    expect(parseRoute(OAUTH_CONSENT_PATH)).toEqual({ kind: 'oauth-consent' })
    expect(parseRoute(`${OAUTH_CONSENT_PATH}/`)).toEqual({ kind: 'oauth-consent' })
    // Neighbours are not it. The path is a Supabase setting, so it has to match
    // exactly rather than by prefix.
    for (const near of ['/oauth', '/oauth/consents', `${OAUTH_CONSENT_PATH}/noe`]) {
      expect(parseRoute(near)).toEqual({ kind: 'workspace' })
    }
  })

  it('holder samtykkesiden på den private siden', () => {
    // Approving an application's access to the owner's decks is the owner's
    // act: this address must never end up where `/s/` is.
    expect(parseRoute(OAUTH_CONSENT_PATH)).not.toEqual({ kind: 'shared', token: null })
  })
})

describe('share-token', () => {
  it('lager et token som ruteren kjenner igjen', () => {
    const token = newShareToken()
    expect(isShareToken(token)).toBe(true)
    expect(parseRoute(`${SHARE_PATH_PREFIX}${token}`)).toEqual({ kind: 'shared', token })
  })

  it('gir et nytt token hver gang', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newShareToken()))
    expect(tokens.size).toBe(50)
  })
})

describe('shareUrl', () => {
  it('bygger adressen fra origin', () => {
    expect(shareUrl('https://slaids.example', TOKEN)).toBe(`https://slaids.example/s/${TOKEN}`)
    expect(shareUrl('https://slaids.example/', TOKEN)).toBe(`https://slaids.example/s/${TOKEN}`)
  })
})

describe('agentApiUrl', () => {
  const ORIGIN = 'https://slaids.example'
  const forwarded = (value: string, query = ''): URL =>
    new URL(`${ORIGIN}${AGENT_API_BASE_PATH}?${AGENT_API_PATH_PARAM}=${value}${query}`)

  it('lar en adresse verten rutet riktig stå urørt', () => {
    const direct = new URL(`${ORIGIN}${AGENT_API_BASE_PATH}/operations/list_presentations`)
    expect(agentApiUrl(direct).href).toBe(direct.href)
  })

  it('setter stien sammen igjen fra parameteren rewriten la den i', () => {
    expect(agentApiUrl(forwarded('operations/list_presentations')).pathname).toBe(
      `${AGENT_API_BASE_PATH}/operations/list_presentations`,
    )
    expect(agentApiUrl(forwarded('operations')).pathname).toBe(`${AGENT_API_BASE_PATH}/operations`)
  })

  it('leser en tom parameter som selve basisadressen', () => {
    expect(agentApiUrl(forwarded('')).pathname).toBe(AGENT_API_BASE_PATH)
    expect(agentApiUrl(forwarded('/')).pathname).toBe(AGENT_API_BASE_PATH)
  })

  it('fjerner parameteren, så en råopplasting ikke får et felt den aldri sendte', () => {
    // The query string is an operation's input for a raw binary upload, and its
    // schema is strict: a parameter the platform added would be rejected as an
    // unknown field on a request the agent wrote correctly.
    const url = agentApiUrl(forwarded('operations/upload_asset', '&presentationId=p_1&name=f.png'))
    expect(url.searchParams.has(AGENT_API_PATH_PARAM)).toBe(false)
    expect(url.searchParams.get('presentationId')).toBe('p_1')
    expect(url.searchParams.get('name')).toBe('f.png')
  })
})
