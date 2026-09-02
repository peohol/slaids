import { describe, expect, it } from 'vitest'
import { newShareToken } from './domain/ids'
import { SHARE_PATH_PREFIX, isShareToken, parseRoute, shareUrl } from './routing'

const TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'

describe('parseRoute', () => {
  it('sender alt annet enn /s/<token> til arbeidsområdet', () => {
    for (const path of ['/', '/bibliotek', '/s', '/s/', '/share/' + TOKEN, '/x/' + TOKEN]) {
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

  it('behandler noe som ikke er et token som en vanlig adresse', () => {
    for (const junk of ['abc', `${TOKEN}extra`, `${TOKEN}/noe`, '../../etc/passwd']) {
      expect(parseRoute(`${SHARE_PATH_PREFIX}${junk}`)).toEqual({ kind: 'workspace' })
    }
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
