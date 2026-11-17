// @vitest-environment node
/**
 * The OAuth flow, run by the two scripts that run it from outside, against a
 * real socket — and against a real authorization server, in miniature.
 *
 * `scripts/mcp-oauth-client.mjs` is the first authenticated `tools/call` a
 * deployment ever gets, and `scripts/mcp-smoke.mjs`'s OAuth half is what says
 * whether a deployment is ready for one. Neither can be tested against Supabase
 * from here, and neither should need to be: everything they depend on is an
 * HTTP contract — RFC 8414 metadata, RFC 7591 registration, the authorization
 * redirect, the token exchange — and a contract can be served from a socket in
 * this process.
 *
 * The server below is that contract, and it is not a stub that says yes. It
 * checks the client's redirect address against what it registered, verifies
 * the PKCE challenge against the verifier that comes back, refuses a `resource`
 * that changed between the two requests, and signs the token it issues with a
 * real ES256 key — the one the deployment then verifies it against. A client
 * that skipped a step would be refused here for the same reason Supabase would
 * refuse it.
 */

import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_MCP_PATH } from '../../routing'
import type { OAuthResourceConfig } from '../agent/oauth'
import { oauthAuthenticator } from '../agent/supabase'
import {
  TEST_OWNER,
  testAccessList,
  testAuthorizationServer,
  type TestAuthorizationServer,
} from '../agent/testOAuth'
import { closeHarnessDatabases, harness, type Harness } from './testHarness'
import { listenHarness, type ServedHarness } from './testServer'

const run = promisify(execFile)

/* ------------------------------------------------------------------ *
 * An authorization server, on a socket
 * ------------------------------------------------------------------ */

interface RegisteredClient {
  clientId: string
  clientName: string
  redirectUris: string[]
  tokenEndpointAuthMethod: string
  /** `null` for a public client. A confidential one has to present this. */
  clientSecret: string | null
}

interface PendingAuthorization {
  code: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string | null
  resource: string | null
  scope: string | null
}

interface FakeAuthorizationServer {
  issuer: string
  /** Everything a client did, for the assertions. */
  registrations: RegisteredClient[]
  authorizations: PendingAuthorization[]
  tokenRequests: URLSearchParams[]
  issued: string[]
  /** The two switches the Supabase dashboard has. */
  dynamicRegistration: boolean
  /** Make the next authorization come back as the owner having said no. */
  denyNext: boolean
  /** Answer every registration with this instead — a rate limit, an outage. */
  registrationOverride: { status: number; body: unknown } | null
  close(): Promise<void>
}

