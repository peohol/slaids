// @vitest-environment node
/**
 * What "verify an OAuth access token" actually means, checked against real
 * signatures.
 *
 * Every token in this file is signed by an ES256 key pair generated for the
 * test, and every refusal below is a token that genuinely does not verify — not
 * a double told to answer no. That distinction is the reason the file exists:
 * the failures this code has to prevent are forgeries, and a forgery is only a
 * forgery against real cryptography. The three that matter most, and that a
 * stubbed verifier would have waved straight through:
 *
 *  - **algorithm confusion**, where the attacker takes the *public* key
 *    everybody can fetch and uses it as an HMAC secret. It works against any
 *    verifier that trusts the header's `alg`, and it is why `ALGORITHMS` is a
 *    closed table of asymmetric algorithms rather than a lookup.
 *  - **a payload edited after signing**, which is what "decode and believe"
 *    amounts to.
 *  - **a token signed by somebody else's key**, which is what a second Supabase
 *    project is.
 *
 * The claim checks are held to the same standard: each one is a token that is
 * perfectly valid apart from the single claim under test.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OAUTH_SCOPES,
  JwksCache,
  OAUTH_AUDIENCE_VAR,
  OAUTH_CLIENTS_VAR,
  OAUTH_OWNERS_VAR,
  OAUTH_SCOPES_VAR,
  authenticateOAuthToken,
  grantedScopes,
  looksLikeJwt,
  readOAuthConfig,
  supabaseIssuer,
} from './oauth'
import type { AuthOutcome } from './tokens'
import {
  OTHER_OWNER,
  TEST_CLIENT,
  TEST_ISSUER,
  TEST_OWNER,
  TEST_SUPABASE_URL,
  testAuthorizationServer,
  type TestAuthorizationServer,
  type TokenClaims,
} from './testOAuth'

const NOW = new Date('2026-09-05T12:00:00.000Z')

/** One verification, with everything but the token left at its sane default. */
async function verify(
  server: TestAuthorizationServer,
  token: string,
  overrides: Parameters<TestAuthorizationServer['config']>[0] = {},
  now: Date = NOW,
): Promise<AuthOutcome> {
  return authenticateOAuthToken({
    token,
    config: server.config(overrides),
    jwks: server.jwks(),
    now,
  })
}

/** A token that should be accepted, unless the named claim says otherwise. */
function claims(overrides: TokenClaims = {}): TokenClaims {
  const seconds = Math.floor(NOW.getTime() / 1000)
  return { iat: seconds - 60, exp: seconds + 3600, ...overrides }
}

function reasonOf(outcome: AuthOutcome): string {
  if (outcome.ok) throw new Error('Forventet en avvisning, fikk et prinsipal.')
  return outcome.reason
}

/* ------------------------------------------------------------------ *
 * The happy path
 * ------------------------------------------------------------------ */

