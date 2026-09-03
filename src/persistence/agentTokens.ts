/**
 * Agent tokens: what one is, and where one is stored.
 *
 * A token is a **delegation from the Slaids owner**, not a second user account.
 * The row names the owner, and that is where `owner_id` comes from on every
 * write the agent API makes — a caller never names an owner, and there is no
 * second identity in the system. See `IMPLEMENTATION_PLAN.md` §44,
 * "Autentisering av agenter".
 *
 * The model, in the order it matters:
 *
 *  - 32 bytes from the platform CSPRNG, and nothing derived from anything;
 *  - only the SHA-256 is stored, so the database is not a set of working keys
 *    and the owner cannot be shown the secret a second time;
 *  - a name, a creation time, an optional expiry, the time it was last used and
 *    an explicit revocation, so a token that is doing something unexpected can
 *    be recognised and taken away;
 *  - and scopes, which is what makes "may edit" and "may publish" two different
 *    permissions rather than one.
 *
 * Tokens are created in the browser, by the signed-in owner, and the raw value
 * never leaves it except to be shown once. The server only ever sees the hash of
 * what a caller presents. That is why this file lives in the persistence layer
 * rather than under `src/server/`: both sides need the same answer to "what is a
 * token", and a second copy of that answer is a second thing to get wrong.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { AGENT_SCOPES, isAgentScope, type AgentScope } from '../agent/types'
import { getSupabaseClient } from '../supabase/client'
import { RepositoryError } from './repository'

export const AGENT_TOKENS_TABLE = 'slaids_agent_tokens'
export const AGENT_AUDIT_TABLE = 'slaids_agent_audit'

/**
 * What every Slaids agent token starts with.
 *
 * Not a secret and not a checksum — it is there so a leaked token is
 * recognisable as one. Secret scanners key on prefixes, and a string nobody can
 * attribute is a string nobody revokes.
 */
export const AGENT_TOKEN_PREFIX = 'slaids_at_'

/** 32 bytes. The token is the only thing standing in front of the API. */
export const AGENT_TOKEN_BYTES = 32

/** Base64url of 32 bytes, unpadded. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** A stored token, as both the API and the management UI read it. */
export interface AgentTokenRecord {
  id: string
  ownerId: string
  name: string
  scopes: AgentScope[]
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
}

/** What a token creation returns: the secret, once, and the row it made. */
export interface CreatedAgentToken {
  /** Shown to the owner and then gone. Nothing stores this. */
  token: string
  record: AgentTokenRecord
}

export interface NewAgentToken {
  name: string
  scopes: readonly AgentScope[]
  /** ISO timestamp, or `null` for a token that does not expire on its own. */
  expiresAt: string | null
}

/** Whether a string could be a Slaids token at all, without asking the database. */
export function looksLikeAgentToken(token: string): boolean {
  return (
    token.startsWith(AGENT_TOKEN_PREFIX) &&
    SECRET_PATTERN.test(token.slice(AGENT_TOKEN_PREFIX.length))
  )
}

/**
 * Mint a token.
 *
 * Refuses rather than falling back when there is no cryptographic randomness,
 * for the same reason `newShareToken` does: a weak secret that looks like a
 * strong one is worse than an error, because nothing downstream can tell.
 */
export function createAgentToken(): string {
  const source = globalThis.crypto
  if (typeof source?.getRandomValues !== 'function') {
    throw new Error(
      'Kan ikke lage et agenttoken her: kjøremiljøet mangler en kryptografisk tilfeldighetskilde.',
    )
  }
  return `${AGENT_TOKEN_PREFIX}${base64url(source.getRandomValues(new Uint8Array(AGENT_TOKEN_BYTES)))}`
}

/**
 * The only form of a token that is ever stored.
 *
 * SHA-256, unsalted and without a work factor, deliberately: this is not a
 * password. The input is 256 bits of uniform randomness, so there is no
 * dictionary to try and no rainbow table to build, and the lookup has to be an
 * indexed equality on the hash — a per-row salt would turn every request into a
 * table scan and buy nothing.
 *
 * It is also why the API never compares two secrets in JavaScript: the hash is
 * what it looks the row up by, so there is no comparison to leak timing through.
 */
export async function hashAgentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Scopes as stored, read defensively.
 *
 * Anything this build does not recognise is dropped rather than carried along:
 * a scope name is authority, and authority nobody has implemented is not
 * authority to grant. Duplicates collapse, and the order is canonical, so two
 * tokens with the same permissions read the same.
 */
export function readScopes(value: unknown): AgentScope[] {
  const raw = Array.isArray(value) ? value : []
  const held = new Set(raw.filter(isAgentScope))
  return AGENT_SCOPES.filter((scope) => held.has(scope))
}

/** One database row as a record, or `null` when it is not usable as one. */
export function agentTokenFromRow(row: unknown): AgentTokenRecord | null {
  if (!row || typeof row !== 'object') return null
  const entry = row as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id : null
  const ownerId = typeof entry.owner_id === 'string' ? entry.owner_id : null
  if (!id || !ownerId) return null
  return {
    id,
    ownerId,
    name: typeof entry.name === 'string' ? entry.name : '',
    scopes: readScopes(entry.scopes),
    createdAt: isoOr(entry.created_at, new Date(0).toISOString()),
    expiresAt: isoOrNull(entry.expires_at),
    lastUsedAt: isoOrNull(entry.last_used_at),
    revokedAt: isoOrNull(entry.revoked_at),
  }
}