function readBody(incoming: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

async function fakeAuthorizationServer(keys: TestAuthorizationServer): Promise<FakeAuthorizationServer> {
  const state = {
    issuer: '',
    registrations: [] as RegisteredClient[],
    authorizations: [] as PendingAuthorization[],
    tokenRequests: [] as URLSearchParams[],
    issued: [] as string[],
    dynamicRegistration: true,
    denyNext: false,
    registrationOverride: null as { status: number; body: unknown } | null,
  }

  const send = (outgoing: ServerResponse, status: number, payload: unknown): void => {
    outgoing.writeHead(status, { 'Content-Type': 'application/json' })
    outgoing.end(JSON.stringify(payload))
  }

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1')
      const body = await readBody(incoming)

      // RFC 8414, at the path-inserted address Supabase publishes it on.
      if (incoming.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server/auth/v1') {
        send(outgoing, 200, {
          issuer: state.issuer,
          authorization_endpoint: `${state.issuer}/oauth/authorize`,
          token_endpoint: `${state.issuer}/oauth/token`,
          registration_endpoint: `${state.issuer}/oauth/clients/register`,
          jwks_uri: `${state.issuer}/.well-known/jwks.json`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
          scopes_supported: ['openid', 'email', 'profile', 'phone', 'offline_access'],
        })
        return
      }

      // RFC 7591. The refusals mirror Supabase's: 403 with the switch off, 400
      // for a registration that names no redirect address.
      if (incoming.method === 'POST' && url.pathname === '/auth/v1/oauth/clients/register') {
        if (state.registrationOverride) {
          send(outgoing, state.registrationOverride.status, state.registrationOverride.body)
          return
        }
        if (!state.dynamicRegistration) {
          send(outgoing, 403, {
            code: 403,
            error_code: 'oauth_dynamic_client_registration_disabled',
            msg: 'Dynamic client registration is not enabled',
          })
          return
        }
        let params: Record<string, unknown>
        try {
          params = JSON.parse(body) as Record<string, unknown>
        } catch {
          send(outgoing, 400, { error: 'invalid_client_metadata', error_description: 'Invalid JSON body' })
          return
        }
        const redirectUris = Array.isArray(params.redirect_uris) ? (params.redirect_uris as string[]) : []
        if (redirectUris.length === 0) {
          send(outgoing, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris is required' })
          return
        }
        const registered: RegisteredClient = {
          clientId: `client-${state.registrations.length + 1}`,
          clientName: typeof params.client_name === 'string' ? params.client_name : '',
          redirectUris,
          tokenEndpointAuthMethod:
            typeof params.token_endpoint_auth_method === 'string'
              ? params.token_endpoint_auth_method
              : 'client_secret_basic',
          clientSecret: null,
        }
        // A public client gets no secret; anything else gets one, as Supabase does.
        if (registered.tokenEndpointAuthMethod !== 'none') {
          registered.clientSecret = `secret-for-${registered.clientId}`
        }
        state.registrations.push(registered)
        send(outgoing, 201, {
          client_id: registered.clientId,
          ...(registered.clientSecret ? { client_secret: registered.clientSecret } : {}),
          client_name: registered.clientName,
          redirect_uris: registered.redirectUris,
          token_endpoint_auth_method: registered.tokenEndpointAuthMethod,
          grant_types: params.grant_types ?? [],
        })
        return
      }

      // The authorization endpoint, with the consent screen collapsed into a
      // decision: the owner approved, or (`denyNext`) did not.
      if (incoming.method === 'GET' && url.pathname === '/auth/v1/oauth/authorize') {
        const query = url.searchParams
        const client = state.registrations.find((entry) => entry.clientId === query.get('client_id'))
        const redirectUri = query.get('redirect_uri') ?? ''
        if (!client || !client.redirectUris.includes(redirectUri)) {
          send(outgoing, 400, { error: 'invalid_request', error_description: 'unknown client or redirect_uri' })
          return
        }
        const target = new URL(redirectUri)
        const requestState = query.get('state')
        if (requestState) target.searchParams.set('state', requestState)
        if (state.denyNext) {
          state.denyNext = false
          target.searchParams.set('error', 'access_denied')
          target.searchParams.set('error_description', 'The user denied the request')
        } else {
          const code = `code-${state.authorizations.length + 1}`
          state.authorizations.push({
            code,
            clientId: client.clientId,
            redirectUri,
            codeChallenge: query.get('code_challenge') ?? '',
            codeChallengeMethod: query.get('code_challenge_method'),
            resource: query.get('resource'),
            scope: query.get('scope'),
          })
          target.searchParams.set('code', code)
        }
        outgoing.writeHead(302, { Location: target.href })
        outgoing.end()
        return
      }

      // The token endpoint. Every check Supabase makes that a client could fail —
      // starting with how the client authenticates, which has to be the method
      // it was registered with: Basic for `client_secret_basic`, the secret in
      // the body for `client_secret_post`, and neither for a public client.
      if (incoming.method === 'POST' && url.pathname === '/auth/v1/oauth/token') {
        const form = new URLSearchParams(body)
        state.tokenRequests.push(form)
        const basic = /^Basic\s+(.+)$/i.exec(incoming.headers.authorization ?? '')
        let clientId = form.get('client_id')
        let presentedSecret: string | null = null
        let presentedMethod = 'none'
        if (basic) {
          const [id, secret] = Buffer.from(basic[1], 'base64').toString('utf8').split(':')
          clientId = decodeURIComponent(id ?? '')
          presentedSecret = decodeURIComponent(secret ?? '')
          presentedMethod = 'client_secret_basic'
        } else if (form.has('client_secret')) {
          presentedSecret = form.get('client_secret')
          presentedMethod = 'client_secret_post'
        }
        const client = state.registrations.find((entry) => entry.clientId === clientId)
        if (!client || client.tokenEndpointAuthMethod !== presentedMethod) {
          send(outgoing, 401, {
            error: 'invalid_client',
            error_description: `client must authenticate with ${client?.tokenEndpointAuthMethod ?? 'a registered client'}`,
          })
          return
        }
        if (client.clientSecret !== null && presentedSecret !== client.clientSecret) {
          send(outgoing, 401, { error: 'invalid_client', error_description: 'wrong client secret' })
          return
        }
        const pending = state.authorizations.find((entry) => entry.code === form.get('code'))
        if (form.get('grant_type') !== 'authorization_code' || !pending) {
          send(outgoing, 400, { error: 'invalid_grant', error_description: 'unknown code' })
          return
        }
        if (pending.clientId !== clientId || pending.redirectUri !== form.get('redirect_uri')) {
          send(outgoing, 400, { error: 'invalid_grant', error_description: 'client or redirect_uri mismatch' })
          return
        }
        const challenge = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url')
        if (pending.codeChallengeMethod !== 'S256' || challenge !== pending.codeChallenge) {
          send(outgoing, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
          return
        }
        const resource = form.get('resource')
        if (resource && resource !== pending.resource) {
          send(outgoing, 400, {
            error: 'invalid_grant',
            error_description: 'Authorization code resource does not match',
          })
          return
        }
        const token = await keys.sign({ iss: state.issuer, sub: TEST_OWNER, client_id: pending.clientId })
        state.issued.push(token)
        send(outgoing, 200, {
          access_token: token,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: `refresh-${state.issued.length}`,
          scope: pending.scope ?? 'email',
        })
        return
      }

      send(outgoing, 404, { code: 404, error_code: 'not_found', msg: 'not found' })
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/v1`

  return Object.assign(state, {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  })
}

/* ------------------------------------------------------------------ *
 * The deployment, wired to it
 * ------------------------------------------------------------------ */

let keys: TestAuthorizationServer
let authorizationServer: FakeAuthorizationServer
let config: OAuthResourceConfig
let deployment: Harness
let served: ServedHarness
let baseUrl: string

beforeAll(async () => {
  keys = await testAuthorizationServer()
  authorizationServer = await fakeAuthorizationServer(keys)
  config = keys.config({ issuer: authorizationServer.issuer })
  // `publicOrigin` is filled in once the socket is listening: the resource the
  // metadata names has to be the address the client will post to.
  deployment = harness({
    oauth: config,
    authenticateOAuth: oauthAuthenticator(config, testAccessList().lookup, () => new Date(), keys.jwks()),
  })
  served = await listenHarness(deployment)
  baseUrl = served.address.origin
  deployment.deps.publicOrigin = baseUrl
})

afterAll(async () => {
  await served.close()
  await authorizationServer.close()
  await closeHarnessDatabases()
})

beforeEach(() => {
  authorizationServer.dynamicRegistration = true
  authorizationServer.denyNext = false
  authorizationServer.registrationOverride = null
})

/** A client registered "by hand" — here, straight into the server's list. */
function registerByHand(
  clientId: string,
  port: number,
  tokenEndpointAuthMethod: 'none' | 'client_secret_basic' | 'client_secret_post',
): RegisteredClient {
  const client: RegisteredClient = {
    clientId,
    clientName: 'For hånd',
    redirectUris: [`http://127.0.0.1:${port}/callback`],
    tokenEndpointAuthMethod,
    clientSecret: tokenEndpointAuthMethod === 'none' ? null : `secret-${clientId}`,
  }
  authorizationServer.registrations.push(client)
  return client
}

/* ------------------------------------------------------------------ *
 * Running the scripts
 * ------------------------------------------------------------------ */

interface Finished {
  code: number | null
  out: string
  err: string
}

/** A port nothing is listening on right now. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

/**
 * The client script, started and left running.
 *
 * It blocks waiting for a browser, so it cannot simply be run to completion:
 * the test has to read the address it prints, play the browser, and only then
 * wait for the exit.
 */
function startClient(args: string[], env: Record<string, string> = {}) {
  const child = spawn('node', ['scripts/mcp-oauth-client.mjs', '--base-url', baseUrl, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  })
  let out = ''
  let err = ''
  const watchers: (() => void)[] = []
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8')
    for (const watcher of watchers) watcher()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8')
  })
  const done = new Promise<Finished>((resolve) => {
    child.on('close', (code) => resolve({ code, out, err }))
  })

  return {
    done,
    /** The authorization address, once the script has printed it. */
    authorizationUrl: (): Promise<string> =>
      new Promise((resolve, reject) => {
        const look = (): void => {
          const found = out.match(/^\s+(https?:\/\/\S+\/oauth\/authorize\S*)$/m)
          if (found) resolve(found[1])
        }
        look()
        watchers.push(look)
        void done.then((finished) =>
          reject(new Error(`Skriptet avsluttet (${finished.code}) før det skrev ut en adresse:\n${finished.out}${finished.err}`)),
        )
      }),
  }
}

