/**
 * The second credential family: an OAuth 2.1 access token from Supabase Auth.
 *
 * Slaids has always had exactly one way in — an agent token the owner mints in
 * the library and pastes into a client. That works everywhere a client can be
 * handed a static string, and it is unchanged. What it does not work with is
 * ChatGPT, which does not offer "paste an API key" for a custom MCP app at all:
 * a connector either needs no credential or it authorises over OAuth. So this
 * file adds the second family, and nothing else about the API moves — both end
 * up as an `AgentPrincipal` in front of the same `authorizeOperation` and the
 * same `performOperation`.
 *
 * ## Why Supabase is the authorization server
 *
 * Slaids already has one. The workspace is behind Supabase Auth, `owner_id`
 * comes from that session on every write, and Supabase Auth can act as an
 * OAuth 2.1 authorization server with PKCE, refresh-token rotation, dynamic
 * client registration and RFC 8414 metadata. Writing a second one here would be
 * a second user directory, a second consent screen and a second set of secrets
 * for the same people — which `CLAUDE.md` already forbids for the browser
 * ("aldri et eget bruker-/passordsystem") and which is no more attractive
 * server-side.
 *
 * Slaids is therefore an OAuth **resource server** and nothing more: it
 * publishes where its authorization server is (RFC 9728, see
 * `resourceMetadata.ts`), and it verifies the tokens that server issued.
 *
 * ## What "verify" means here, exactly
 *
 * Never "decode and believe". A JWT payload is base64, not evidence, so the
 * order below is the order it has to be in — signature first, and every claim
 * read only from the verified payload:
 *
 *  1. **The header names an asymmetric algorithm this file implements.** `none`
 *     and every `HS*` are refused before anything else. That is not a
 *     completeness gap: accepting an HMAC algorithm on a key set of *public*
 *     keys is the classic algorithm-confusion forgery, where the attacker signs
 *     with the public key everybody can fetch.
 *  2. **The signature verifies against the project's JWKS.** Fetched from the
 *     issuer, cached warm, refetched once when a `kid` is unknown — which is
 *     what a key rotation looks like from here.
 *  3. **`iss` is exactly this deployment's Supabase issuer.** A token from
 *     another project is a token from another authorization server.
 *  4. **`aud` is one this resource accepts.** Supabase issues `authenticated`
 *     for every user token today, so that is the default; a deployment that
 *     arranges a narrower audience names it in `SLAIDS_AGENT_OAUTH_AUDIENCE`.
 *  5. **`client_id` is present.** This is the load-bearing one, and it is the
 *     closest thing to audience binding that today's Supabase can express: only
 *     a token minted through the OAuth authorization-code flow carries it. A
 *     plain browser session token — the one the editor holds, with the same
 *     issuer and the same audience — has none, so it cannot be replayed here.
 *     Without this check, every signed-in tab would be an MCP credential.
 *  6. **`exp` has not passed**, with no leeway. Expired is expired.
 *  7. **`sub` is an owner this deployment lets in.** The Supabase project is
 *     shared with Huskis and mdeditz, and the API holds a key that bypasses row
 *     level security — so "any user of the project" would be a much wider door
 *     than the browser has, where `restrict_slaids_to_owner` pins the tables to
 *     one uuid. The allowlist is the same pin, written where the server can
 *     read it.
 *
 * Every one of those failures answers the same 401 with the same sentence. The
 * difference between them lives in the owner's log, exactly as it does for an
 * agent token.
 *
 * ## Scopes
 *
 * Supabase's OAuth server does not support custom scopes yet — its metadata
 * publishes `openid profile email phone offline_access` and nothing else — so a
 * token cannot today *say* `presentations:write`. Two rules follow, and both are
 * written so that the day it can, nothing here needs changing:
 *
 *  - a verified token that names Slaids scopes is authoritative: the principal
 *    gets exactly the intersection, never more;
 *  - a verified token that names none gets the deployment's configured default,
 *    which is the three editing scopes. `sharing:write` is deliberately not in
 *    it — publishing a deck to the internet is a separate authority in Slaids
 *    ("vanlig redigering gir aldri rett til å publisere"), and a default that
 *    included it would be this file quietly deciding otherwise.
 */