describe('et gyldig token', () => {
  it('blir den Supabase-brukeren som autentiserte seg', async () => {
    const server = await testAuthorizationServer()
    const outcome = await verify(server, await server.sign(claims()))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.principal.kind).toBe('oauth')
    // `sub` is the Supabase user id, and it is what the repository is pinned to.
    expect(outcome.principal.ownerId).toBe(TEST_OWNER)
    if (outcome.principal.kind !== 'oauth') return
    expect(outcome.principal.clientId).toBe(TEST_CLIENT)
  })

  it('koster ingenting etter det første nøkkeloppslaget', async () => {
    // One fetch per warm instance, not one per call: verification is local.
    const server = await testAuthorizationServer()
    const jwks = server.jwks()
    const config = server.config()
    for (let index = 0; index < 5; index += 1) {
      const outcome = await authenticateOAuthToken({
        token: await server.sign(claims()),
        config,
        jwks,
        now: NOW,
      })
      expect(outcome.ok).toBe(true)
    }
    expect(server.fetches).toBe(1)
  })

  it('overlever at autorisasjonsserveren roterer nøkkelen sin', async () => {
    // The one thing a resource server has to survive without a restart: a token
    // arrives signed by a key published after the set was cached.
    const server = await testAuthorizationServer()
    const jwks = server.jwks({ minRefetchMs: 0 })
    const config = server.config()

    expect(
      (await authenticateOAuthToken({ token: await server.sign(claims()), config, jwks, now: NOW }))
        .ok,
    ).toBe(true)

    await server.rotate()
    const outcome = await authenticateOAuthToken({
      token: await server.sign(claims()),
      config,
      jwks,
      now: NOW,
    })
    expect(outcome.ok).toBe(true)
    expect(server.fetches).toBe(2)
  })

  it('henter ikke nøkler på nytt for hver oppdiktet kid', async () => {
    // Otherwise a stream of invented `kid`s turns this endpoint into a load
    // generator pointed at the authorization server.
    const server = await testAuthorizationServer()
    const jwks = server.jwks({ minRefetchMs: 60_000, now: () => NOW.getTime() })
    const config = server.config()

    for (let index = 0; index < 10; index += 1) {
      const token = await server.signWith({ alg: 'ES256', typ: 'JWT', kid: `oppdiktet-${index}` })
      expect(reasonOf(await authenticateOAuthToken({ token, config, jwks, now: NOW }))).toBe(
        'oauth-unknown-key',
      )
    }
    expect(server.fetches).toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * Forgeries
 * ------------------------------------------------------------------ */

describe('forfalskninger', () => {
  it('avviser et token signert med den offentlige nøkkelen som HMAC-hemmelighet', async () => {
    // Algorithm confusion, and the whole reason `ALGORITHMS` is a closed table
    // of asymmetric algorithms. The attacker needs no secret at all: the key is
    // published, and a verifier that trusts `alg` will happily check an HMAC
    // against it.
    const server = await testAuthorizationServer()
    const publicKey = server.publicKeys()[0]
    const secret = new TextEncoder().encode(JSON.stringify(publicKey))
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      secret as unknown as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )

    const encode = (value: unknown): string =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const signing = `${encode({ alg: 'HS256', typ: 'JWT', kid: publicKey.kid })}.${encode(
      { iss: TEST_ISSUER, sub: TEST_OWNER, aud: 'authenticated', client_id: TEST_CLIENT, exp: 9e9 },
    )}`
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        hmacKey,
        new TextEncoder().encode(signing) as unknown as ArrayBuffer,
      ),
    )
    let binary = ''
    for (const byte of signature) binary += String.fromCharCode(byte)
    const forged = `${signing}.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`

    expect(reasonOf(await verify(server, forged))).toBe('oauth-malformed')
  })

  it('avviser «alg: none»', async () => {
    const server = await testAuthorizationServer()
    const encode = (value: unknown): string =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      iss: TEST_ISSUER,
      sub: TEST_OWNER,
      aud: 'authenticated',
      client_id: TEST_CLIENT,
      exp: 9e9,
    })}.signatur`

    expect(reasonOf(await verify(server, unsigned))).toBe('oauth-malformed')
  })

  it('avviser et token der kroppen er endret etter signeringen', async () => {
    const server = await testAuthorizationServer()
    const token = await server.sign(claims({ sub: OTHER_OWNER }))
    const [header, , signature] = token.split('.')
    // The same signature, over a payload that now names the allowed owner.
    const rewritten = btoa(
      JSON.stringify({
        iss: TEST_ISSUER,
        sub: TEST_OWNER,
        aud: 'authenticated',
        client_id: TEST_CLIENT,
        exp: 9e9,
      }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    expect(reasonOf(await verify(server, `${header}.${rewritten}.${signature}`))).toBe(
      'oauth-invalid',
    )
  })

  it('avviser et token signert av et annet Supabase-prosjekt', async () => {
    // Two servers, two key pairs, and the second one's `kid` is not in the
    // first one's set at all.
    const ours = await testAuthorizationServer()
    const theirs = await testAuthorizationServer()
    await theirs.rotate()

    const outcome = await verify(ours, await theirs.sign(claims()))
    expect(['oauth-unknown-key', 'oauth-invalid']).toContain(reasonOf(outcome))
  })

  it('avviser en streng som ikke er et token i det hele tatt', async () => {
    const server = await testAuthorizationServer()
    expect(looksLikeJwt('slaids_at_noe')).toBe(false)
    expect(reasonOf(await verify(server, 'a.b.c'))).toBe('oauth-malformed')
  })
})

/* ------------------------------------------------------------------ *
 * Claims
 * ------------------------------------------------------------------ */

describe('påstandene i et ellers gyldig token', () => {
  it('avviser en annen utsteder', async () => {
    const server = await testAuthorizationServer()
    const token = await server.sign(claims({ iss: 'https://annet.supabase.co/auth/v1' }))
    expect(reasonOf(await verify(server, token))).toBe('oauth-issuer')
  })

  it('avviser en annen mottaker', async () => {
    const server = await testAuthorizationServer()
    expect(reasonOf(await verify(server, await server.sign(claims({ aud: 'noen-andre' }))))).toBe(
      'oauth-audience',
    )
  })

  it('godtar en mottakerliste som inneholder en av våre', async () => {
    const server = await testAuthorizationServer()
    const token = await server.sign(claims({ aud: ['noen-andre', 'authenticated'] }))
    expect((await verify(server, token)).ok).toBe(true)
  })

  it('avviser et vanlig innloggingstoken fra nettleseren', async () => {
    // The replay this protects against: a Supabase session token has the same
    // issuer, the same audience and the same signature chain as an OAuth one.
    // The only thing it does not have is a `client_id`, because it never went
    // through an authorization-code flow — so that claim is the line between
    // "the owner delegated this" and "somebody copied a token out of a tab".
    const server = await testAuthorizationServer()
    expect(reasonOf(await verify(server, await server.sign(claims({ client_id: null }))))).toBe(
      'oauth-not-delegated',
    )
  })

  it('avviser et service_role-token', async () => {
    const server = await testAuthorizationServer()
    const token = await server.sign(claims({ role: 'service_role' }))
    expect(reasonOf(await verify(server, token))).toBe('oauth-not-delegated')
  })

  it('avviser en klient som ikke står på listen, når listen finnes', async () => {
    const server = await testAuthorizationServer()
    const token = await server.sign(claims())
    expect((await verify(server, token, { clients: new Set([TEST_CLIENT]) })).ok).toBe(true)
    expect(reasonOf(await verify(server, token, { clients: new Set(['en-annen']) }))).toBe(
      'oauth-client',
    )
  })

  it('avviser en ekte bruker av prosjektet som ikke er en Slaids-eier', async () => {
    // The Supabase project is shared with two other apps, and the API holds a
    // key that bypasses row level security. Without this the door would be
    // wider than the browser's, where the tables are pinned to one uuid.
    const server = await testAuthorizationServer()
    const token = await server.sign(claims({ sub: OTHER_OWNER }))
    const outcome = await verify(server, token)
    expect(reasonOf(outcome)).toBe('oauth-unknown-owner')
    // And nothing is attributed: there is no owner here to write a row for.
    expect(outcome.ok === false && outcome.identified).toBeUndefined()
  })

  it('avviser et utløpt token, og lar eieren se det i loggen', async () => {
    const server = await testAuthorizationServer()
    const seconds = Math.floor(NOW.getTime() / 1000)
    const token = await server.sign({ iat: seconds - 7200, exp: seconds - 1 })

    const outcome = await verify(server, token)
    expect(reasonOf(outcome)).toBe('oauth-expired')
    // Signature and owner checked out; only the clock said no. That is a row
    // worth writing — "the connector is still trying" — and the owner is known.
    expect(outcome.ok === false && outcome.identified).toEqual({
      kind: 'oauth',
      ownerId: TEST_OWNER,
      clientId: TEST_CLIENT,
    })
  })

  it('gir ingen slingringsmonn på utløp', async () => {
    const server = await testAuthorizationServer()
    const seconds = Math.floor(NOW.getTime() / 1000)
    expect(reasonOf(await verify(server, await server.sign({ exp: seconds })))).toBe('oauth-expired')
    expect((await verify(server, await server.sign({ exp: seconds + 1 }))).ok).toBe(true)
  })

  it('avviser et token uten utløp', async () => {
    const server = await testAuthorizationServer()
    expect(reasonOf(await verify(server, await server.sign({ exp: undefined })))).toBe(
      'oauth-expired',
    )
  })
})

/* ------------------------------------------------------------------ *
 * The key set
 * ------------------------------------------------------------------ */

describe('nøkkelsettet', () => {
  it('avviser når det ikke kan hentes — det finnes ikke noe å falle tilbake på', async () => {
    // A key set that cannot be fetched is not the caller's fault, and the answer
    // outward is still the same 401. What it is not is a reason to skip the
    // check: verifying against a key we could not fetch is not verifying.
    const server = await testAuthorizationServer()
    const down = new JwksCache(server.jwksUri, {
      fetch: () => Promise.reject(new Error('nede')),
    })

    const outcome = await authenticateOAuthToken({
      token: await server.sign(claims()),
      config: server.config(),
      jwks: down,
      now: NOW,
    })
    expect(reasonOf(outcome)).toBe('oauth-unavailable')
  })

  it('beholder et sett som virker når serveren blir midlertidig utilgjengelig', async () => {
    // A blip at the authorization server must not become every agent call
    // failing here: the keys are public, the cached set still verifies, and
    // throwing it away buys nothing.
    const server = await testAuthorizationServer()
    let clock = NOW.getTime()
    let reachable = true
    const jwks = new JwksCache(server.jwksUri, {
      now: () => clock,
      ttlMs: 1_000,
      fetch: (...args) =>
        reachable
          ? server.fetch(...(args as Parameters<typeof server.fetch>))
          : Promise.reject(new Error('nede')),
    })

    const first = await authenticateOAuthToken({
      token: await server.sign(claims()),
      config: server.config(),
      jwks,
      now: NOW,
    })
    expect(first.ok).toBe(true)

    // The cache goes stale, and the refresh fails.
    clock += 10_000
    reachable = false
    const later = await authenticateOAuthToken({
      token: await server.sign(claims()),
      config: server.config(),
      jwks,
      now: NOW,
    })
    expect(later.ok).toBe(true)
  })

  it('avviser like fullt når nøkkelsettet svarer med noe annet enn nøkler', async () => {
    const server = await testAuthorizationServer()
    const nonsense = new JwksCache(server.jwksUri, {
      fetch: () => Promise.resolve(new Response('{"noe":"annet"}', { status: 200 })),
    })

    const outcome = await authenticateOAuthToken({
      token: await server.sign(claims()),
      config: server.config(),
      jwks: nonsense,
      now: NOW,
    })
    expect(reasonOf(outcome)).toBe('oauth-unavailable')
  })
})

/* ------------------------------------------------------------------ *
 * Scopes
 * ------------------------------------------------------------------ */

describe('scopes', () => {
  it('bruker det tokenet selv navngir, og ikke noe mer', async () => {
    const server = await testAuthorizationServer()
    const token = await server.sign(claims({ scope: 'openid email presentations:read' }))
    const outcome = await verify(server, token)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // The OIDC scopes are not Slaids scopes and are not treated as authority;
    // the one Slaids scope named is the whole grant, narrower than the default.
    expect(outcome.principal.scopes).toEqual(['presentations:read'])
  })

  it('faller tilbake til installasjonens standard når tokenet navngir ingen', async () => {
    // Which is today's reality: Supabase's OAuth server has no custom scopes, so
    // a token says `openid email` and nothing about Slaids.
    const server = await testAuthorizationServer()
    const outcome = await verify(server, await server.sign(claims({ scope: 'openid email' })))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.principal.scopes).toEqual([...DEFAULT_OAUTH_SCOPES])
  })

  it('gir aldri rett til å publisere som standard', async () => {
    // `CLAUDE.md`: ordinary editing never carries the right to hand a
    // presentation to the internet. A default that included `sharing:write`
    // would be this layer quietly deciding otherwise.
    expect(DEFAULT_OAUTH_SCOPES).not.toContain('sharing:write')
  })

  it('lar installasjonen utvide standarden, men ikke tokenet', async () => {
    const server = await testAuthorizationServer()
    const wide = { defaultScopes: ['presentations:read', 'sharing:write'] as const }
    const outcome = await verify(server, await server.sign(claims()), {
      defaultScopes: [...wide.defaultScopes],
    })
    expect(outcome.ok && outcome.principal.scopes).toEqual(['presentations:read', 'sharing:write'])

    // A token that names its own scopes is authoritative even so.
    const narrow = await verify(server, await server.sign(claims({ scope: 'presentations:read' })), {
      defaultScopes: [...wide.defaultScopes],
    })
    expect(narrow.ok && narrow.principal.scopes).toEqual(['presentations:read'])
  })

  it('behandler aldri et ukjent scope-navn som autoritet', async () => {
    // An unknown name grants nothing of its own, and does not widen what is
    // beside it. A token whose scopes are *all* unknown to Slaids — which is
    // every token Supabase issues today, since `openid email` says nothing
    // about presentations — is a token that named none of ours, and falls back
    // to the deployment's default rather than to everything.
    expect(grantedScopes(['files:write', 'presentations:read'], DEFAULT_OAUTH_SCOPES)).toEqual([
      'presentations:read',
    ])
    expect(grantedScopes(['files:write'], DEFAULT_OAUTH_SCOPES)).toEqual([...DEFAULT_OAUTH_SCOPES])
    expect(grantedScopes([], [])).toEqual([])
  })

  it('leser både «scope» som streng og «scopes» som liste', async () => {
    const server = await testAuthorizationServer()
    const asList = await verify(server, await server.sign(claims({ scopes: ['assets:write'] })))
    expect(asList.ok && asList.principal.scopes).toEqual(['assets:write'])
  })
})

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

describe('oppsettet', () => {
  it('tilbyr ingen OAuth uten en eierliste', async () => {
    // Merging this must not open a door nobody chose to open.
    expect(readOAuthConfig({}, { supabaseUrl: TEST_SUPABASE_URL })).toBeNull()
    expect(
      readOAuthConfig({ [OAUTH_OWNERS_VAR]: '   ' }, { supabaseUrl: TEST_SUPABASE_URL }),
    ).toBeNull()
  })

  it('utleder utsteder og nøkkelsett av Supabase-URL-en som allerede er satt', async () => {
    const config = readOAuthConfig(
      { [OAUTH_OWNERS_VAR]: TEST_OWNER },
      { supabaseUrl: `${TEST_SUPABASE_URL}/` },
    )
    expect(config?.issuer).toBe(supabaseIssuer(TEST_SUPABASE_URL))
    expect(config?.jwksUri).toBe(`${TEST_ISSUER}/.well-known/jwks.json`)
    // Two variables that must agree are a way for them to disagree.
    expect(config?.issuer).toBe(TEST_ISSUER)
  })

  it('leser lister med komma, mellomrom eller linjeskift', async () => {
    const config = readOAuthConfig(
      {
        [OAUTH_OWNERS_VAR]: `${TEST_OWNER}, ${OTHER_OWNER}\n${TEST_OWNER}`,
        [OAUTH_CLIENTS_VAR]: `${TEST_CLIENT}`,
        [OAUTH_SCOPES_VAR]: 'presentations:read tull sharing:write',
        [OAUTH_AUDIENCE_VAR]: 'https://www.slaids.no/api/agent/v1/mcp',
      },
      { supabaseUrl: TEST_SUPABASE_URL },
    )
    expect([...(config?.owners ?? [])].sort()).toEqual([TEST_OWNER, OTHER_OWNER].sort())
    expect([...(config?.clients ?? [])]).toEqual([TEST_CLIENT])
    // An unknown scope name is never treated as authority.
    expect(config?.defaultScopes).toEqual(['presentations:read', 'sharing:write'])
    expect(config?.audiences).toEqual(['authenticated', 'https://www.slaids.no/api/agent/v1/mcp'])
  })
})