/** What the owner's browser does: open the address, and follow the redirect home. */
async function browse(authorizationUrl: string): Promise<void> {
  const answer = await fetch(authorizationUrl, { redirect: 'manual' })
  expect(answer.status).toBe(302)
  const home = answer.headers.get('location')
  expect(home).not.toBeNull()
  // Tilkoblingen lukkes etter svaret. Ellers holder testprosessens keep-alive
  // skriptets lytter åpen i flere sekunder etter at flyten er ferdig, og hver
  // test venter på det før skriptet kan avslutte.
  const back = await fetch(home!, { headers: { Connection: 'close' } })
  expect(back.status).toBe(200)
}

/** The smoke script, run the way a person or a CI job runs it. */
async function smoke(args: string[], env: Record<string, string> = {}): Promise<Finished> {
  try {
    const { stdout, stderr } = await run('node', ['scripts/mcp-smoke.mjs', '--base-url', baseUrl, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    })
    return { code: 0, out: stdout, err: stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, out: failure.stdout ?? '', err: failure.stderr ?? '' }
  }
}

/* ------------------------------------------------------------------ *
 * The client
 * ------------------------------------------------------------------ */

describe('scripts/mcp-oauth-client.mjs', () => {
  it('kjører hele flyten, og gjør et ekte tools/call med tokenet det fikk', async () => {
    const port = await freePort()
    const client = startClient(['--port', String(port), '--timeout', '30'])
    await browse(await client.authorizationUrl())
    const finished = await client.done

    expect(finished.out).toContain('dynamisk klientregistrering')
    expect(finished.out).toContain('tilbake fra nettleseren')
    expect(finished.out).toContain('tools/call med OAuth-tokenet')
    expect(finished.out).toContain('Hele flyten virker')
    expect(finished.out).not.toContain('FEIL')
    expect(finished.code).toBe(0)

    // What it registered: a public client on the loopback address, exactly.
    const registered = authorizationServer.registrations.at(-1)!
    expect(registered.redirectUris).toEqual([`http://127.0.0.1:${port}/callback`])
    expect(registered.tokenEndpointAuthMethod).toBe('none')

    // What it asked for: PKCE S256, and the resource the metadata named — the
    // same string, so the token is bound to this endpoint and no other.
    const asked = authorizationServer.authorizations.at(-1)!
    expect(asked.codeChallengeMethod).toBe('S256')
    expect(asked.resource).toBe(`${baseUrl}${AGENT_MCP_PATH}`)
    expect(authorizationServer.tokenRequests.at(-1)!.get('resource')).toBe(asked.resource)

    // The call reached a tool as an OAuth principal, attributed to the client.
    const audited = deployment.audit.entries.filter((entry) => entry.principalKind === 'oauth')
    expect(audited.length).toBeGreaterThan(0)
    expect(audited.at(-1)!.clientId).toBe(registered.clientId)
    expect(audited.at(-1)!.tokenId).toBeNull()
    expect(audited.at(-1)!.success).toBe(true)

    // And the token itself is nowhere in the output.
    expect(finished.out).not.toContain(authorizationServer.issued.at(-1)!)
  }, 30_000)

  it('skriver tokenet ut bare når det blir bedt om det, og da på siste linje', async () => {
    const port = await freePort()
    const client = startClient(['--port', String(port), '--timeout', '30', '--print-token'])
    await browse(await client.authorizationUrl())
    const finished = await client.done

    expect(finished.code).toBe(0)
    const lines = finished.out.trimEnd().split('\n')
    expect(lines.at(-1)).toBe(authorizationServer.issued.at(-1))
    // Said on stderr, so a `| tail -1` gets the token and nothing else.
    expect(finished.err).toContain('legitimasjon')
  }, 30_000)

  it('bruker en oppgitt client_id i stedet for å registrere seg', async () => {
    const port = await freePort()
    registerByHand('hand-registered', port, 'none')
    const before = authorizationServer.registrations.length
    const client = startClient(['--port', String(port), '--timeout', '30', '--client-id', 'hand-registered'])
    await browse(await client.authorizationUrl())
    const finished = await client.done

    expect(finished.code).toBe(0)
    expect(finished.out).not.toContain('dynamisk klientregistrering')
    expect(authorizationServer.registrations.length).toBe(before)
    expect(authorizationServer.authorizations.at(-1)!.clientId).toBe('hand-registered')
  }, 30_000)

  it('presenterer en hemmelighet med Basic som standard, slik Supabase registrerer konfidensielle klienter', async () => {
    const port = await freePort()
    const registered = registerByHand('confidential-basic', port, 'client_secret_basic')
    const client = startClient(
      ['--port', String(port), '--timeout', '30', '--client-id', registered.clientId],
      { SLAIDS_OAUTH_CLIENT_SECRET: registered.clientSecret! },
    )
    await browse(await client.authorizationUrl())
    const finished = await client.done

    expect(finished.out).toContain('client_secret_basic')
    expect(finished.code).toBe(0)
    // The secret went in the header, not the body — and not into the output.
    const exchange = authorizationServer.tokenRequests.at(-1)!
    expect(exchange.has('client_secret')).toBe(false)
    expect(finished.out).not.toContain(registered.clientSecret!)
    expect(authorizationServer.authorizations.at(-1)!.clientId).toBe(registered.clientId)
  }, 30_000)

  it('sender hemmeligheten i kroppen når klienten er registrert med client_secret_post', async () => {
    const port = await freePort()
    const registered = registerByHand('confidential-post', port, 'client_secret_post')
    const client = startClient(
      [
        '--port',
        String(port),
        '--timeout',
        '30',
        '--client-id',
        registered.clientId,
        '--token-auth',
        'client_secret_post',
      ],
      { SLAIDS_OAUTH_CLIENT_SECRET: registered.clientSecret! },
    )
    await browse(await client.authorizationUrl())
    const finished = await client.done

    expect(finished.code).toBe(0)
    expect(authorizationServer.tokenRequests.at(-1)!.get('client_secret')).toBe(registered.clientSecret)
  }, 30_000)

  it('stopper når hemmeligheten presenteres på en annen måte enn klienten ble registrert med', async () => {
    // Registered for the body, presented in the header: the token endpoint
    // refuses it, and the script says which step refused rather than going on.
    const port = await freePort()
    const registered = registerByHand('confidential-mismatch', port, 'client_secret_post')
    const client = startClient(
      ['--port', String(port), '--timeout', '30', '--client-id', registered.clientId],
      { SLAIDS_OAUTH_CLIENT_SECRET: registered.clientSecret! },
    )
    await browse(await client.authorizationUrl())
    const finished = await client.done

    expect(finished.out).toContain('FEIL  token')
    expect(finished.out).toContain('invalid_client')
    expect(finished.code).toBe(1)
  }, 30_000)

  it('nekter en hemmelighet uten en håndregistrert klient å høre til', async () => {
    const finished = await startClient(['--port', String(await freePort()), '--timeout', '30'], {
      SLAIDS_OAUTH_CLIENT_SECRET: 'løs-hemmelighet',
    }).done

    expect(finished.err).toContain('--client-id')
    expect(finished.code).toBe(2)
    expect(finished.out).not.toContain('løs-hemmelighet')
  }, 30_000)

  it('stopper når eieren sier nei', async () => {
    const port = await freePort()
    authorizationServer.denyNext = true
    const exchangesBefore = authorizationServer.tokenRequests.length
    const client = startClient(['--port', String(port), '--timeout', '30'])
    await browse(await client.authorizationUrl())
    const finished = await client.done

    expect(finished.out).toContain('access_denied')
    expect(finished.out).toContain('FEIL')
    expect(finished.code).toBe(1)
    // A denial is the end: nothing was taken to the token endpoint.
    expect(authorizationServer.tokenRequests.length).toBe(exchangesBefore)
  }, 30_000)

  it('forkaster et svar med feil state', async () => {
    // The code planted by somebody else: a callback that does not carry the
    // state this run sent is not this run's, whatever code it brings.
    const port = await freePort()
    const client = startClient(['--port', String(port), '--timeout', '30'])
    const authorizationUrl = new URL(await client.authorizationUrl())
    authorizationUrl.searchParams.set('state', 'somebody-elses')
    await browse(authorizationUrl.href)
    const finished = await client.done

    expect(finished.out).toContain('state')
    expect(finished.out).toContain('FEIL')
    expect(finished.code).toBe(1)
  }, 30_000)

  it('sier fra når registreringen er slått av i prosjektet', async () => {
    authorizationServer.dynamicRegistration = false
    const finished = await startClient(['--port', String(await freePort()), '--timeout', '30']).done

    expect(finished.err).toContain('Dynamic Client Registration')
    expect(finished.err).toContain('--client-id')
    expect(finished.code).toBe(2)
  }, 30_000)

  it('sier fra når installasjonen ikke tilbyr OAuth i det hele tatt', async () => {
    const plain = harness()
    const servedPlain = await listenHarness(plain)
    try {
      const child = spawn(
        'node',
        ['scripts/mcp-oauth-client.mjs', '--base-url', servedPlain.address.origin, '--timeout', '30'],
        { cwd: process.cwd() },
      )
      let err = ''
      child.stderr.on('data', (chunk: Buffer) => {
        err += chunk.toString('utf8')
      })
      const code = await new Promise<number | null>((resolve) => child.on('close', resolve))

      expect(err).toContain('ingen OAuth')
      expect(err).toContain('SLAIDS_AGENT_OAUTH=on')
      expect(code).toBe(2)
    } finally {
      await servedPlain.close()
    }
  }, 30_000)
})