import { AGENT_SCOPES, isAgentScope, type AgentScope } from '../../agent/types'
import type { AgentPrincipal, AuthOutcome } from './tokens'

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/**
 * The users this deployment lets in over OAuth, and the switch that turns the
 * whole family on.
 *
 * Required rather than defaulted, and the reason is in the migration that
 * created the tables: the Supabase project is shared, the agent API holds a
 * secret key that bypasses row level security, and the browser is pinned to a
 * single owner uuid. Defaulting to "every user of the project" would open a
 * door the browser does not have — quietly, on merge, without anyone choosing
 * it. Unset means OAuth is simply not offered: no metadata document, no
 * challenge pointing at an authorization server, and the endpoint behaves
 * exactly as it did before.
 */
export const OAUTH_OWNERS_VAR = 'SLAIDS_AGENT_OAUTH_OWNERS'

/** Optional: the OAuth clients allowed to act, by `client_id`. Unset means any. */
export const OAUTH_CLIENTS_VAR = 'SLAIDS_AGENT_OAUTH_CLIENTS'

/** Optional: what an OAuth token that names no Slaids scopes may do. */
export const OAUTH_SCOPES_VAR = 'SLAIDS_AGENT_OAUTH_SCOPES'

/** Optional: extra `aud` values to accept, beside the two below. */
export const OAUTH_AUDIENCE_VAR = 'SLAIDS_AGENT_OAUTH_AUDIENCE'

/**
 * The audience Supabase actually issues.
 *
 * Not a Slaids choice — it is what every user token from a Supabase project
 * carries, OAuth or not. MCP asks a resource server to reject tokens that were
 * not issued for it, and this string alone does not establish that, which is
 * why `client_id` (step 5 above) is checked as well and why
 * `SLAIDS_AGENT_OAUTH_AUDIENCE` exists: a deployment that makes its tokens
 * carry the canonical MCP URL — a Custom Access Token Hook can — gets the real
 * RFC 8707 binding by naming it there, with no code change here.
 */
export const SUPABASE_DEFAULT_AUDIENCE = 'authenticated'

/**
 * The `role` an ordinary user's token carries.
 *
 * The same word as the audience above, and a different fact — which is why it
 * is a second constant rather than the same one used twice. A `service_role`
 * token has the project's full authority and never went through a consent
 * screen; an `anon` one is nobody. Neither is a user acting on their own decks.
 */
export const SUPABASE_USER_ROLE = 'authenticated'

/**
 * What an OAuth principal may do when its token names no Slaids scopes.
 *
 * The three editing scopes, and not `sharing:write`. See the note at the top.
 */
export const DEFAULT_OAUTH_SCOPES: readonly AgentScope[] = [
  'presentations:read',
  'presentations:write',
  'assets:write',
]

export interface OAuthResourceConfig {
  /** The authorization server, as it appears in `iss`. No trailing slash. */
  issuer: string
  /** Where its public keys are. Supabase publishes them under the issuer. */
  jwksUri: string
  /** `aud` values this resource accepts. */
  audiences: readonly string[]
  /** Supabase user ids allowed to reach Slaids over OAuth. Never empty. */
  owners: ReadonlySet<string>
  /** `client_id`s allowed to act, or `null` for any client of the project. */
  clients: ReadonlySet<string> | null
  /** What a token that names no Slaids scopes is granted. */
  defaultScopes: readonly AgentScope[]
}

/**
 * The environment, structurally.
 *
 * Not `config.ts`'s exported `Env`: this file is imported *by* `config.ts`, and
 * a type imported the other way would be a cycle for the sake of a spelling.
 */
type OAuthEnv = Record<string, string | undefined>

