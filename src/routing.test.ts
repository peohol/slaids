import { describe, expect, it } from 'vitest'
import { newShareToken } from './domain/ids'
import { SHARE_PATH_PREFIX, isShareToken, parseRoute, shareUrl } from './routing'

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
