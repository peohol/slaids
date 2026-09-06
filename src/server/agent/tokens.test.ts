/**
 * The credential itself: what a token is, and when one may act.
 *
 * All pure, and all of it is the authentication decision — so this is the file
 * that says, in code, that a revoked token is dead, that an expired one is
 * dead, that an unknown scope is never authority, and that nothing about which
 * of those it was reaches the caller.
 */

import { describe, expect, it } from 'vitest'
import { AGENT_SCOPES } from '../../agent/types'
import {
  AGENT_TOKEN_PREFIX,
  agentTokenFromRow,
  createAgentToken,
  hashAgentToken,
  isAgentTokenActive,
  looksLikeAgentToken,
  readScopes,
  type AgentTokenRecord,
} from '../../persistence/agentTokens'
import { REFUSAL_CODES, bearerToken, missingScopes, tokenValidity } from './tokens'

const NOW = new Date('2026-09-02T12:00:00.000Z')

function record(overrides: Partial<AgentTokenRecord> = {}): AgentTokenRecord {
  return {
    id: 'token-1',
    ownerId: 'owner-1',
    name: 'Byggeagenten',
    scopes: ['presentations:read', 'presentations:write'],
    createdAt: '2026-09-01T10:00:00.000Z',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

describe('tokenformatet', () => {
  it('lager tokens som er unike, gjenkjennelige og lange nok', () => {
    const minted = Array.from({ length: 50 }, () => createAgentToken())
    expect(new Set(minted).size).toBe(minted.length)
    for (const token of minted) {
      expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true)
      expect(looksLikeAgentToken(token)).toBe(true)
      // 32 bytes as unpadded base64url.
      expect(token.length - AGENT_TOKEN_PREFIX.length).toBe(43)
    }
  })

  it('avviser noe som ikke kan være et Slaids-token, uten å spørre databasen', () => {
    expect(looksLikeAgentToken('')).toBe(false)
    expect(looksLikeAgentToken('Bearer')).toBe(false)
    expect(looksLikeAgentToken(`${AGENT_TOKEN_PREFIX}kort`)).toBe(false)
    expect(looksLikeAgentToken(createAgentToken().slice(0, -1))).toBe(false)
    // A JWT is the other credential in this project. It is not this one.
    expect(looksLikeAgentToken('eyJhbGciOiJIUzI1NiJ9.e30.abc')).toBe(false)
  })

  it('lagrer bare en hash, og den samme hashen hver gang', async () => {
    const token = createAgentToken()
    const hash = await hashAgentToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashAgentToken(token)).toBe(hash)
    expect(hash).not.toContain(token.slice(AGENT_TOKEN_PREFIX.length))
    expect(await hashAgentToken(createAgentToken())).not.toBe(hash)
  })
})

describe('bearerToken', () => {
  it('leser tokenet ut av headeren, og bare i den ene formen', () => {
    expect(bearerToken('Bearer abc')).toBe('abc')
    expect(bearerToken('bearer   abc')).toBe('abc')
    expect(bearerToken('  Bearer abc  ')).toBe('abc')
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken('abc')).toBeNull()
    expect(bearerToken('Bearer')).toBeNull()
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken('Bearer a b')).toBeNull()
  })
})

describe('tokenValidity', () => {
  it('slipper gjennom et levende token med scopene sine', () => {
    expect(tokenValidity(record(), NOW)).toEqual({
      ok: true,
      principal: {
        kind: 'agent_token',
        tokenId: 'token-1',
        tokenName: 'Byggeagenten',
        ownerId: 'owner-1',
        scopes: ['presentations:read', 'presentations:write'],
      },
    })
  })

  it('stopper et tilbakekalt token, og navngir det for auditen', () => {
    const revoked = record({ revokedAt: '2026-09-02T09:00:00.000Z' })
    expect(tokenValidity(revoked, NOW)).toEqual({
      ok: false,
      reason: 'revoked',
      // Recognised, so the refusal can be written down. The caller is still
      // told only «UNAUTHENTICATED».
      identified: { kind: 'agent_token' as const, ownerId: 'owner-1', tokenId: 'token-1', tokenName: 'Byggeagenten' },
    })
    expect(isAgentTokenActive(revoked, NOW)).toBe(false)
  })

  it('stopper et utløpt token, og godtar det helt til utløpet', () => {
    expect(tokenValidity(record({ expiresAt: '2026-09-02T11:59:59.000Z' }), NOW)).toMatchObject({
      ok: false,
      reason: 'expired',
    })
    // The boundary is exclusive: a token expiring exactly now is expired.
    expect(tokenValidity(record({ expiresAt: NOW.toISOString() }), NOW)).toMatchObject({
      ok: false,
      reason: 'expired',
    })
    expect(tokenValidity(record({ expiresAt: '2026-09-02T12:00:01.000Z' }), NOW).ok).toBe(true)
  })

  it('stopper et token uten gjenkjennelige scopes', () => {
    // Fail closed. A scope this build does not implement is not authority, so a
    // token left with none of them can do nothing at all.
    expect(tokenValidity(record({ scopes: [] }), NOW)).toMatchObject({
      ok: false,
      reason: 'no-scopes',
    })
  })

  it('er ukjent for en rad som ikke finnes, og navngir da ingen', () => {
    // Nothing to attribute, so nothing is written down: an unauthenticated
    // caller must not be able to put rows in somebody's audit.
    expect(tokenValidity(null, NOW)).toEqual({ ok: false, reason: 'unknown' })
  })

  it('har en auditkode for hver avvisningsgrunn', () => {
    for (const reason of [
      'missing',
      'malformed',
      'unknown',
      'revoked',
      'expired',
      'no-scopes',
      'unavailable',
    ] as const) {
      expect(REFUSAL_CODES[reason]).toMatch(/^TOKEN_[A-Z_]+$/)
    }
  })
})

describe('scopes', () => {
  it('dropper ukjente navn og beholder rekkefølgen', () => {
    expect(readScopes(['sharing:write', 'presentations:read', 'presentations:read'])).toEqual([
      'presentations:read',
      'sharing:write',
    ])
    expect(readScopes(['alt:*', 'admin', 42, null])).toEqual([])
    expect(readScopes('presentations:read')).toEqual([])
    expect(readScopes([...AGENT_SCOPES])).toEqual([...AGENT_SCOPES])
  })

  it('sier nøyaktig hva som mangler', () => {
    const holder = { scopes: ['presentations:read'] as const }
    expect(missingScopes(holder, ['presentations:read'])).toEqual([])
    expect(missingScopes(holder, ['presentations:read', 'sharing:write'])).toEqual(['sharing:write'])
  })
})

describe('agentTokenFromRow', () => {
  it('leser en rad defensivt', () => {
    expect(
      agentTokenFromRow({
        id: 'a',
        owner_id: 'b',
        name: 'Agent',
        scopes: ['assets:write', 'ikke-et-scope'],
        created_at: '2026-09-01 10:00:00+00',
        expires_at: null,
        last_used_at: 'ikke en dato',
        revoked_at: '2026-09-02 09:00:00+00',
      }),
    ).toEqual({
      id: 'a',
      ownerId: 'b',
      name: 'Agent',
      scopes: ['assets:write'],
      createdAt: '2026-09-01T10:00:00.000Z',
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: '2026-09-02T09:00:00.000Z',
    })
  })

  it('avviser en rad uten id eller eier', () => {
    expect(agentTokenFromRow(null)).toBeNull()
    expect(agentTokenFromRow({ id: 'a' })).toBeNull()
    expect(agentTokenFromRow({ owner_id: 'b' })).toBeNull()
  })
})
