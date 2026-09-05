/**
 * A real authorization server, in miniature.
 *
 * The point of this file is that it is not a stub. It holds an actual ES256 key
 * pair, publishes an actual JWKS document, and signs actual JWTs with the
 * private half — so a test that says "this token is accepted" has verified a
 * signature, and a test that says "this one is not" has produced something that
 * genuinely does not verify. A helper that answered "yes, valid" would have
 * tested nothing at all: signature verification is the entire load-bearing part
 * of `oauth.ts`, and the ways it goes wrong — an algorithm swapped, a payload
 * edited after signing, a key that belongs to somebody else — are ways that only
 * show up against real cryptography.
 *
 * ES256 because that is what the Supabase project actually signs with; its JWKS
 * publishes one `EC`/`P-256` key. `rotate()` exists because key rotation is the
 * one thing a resource server has to survive without being restarted, and the
 * only way to test that is to have a second key appear.
 *
 * It lives in `src/` rather than beside a single test for the same reason
 * `testHarness.ts` does: several test files need one, and it imports no test
 * framework, so nothing here could be pulled into the server bundle by an
 * import somebody adds later.
 */

import { JwksCache, supabaseIssuer, type OAuthResourceConfig } from './oauth'

export const TEST_SUPABASE_URL = 'https://project.supabase.co'
export const TEST_ISSUER = supabaseIssuer(TEST_SUPABASE_URL)
export const TEST_JWKS_URI = `${TEST_ISSUER}/.well-known/jwks.json`

/** The Supabase user the deployment lets in, and the client it approved. */
export const TEST_OWNER = '11111111-2222-3333-4444-555555555555'
export const TEST_CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** A second user of the same project — one Slaids does not know. */
export const OTHER_OWNER = '99999999-8888-7777-6666-555555555555'

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)))
}

/**
 * A published key, as a key set carries it.
 *
 * The DOM's own `JsonWebKey` stops at the cryptographic members; `kid`, `alg`
 * and `use` are the JWK metadata a key set is navigated by, and they are what a
 * resource server actually reads.
 */
export type PublishedJwk = JsonWebKey & { kid?: string; alg?: string; use?: string }

interface SigningKey {
  kid: string
  privateKey: CryptoKey
  jwk: PublishedJwk
}

async function newKey(kid: string): Promise<SigningKey> {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  const jwk: PublishedJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  // Exactly the shape Supabase publishes: the public half, tagged for
  // verification, with the algorithm named on the key.
  delete jwk.key_ops
  delete jwk.ext
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'ES256', use: 'sig' } }
}

/** The claims a Supabase OAuth access token carries. Overridable one at a time. */
export interface TokenClaims {
  iss?: string
  sub?: string | null
  aud?: string | string[]
  client_id?: string | null
  role?: string | null
  exp?: number
  iat?: number
  scope?: string
  scopes?: string[]
  [claim: string]: unknown
}

export interface TestAuthorizationServer {
  issuer: string
  jwksUri: string
  /** How many times the key set has been fetched. Rotation and caching read this. */
  readonly fetches: number
  /** A `fetch` that serves this server's JWKS and nothing else. */
  fetch: typeof globalThis.fetch
  /** A cache wired to that `fetch`, as the deployment would build one. */
  jwks(options?: { now?: () => number; ttlMs?: number; minRefetchMs?: number }): JwksCache
  config(overrides?: Partial<OAuthResourceConfig>): OAuthResourceConfig
  /** One signed token. Everything defaults to a token that ought to be accepted. */
  sign(claims?: TokenClaims): Promise<string>
  /** Sign with a header this server would never send — for the forgery tests. */
  signWith(header: Record<string, unknown>, claims?: TokenClaims): Promise<string>
  /** Publish a new key and sign with it from now on. The old one disappears. */
  rotate(): Promise<void>
  /** The published JWKS, as a client would read it. */
  publicKeys(): PublishedJwk[]
}

export async function testAuthorizationServer(): Promise<TestAuthorizationServer> {
  let key = await newKey('key-1')
  let fetches = 0
  let generation = 1

  const server: TestAuthorizationServer = {
    issuer: TEST_ISSUER,
    jwksUri: TEST_JWKS_URI,
    get fetches() {
      return fetches
    },
    fetch: ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== TEST_JWKS_URI) {
        return Promise.resolve(new Response('not found', { status: 404 }))
      }
      fetches += 1
      return Promise.resolve(
        new Response(JSON.stringify({ keys: server.publicKeys() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as typeof globalThis.fetch,

    jwks: (options = {}) => new JwksCache(TEST_JWKS_URI, { fetch: server.fetch, ...options }),

    config: (overrides = {}) => ({
      issuer: TEST_ISSUER,
      jwksUri: TEST_JWKS_URI,
      audiences: ['authenticated'],
      owners: new Set([TEST_OWNER]),
      clients: null,
      defaultScopes: ['presentations:read', 'presentations:write', 'assets:write'],
      ...overrides,
    }),

    sign: (claims = {}) => server.signWith({ alg: 'ES256', typ: 'JWT', kid: key.kid }, claims),

    signWith: async (header, claims = {}) => {
      const now = Math.floor(Date.now() / 1000)
      const payload: Record<string, unknown> = {
        iss: TEST_ISSUER,
        sub: TEST_OWNER,
        aud: 'authenticated',
        role: 'authenticated',
        client_id: TEST_CLIENT,
        iat: now,
        exp: now + 3600,
        session_id: 'session-1',
        ...claims,
      }
      // `null` means "leave this claim out", which is how a token without a
      // `client_id` — a plain browser session token — is written here.
      for (const [name, value] of Object.entries(payload)) {
        if (value === null) delete payload[name]
      }
      const signing = `${encodeJson(header)}.${encodeJson(payload)}`
      const signature = await crypto.subtle.sign(
        SIGN,
        key.privateKey,
        new TextEncoder().encode(signing) as unknown as ArrayBuffer,
      )
      return `${signing}.${base64url(new Uint8Array(signature))}`
    },

    rotate: async () => {
      generation += 1
      key = await newKey(`key-${generation}`)
    },

    publicKeys: () => [key.jwk],
  }

  return server
}