/** Whether a record may act at this moment, ignoring scopes. */
export function isAgentTokenActive(record: AgentTokenRecord, now: Date): boolean {
  if (record.revokedAt) return false
  return !record.expiresAt || Date.parse(record.expiresAt) > now.getTime()
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

/**
 * The token table, from either side.
 *
 * The owner's browser calls `list`, `create` and `revoke` with the publishable
 * key, so row level security is what limits it to their own rows. The agent API
 * calls `findByHash` and `touch` with the server key, which bypasses RLS — so
 * those two are the ones that carry their own filters, and neither of them can
 * be reached from the browser.
 */
export class SupabaseAgentTokens {
  constructor(private readonly resolveClient: () => SupabaseClient = getSupabaseClient) {}

  private get client(): SupabaseClient {
    return this.resolveClient()
  }

  /**
   * Every token the signed-in owner has, newest first.
   *
   * `token_hash` is not selected. It is not a usable secret, but an audit and a
   * management screen have no business handling one either, and a column that
   * is never fetched cannot be leaked by a screenshot.
   */
  async list(): Promise<AgentTokenRecord[]> {
    const { data, error } = await this.client
      .from(AGENT_TOKENS_TABLE)
      .select('id, owner_id, name, scopes, created_at, expires_at, last_used_at, revoked_at')
      .order('created_at', { ascending: false })
    if (error) throw new RepositoryError(`Kunne ikke hente agenttokens (${error.message}).`, error)
    return ((data ?? []) as unknown[])
      .map(agentTokenFromRow)
      .filter((record): record is AgentTokenRecord => record !== null)
  }

  /**
   * Mint a token, store its hash, and hand the secret back exactly once.
   *
   * The raw value is generated here, in the owner's own browser, and the only
   * thing that goes to the database is its hash — so there is no moment at
   * which a server holds a usable token, not even the one that created it.
   */
  async create(input: NewAgentToken): Promise<CreatedAgentToken> {
    const scopes = readScopes(input.scopes)
    if (scopes.length === 0) {
      throw new RepositoryError('Et token uten scopes kan ikke gjøre noe. Velg minst ett.')
    }
    const name = input.name.trim()
    if (name.length === 0) {
      throw new RepositoryError('Gi tokenet et navn, så du vet hva det brukes til.')
    }

    const token = createAgentToken()
    const { data, error } = await this.client
      .from(AGENT_TOKENS_TABLE)
      .insert({
        owner_id: await this.ownerId(),
        name,
        token_hash: await hashAgentToken(token),
        scopes,
        expires_at: input.expiresAt,
      })
      .select('id, owner_id, name, scopes, created_at, expires_at, last_used_at, revoked_at')
      .single()
    if (error) throw new RepositoryError(`Kunne ikke lage agenttokenet (${error.message}).`, error)

    const record = agentTokenFromRow(data)
    if (!record) throw new RepositoryError('Agenttokenet ble lagret, men raden kunne ikke leses.')
    return { token, record }
  }

  /**
   * Revoke, rather than delete.
   *
   * The row stays so the audit rows that point at it keep a name, and so the
   * owner can see that a token existed and when it was taken away. Deleting is
   * a separate, deliberate act.
   */
  async revoke(id: string): Promise<void> {
    const { error } = await this.client
      .from(AGENT_TOKENS_TABLE)
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('revoked_at', null)
    if (error) throw new RepositoryError(`Kunne ikke trekke tilbake tokenet (${error.message}).`, error)
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from(AGENT_TOKENS_TABLE).delete().eq('id', id)
    if (error) throw new RepositoryError(`Kunne ikke slette tokenet (${error.message}).`, error)
  }

  /**
   * The row a presented token hashes to, if any.
   *
   * Server-side only: it reads by hash across the table, which is exactly what
   * row level security stops the browser from doing.
   */
  async findByHash(tokenHash: string): Promise<AgentTokenRecord | null> {
    const { data, error } = await this.client
      .from(AGENT_TOKENS_TABLE)
      .select('id, owner_id, name, scopes, created_at, expires_at, last_used_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (error) throw new RepositoryError(`Kunne ikke slå opp agenttokenet (${error.message}).`, error)
    return data ? agentTokenFromRow(data) : null
  }

  /** Record that a token was used. Best effort: never fails a request. */
  async touch(id: string, at: Date): Promise<void> {
    await this.client
      .from(AGENT_TOKENS_TABLE)
      .update({ last_used_at: at.toISOString() })
      .eq('id', id)
  }

  /**
   * Who is signed in.
   *
   * The same rule as everywhere else: `owner_id` comes from the session, never
   * from a caller. RLS enforces it as well; this is what keeps the browser from
   * even trying to write somebody else's row.
   */
  private async ownerId(): Promise<string> {
    const { data, error } = await this.client.auth.getSession()
    if (error) throw new RepositoryError(`Kunne ikke lese innloggingen (${error.message}).`, error)
    const id = data?.session?.user?.id
    if (!id) throw new RepositoryError('Du er ikke logget inn. Logg inn på nytt for å fortsette.')
    return id
  }
}

function isoOr(value: unknown, fallback: string): string {
  return isoOrNull(value) ?? fallback
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 =
    typeof globalThis.btoa === 'function'
      ? globalThis.btoa(binary)
      : bufferFrom(binary).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Node without `btoa`. Typed narrowly so this file needs no Node types. */
function bufferFrom(binary: string): { toString(encoding: string): string } {
  const buffer = (
    globalThis as {
      Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } }
    }
  ).Buffer
  if (!buffer) throw new Error('Kjøremiljøet kan ikke kode base64.')
  return buffer.from(binary, 'binary')
}