/** A comma-, space- or newline-separated list, trimmed and de-duplicated. */
function list(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(/[\s,]+/).filter((entry) => entry.length > 0))]
}

/**
 * Supabase's OAuth 2.1 issuer for a project.
 *
 * Derived from the URL the API is already configured with rather than given its
 * own variable: the authorization server and the database are the same project,
 * and two variables that must agree are a way for them to disagree.
 */
export function supabaseIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`
}

/**
 * The OAuth half of this deployment, or `null` when it is not configured.
 *
 * Everything is derived from the Supabase URL the API already has, except the
 * three deliberate choices: who may come in, which clients may act for them,
 * and what a token that names no Slaids scopes is worth.
 */
export function readOAuthConfig(
  env: OAuthEnv,
  input: { supabaseUrl: string },
): OAuthResourceConfig | null {
  const owners = list(env[OAUTH_OWNERS_VAR])
  if (owners.length === 0) return null

  const issuer = supabaseIssuer(input.supabaseUrl)
  const clients = list(env[OAUTH_CLIENTS_VAR])
  const scopes = list(env[OAUTH_SCOPES_VAR]).filter(isAgentScope)

  return {
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    // Supabase's own audience, plus anything this deployment has arranged to be
    // issued instead — which is how a Custom Access Token Hook that sets `aud`
    // to the canonical MCP URL, the real RFC 8707 binding, is honoured without
    // a code change.
    audiences: [...new Set([SUPABASE_DEFAULT_AUDIENCE, ...list(env[OAUTH_AUDIENCE_VAR])])],
    owners: new Set(owners),
    clients: clients.length > 0 ? new Set(clients) : null,
    defaultScopes: scopes.length > 0 ? scopes : DEFAULT_OAUTH_SCOPES,
  }
}

/* ------------------------------------------------------------------ *
 * Reading a JWT, without believing any of it
 * ------------------------------------------------------------------ */

/**
 * Whether a presented credential is even shaped like a JWT.
 *
 * Three base64url segments. Checked before anything reaches this file's work,
 * for the same reason `looksLikeAgentToken` is: a string that cannot be one of
 * ours should never become a network call or a signature verification.
 */
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export function looksLikeJwt(value: string): boolean {
  return JWT_PATTERN.test(value)
}

function decodeBase64Url(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The algorithms this file verifies, and the WebCrypto parameters for each.
 *
 * A closed table rather than a lookup on the header, because the header is the
 * attacker's field: an algorithm that is not a key of this object is refused
 * before a key is ever fetched. Every entry is asymmetric — see step 1 at the
 * top for why `HS256` is not, and must never become, one of them.
 */
const ALGORITHMS = {
  RS256: { importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyParams: { name: 'RSASSA-PKCS1-v1_5' } },
  RS384: { importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, verifyParams: { name: 'RSASSA-PKCS1-v1_5' } },
  RS512: { importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, verifyParams: { name: 'RSASSA-PKCS1-v1_5' } },
  PS256: { importParams: { name: 'RSA-PSS', hash: 'SHA-256' }, verifyParams: { name: 'RSA-PSS', saltLength: 32 } },
  PS384: { importParams: { name: 'RSA-PSS', hash: 'SHA-384' }, verifyParams: { name: 'RSA-PSS', saltLength: 48 } },
  PS512: { importParams: { name: 'RSA-PSS', hash: 'SHA-512' }, verifyParams: { name: 'RSA-PSS', saltLength: 64 } },
  ES256: { importParams: { name: 'ECDSA', namedCurve: 'P-256' }, verifyParams: { name: 'ECDSA', hash: 'SHA-256' } },
  ES384: { importParams: { name: 'ECDSA', namedCurve: 'P-384' }, verifyParams: { name: 'ECDSA', hash: 'SHA-384' } },
  ES512: { importParams: { name: 'ECDSA', namedCurve: 'P-521' }, verifyParams: { name: 'ECDSA', hash: 'SHA-512' } },
  EdDSA: { importParams: { name: 'Ed25519' }, verifyParams: { name: 'Ed25519' } },
} as const satisfies Record<string, { importParams: object; verifyParams: object }>

type SupportedAlgorithm = keyof typeof ALGORITHMS

function isSupportedAlgorithm(value: unknown): value is SupportedAlgorithm {
  return typeof value === 'string' && Object.hasOwn(ALGORITHMS, value)
}

/** A JSON Web Key, as it comes out of the key set. Only `kid`/`alg` are read here. */
interface JsonWebKey_ extends Record<string, unknown> {
  kid?: unknown
  alg?: unknown
}

/* ------------------------------------------------------------------ *
 * The key set
 * ------------------------------------------------------------------ */

/**
 * The authorization server's public keys, kept warm.
 *
 * Two things make this more than a cache. A **`kid` that is not in the cached
 * set** triggers exactly one refetch, because that is what a key rotation looks
 * like from a resource server: new tokens arrive signed by a key published a
 * moment ago. And the refetch is **rate limited**, so a stream of tokens with
 * invented `kid`s cannot turn this endpoint into a load generator pointed at
 * Supabase.
 *
 * A fetch that fails is not a refusal of the caller — the log says so — but the
 * answer outward is the same 401 either way. There is nothing to fall back to:
 * verifying with a key we could not fetch is not verifying.
 */
export interface JwksCacheOptions {
  fetch?: typeof globalThis.fetch
  now?: () => number
  /** How long a successfully fetched key set is reused. */
  ttlMs?: number
  /** The shortest gap between two fetches, however many unknown `kid`s arrive. */
  minRefetchMs?: number
}

const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_MIN_REFETCH_MS = 30 * 1000

export class JwksCache {
  private keys: JsonWebKey_[] | null = null
  private fetchedAt = 0
  private inFlight: Promise<JsonWebKey_[]> | null = null

  private readonly fetchImpl: typeof globalThis.fetch
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly minRefetchMs: number

  constructor(
    private readonly jwksUri: string,
    options: JwksCacheOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? (() => Date.now())
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.minRefetchMs = options.minRefetchMs ?? DEFAULT_MIN_REFETCH_MS
  }

  /** The key with this `kid`, refetching once if the cached set does not have it. */
  async keyFor(kid: string | null): Promise<JsonWebKey_ | null> {
    if (!this.fresh()) await this.refresh()
    const found = select(this.keys, kid)
    if (found) return found
    // Unknown `kid`: the set may simply be older than the key. One refetch,
    // and only if we are not already hammering.
    if (this.now() - this.fetchedAt < this.minRefetchMs) return null
    await this.refresh()
    return select(this.keys, kid)
  }

  /**
   * Fetch the key set, keeping what we already have if the fetch fails.
   *
   * The keys are *public*, and a set that is a few minutes stale is the set
   * every JWKS client in the world is working from between refreshes. Throwing
   * a stale-but-good set away because the authorization server was briefly
   * unreachable would turn a blip there into every Slaids agent call failing
   * here — for tokens this instance can verify perfectly well.
   *
   * A *first* fetch that fails is different: there is nothing to fall back to,
   * and verifying against a key we never had is not verifying. That one throws.
   */
  private async refresh(): Promise<void> {
    try {
      await this.load()
    } catch (error) {
      if (!this.keys) throw error
      console.warn('slaids-agent: kunne ikke oppdatere JWKS, bruker det forrige settet', error)
    }
  }

  private fresh(): boolean {
    return this.keys !== null && this.now() - this.fetchedAt < this.ttlMs
  }

  private load(): Promise<JsonWebKey_[]> {
    // One fetch per instant, however many requests arrive together: a cold
    // instance answering a burst should ask Supabase once.
    this.inFlight ??= this.fetchKeys().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async fetchKeys(): Promise<JsonWebKey_[]> {
    const response = await this.fetchImpl(this.jwksUri, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`JWKS svarte ${response.status}`)
    const body: unknown = await response.json()
    const keys = (body as { keys?: unknown })?.keys
    if (!Array.isArray(keys)) throw new Error('JWKS-svaret hadde ingen «keys»-liste.')
    this.keys = keys.filter(
      (key): key is JsonWebKey_ => typeof key === 'object' && key !== null && !Array.isArray(key),
    )
    this.fetchedAt = this.now()
    return this.keys
  }
}

/**
 * The key a signature should be checked against.
 *
 * A `kid` names one. Without one, a key set with exactly one key is
 * unambiguous — and a set with several is not, so nothing is guessed.
 */
function select(keys: JsonWebKey_[] | null, kid: string | null): JsonWebKey_ | null {
  if (!keys || keys.length === 0) return null
  if (kid !== null) return keys.find((key) => key.kid === kid) ?? null
  return keys.length === 1 ? keys[0] : null
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

/** What a verified token turned out to say. Only ever read after the signature. */
export interface OAuthClaims {
  issuer: string
  subject: string
  clientId: string
  audiences: readonly string[]
  expiresAt: number
  scopes: readonly string[]
  role: string | null
}

function stringField(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** `aud` is a string or an array of them; both are the same question. */
function audiences(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  return []
}

/**
 * The scopes a token names, in whichever of the two shapes it names them.
 *
 * `scope` as a space-separated string is what OAuth defines and what Supabase
 * returns beside the token; `scopes` as an array is what a Custom Access Token
 * Hook is most likely to add. Reading both costs one line and removes a reason
 * for this to need touching later.
 */
function scopesIn(claims: Record<string, unknown>): string[] {
  const scope = claims.scope
  if (typeof scope === 'string') return scope.split(/\s+/).filter((entry) => entry.length > 0)
  const scopes = claims.scopes
  if (Array.isArray(scopes)) return scopes.filter((entry): entry is string => typeof entry === 'string')
  return []
}

/**
 * Verify one presented JWT and say who it is, or why it is nobody.
 *
 * Never throws: a key set that could not be fetched, a signature that does not
 * verify and a claim that is wrong are all outcomes, because the caller has to
 * answer all three with the same 401 and record which one it was.
 */
export async function authenticateOAuthToken(input: {
  token: string
  config: OAuthResourceConfig
  jwks: JwksCache
  now: Date
}): Promise<AuthOutcome> {
  const { token, config, jwks, now } = input

  // Three segments, said before anything indexes into them. The caller already
  // asked `looksLikeJwt`, but this function is exported and a shape check that
  // only exists at one call site is a shape check waiting to be skipped.
  const segments = token.split('.')
  if (segments.length !== 3) return { ok: false, reason: 'oauth-malformed' }
  const [headerSegment, payloadSegment, signatureSegment] = segments

  const header = decodeJson(headerSegment)
  if (!header) return { ok: false, reason: 'oauth-malformed' }

  // Step 1. The algorithm, from a closed table. `none` and every `HS*` fall out
  // here, before a key is fetched — the algorithm-confusion forgery never gets
  // as far as needing a key to confuse.
  const algorithm = header.alg
  if (!isSupportedAlgorithm(algorithm)) return { ok: false, reason: 'oauth-malformed' }
  const { importParams, verifyParams } = ALGORITHMS[algorithm]

  const kid = typeof header.kid === 'string' ? header.kid : null

  let key: JsonWebKey_ | null
  try {
    key = await jwks.keyFor(kid)
  } catch (error) {
    console.error('slaids-agent: kunne ikke hente JWKS fra autorisasjonsserveren', error)
    return { ok: false, reason: 'oauth-unavailable' }
  }
  if (!key) return { ok: false, reason: 'oauth-unknown-key' }
  // A key that names its own algorithm may only be used for that one.
  if (typeof key.alg === 'string' && key.alg !== algorithm) {
    return { ok: false, reason: 'oauth-malformed' }
  }

  // Step 2. The signature, over the exact bytes that were sent — the two
  // segments as they arrived, never a re-serialisation of what we parsed.
  let verified: boolean
  try {
    const cryptoKey = await crypto.subtle.importKey('jwk', key as JsonWebKey, importParams, false, [
      'verify',
    ])
    verified = await crypto.subtle.verify(
      verifyParams,
      cryptoKey,
      decodeBase64Url(signatureSegment) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`) as unknown as ArrayBuffer,
    )
  } catch (error) {
    // A key WebCrypto refuses to import, or a signature that is not the right
    // length for the algorithm. Neither is a verified token.
    console.warn('slaids-agent: kunne ikke verifisere OAuth-tokenets signatur', error)
    return { ok: false, reason: 'oauth-invalid' }
  }
  if (!verified) return { ok: false, reason: 'oauth-invalid' }

  // Everything from here reads the *verified* payload, and nothing before this
  // line was allowed to.
  const payload = decodeJson(payloadSegment)
  if (!payload) return { ok: false, reason: 'oauth-malformed' }

  const issuer = stringField(payload, 'iss')
  const subject = stringField(payload, 'sub')
  const clientId = stringField(payload, 'client_id')
  const audience = audiences(payload.aud)
  const expiry = typeof payload.exp === 'number' ? payload.exp : null

  // Step 3. The issuer, exactly.
  if (issuer === null || issuer.replace(/\/+$/, '') !== config.issuer) {
    return { ok: false, reason: 'oauth-issuer' }
  }
  // Step 4. An audience this resource accepts.
  if (!audience.some((entry) => config.audiences.includes(entry))) {
    return { ok: false, reason: 'oauth-audience' }
  }
  // Step 5. Minted through the authorization-code flow, not lifted from a tab.
  if (clientId === null) return { ok: false, reason: 'oauth-not-delegated' }
  if (config.clients && !config.clients.has(clientId)) {
    return { ok: false, reason: 'oauth-client' }
  }
  if (subject === null) return { ok: false, reason: 'oauth-malformed' }

  const role = stringField(payload, 'role')
  // A service-role or anon JWT is not a user acting on their own decks, and
  // this endpoint has no business honouring one.
  if (role !== null && role !== SUPABASE_USER_ROLE) {
    return { ok: false, reason: 'oauth-not-delegated' }
  }

  // Step 7. Who this is allowed to be. Checked before expiry so that an expired
  // token belonging to an owner can still be *attributed* in the audit below,
  // and one belonging to a stranger never is.
  if (!config.owners.has(subject)) return { ok: false, reason: 'oauth-unknown-owner' }

  // Step 6. Expiry, with no leeway.
  if (expiry === null || expiry * 1000 <= now.getTime()) {
    return {
      ok: false,
      reason: 'oauth-expired',
      identified: { kind: 'oauth', ownerId: subject, clientId },
    }
  }

  const scopes = grantedScopes(scopesIn(payload), config.defaultScopes)
  if (scopes.length === 0) {
    return {
      ok: false,
      reason: 'no-scopes',
      identified: { kind: 'oauth', ownerId: subject, clientId },
    }
  }

  const principal: AgentPrincipal = {
    kind: 'oauth',
    ownerId: subject,
    clientId,
    scopes,
  }
  return { ok: true, principal }
}

/**
 * What this token may do.
 *
 * The intersection when the token names Slaids scopes, and the deployment's
 * default when it names none. Never a union of the two: a token that says
 * `presentations:read` gets read access and nothing else, whatever the default
 * is, which is what makes the day Supabase supports custom scopes a
 * configuration change rather than a code change.
 */
export function grantedScopes(
  named: readonly string[],
  fallback: readonly AgentScope[],
): AgentScope[] {
  const claimed = named.filter(isAgentScope)
  if (claimed.length > 0) return AGENT_SCOPES.filter((scope) => claimed.includes(scope))
  return AGENT_SCOPES.filter((scope) => fallback.includes(scope))
}