/* ------------------------------------------------------------------ *
 * The smoke test's OAuth half, against the same server
 * ------------------------------------------------------------------ */

describe('scripts/mcp-smoke.mjs, med en autorisasjonsserver bak installasjonen', () => {
  it('går grønt, og sier hva den fant', async () => {
    const finished = await smoke([])

    expect(finished.out).toContain(`ressursen er ${baseUrl}${AGENT_MCP_PATH}`)
    expect(finished.out).toContain('PKCE S256')
    expect(finished.out).toContain('dynamisk klientregistrering er på — på (en tom registrering avvises med 400, invalid_client_metadata)')
    expect(finished.out).toContain('peker på dokumentet')
    expect(finished.out).not.toContain('FEIL')
    expect(finished.code).toBe(0)
    // The probe registered nothing.
    expect(authorizationServer.registrations.every((entry) => entry.clientName !== '')).toBe(true)
  }, 30_000)

  it('går grønt med --expect-oauth når installasjonen faktisk tilbyr OAuth', async () => {
    // The other half of the flag: it has to be silent about an installation
    // that is configured, or it would be a flag nobody could leave on.
    const finished = await smoke(['--expect-oauth'])

    expect(finished.out).not.toContain('FEIL')
    expect(finished.code).toBe(0)
  }, 30_000)

  it('blir rød når registreringen er slått av', async () => {
    authorizationServer.dynamicRegistration = false
    const finished = await smoke([])

    expect(finished.out).toContain('Dynamic Client Registration')
    expect(finished.out).toContain('FEIL')
    expect(finished.code).toBe(1)
  }, 30_000)

  it('blir rød når registreringen er rate-begrenset, i stedet for å gjette', async () => {
    // A 429 says nothing about the switch. Reading it as «på» would be the
    // check passing for a reason that has nothing to do with what it checks.
    authorizationServer.registrationOverride = {
      status: 429,
      body: { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' },
    }
    const finished = await smoke([])

    expect(finished.out).toContain('429')
    expect(finished.out).toContain('rate-begrenset')
    expect(finished.out).toContain('FEIL')
    expect(finished.code).toBe(1)
  }, 30_000)

  it('godtar bare valideringsavvisningen som «på»', async () => {
    // A 405 or a 401 is not a registration endpoint refusing an empty
    // registration; it is something else answering at that address.
    authorizationServer.registrationOverride = { status: 405, body: { error: 'method_not_allowed' } }
    const finished = await smoke([])

    expect(finished.out).toContain('405')
    expect(finished.out).toContain('FEIL')
    expect(finished.code).toBe(1)
  }, 30_000)

  it('kjører et ekte kall med et OAuth-token fra miljøet', async () => {
    const token = await keys.sign({ iss: authorizationServer.issuer, sub: TEST_OWNER, client_id: 'smoke' })
    const finished = await smoke([], { SLAIDS_OAUTH_TOKEN: token })

    expect(finished.out).toContain('tools/call virker med et OAuth-token')
    expect(finished.out).not.toContain('FEIL')
    expect(finished.out).not.toContain(token)
    expect(finished.code).toBe(0)
  }, 30_000)
})
