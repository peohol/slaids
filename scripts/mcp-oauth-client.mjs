#!/usr/bin/env node
/**
 * The OAuth flow, run end to end by a real client — this one.
 *
 * `scripts/mcp-smoke.mjs` checks everything a client can see *without* a
 * credential, which is everything up to the point where somebody has to log in.
 * The rest — registering a client, sending the owner to the consent screen,
 * exchanging the code for a token, and calling a tool with it — only exists
 * once a browser has been involved, and ChatGPT is a poor place to debug it:
 * it reports «could not connect» and nothing else.
 *
 * So this script is that client. It does exactly what a ChatGPT connector does,
 * step by step, and says which step it got to:
 *
 *   1. reads the protected resource metadata, and finds the authorization
 *      server it names (RFC 9728);
 *   2. reads that server's own metadata (RFC 8414);
 *   3. registers itself as a public client, dynamically (RFC 7591) — or uses a
 *      `client_id` you registered by hand;
 *   4. starts the authorization-code flow with PKCE S256, with a loopback
 *      redirect on this machine, and prints the address you open in a browser;
 *   5. receives the code on that loopback address, after you have approved on
 *      Slaids' own consent screen;
 *   6. exchanges it for an access token;
 *   7. calls one read-only tool over MCP with that token.
 *
 * Step 7 is the whole reason: it is the first *real* authenticated `tools/call`,
 * and it is made with the same kind of token ChatGPT will hold. If it works
 * here, what remains for ChatGPT is ChatGPT.
 *
 * Usage:
 *
 *   node scripts/mcp-oauth-client.mjs --base-url https://www.slaids.no
 *   node scripts/mcp-oauth-client.mjs --base-url https://… --print-token
 *   node scripts/mcp-oauth-client.mjs --base-url https://… --client-id <id>
 *
 * Flags: `--port` (loopback port, default 8765 — the redirect address is
 * registered with the exact port, so the same one has to be free next time),
 * `--scope` (what to ask the authorization server for; unset asks for its
 * default), `--timeout` (seconds to wait for the browser, default 600).
 *
 * **The token is never printed unless you ask.** `--print-token` writes the
 * access token as the last line of stdout, for `SLAIDS_OAUTH_TOKEN` in
 * `scripts/mcp-smoke.mjs` or the `SLAIDS_OAUTH_ACCESS_TOKEN` secret in Actions.
 * It is a credential for your own account, valid for about an hour; treat it
 * as one. A client secret, if a hand-registered confidential client needs one,
 * is read from `SLAIDS_OAUTH_CLIENT_SECRET` in the environment and from nowhere
 * else, for the reason given at the top of the smoke script: an argument list
 * is readable by every process on the machine.
 *
 * Nothing a tool answered with is printed either — statuses and names only, so
 * the output is safe to paste into an issue.
 *
 * Exit code 0 when the tool call went through; 1 when a step of the flow
 * failed; 2 when the installation is not ready for the flow at all (no OAuth
 * published, the authorization server off, registration off) or the arguments
 * were wrong.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const ARGS = process.argv.slice(2)

function flag(name, fallback = null) {
  const at = ARGS.indexOf(`--${name}`)
  if (at >= 0 && at + 1 < ARGS.length) return ARGS[at + 1]
  const inline = ARGS.find((argument) => argument.startsWith(`--${name}=`))
  return inline ? inline.slice(`--${name}=`.length) : fallback
}

function has(name) {
  return ARGS.includes(`--${name}`)
}

const baseUrl = (flag('base-url') ?? process.env.SLAIDS_BASE_URL ?? '').replace(/\/+$/, '')
const port = Number(flag('port') ?? '8765')
const givenClientId = flag('client-id') ?? process.env.SLAIDS_OAUTH_CLIENT_ID ?? null
/** Environment only. See the note at the top. */
const clientSecret = process.env.SLAIDS_OAUTH_CLIENT_SECRET ?? null
const scope = flag('scope') ?? null
const printToken = has('print-token')
const timeoutSeconds = Number(flag('timeout') ?? '600')

if (!baseUrl) {
  console.error('Bruk: node scripts/mcp-oauth-client.mjs --base-url https://<domenet> [--print-token]')
  process.exit(2)
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Ugyldig --port «${flag('port')}». Bruk et portnummer mellom 1 og 65535.`)
  process.exit(2)
}
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
  console.error(`Ugyldig --timeout «${flag('timeout')}». Bruk et antall sekunder.`)
  process.exit(2)
}

const MCP_URL = `${baseUrl}/api/agent/v1/mcp`
/** RFC 9728 inserts the well-known segment between host and resource path. */
const RESOURCE_METADATA_URL = `${baseUrl}/.well-known/oauth-protected-resource/api/agent/v1/mcp`
/** Loopback, with the exact port: the authorization server matches it verbatim. */
const REDIRECT_URI = `http://127.0.0.1:${port}/callback`
const CLIENT_NAME = 'Slaids OAuth-klient (lokal test)'

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

function ok(name, note = '') {
  console.log(`  ok    ${name}${note ? ` — ${note}` : ''}`)
}

/** A step that did not go through. The flow cannot continue past it. */
function fail(name, message, code = 1) {
  console.log(`  FEIL  ${name} — ${message}`)
  process.exit(code)
}

/** An installation that is not ready, said once and plainly. */
function notReady(message) {
  console.error(`\n${message}`)
  process.exit(2)
}

/* ------------------------------------------------------------------ *
 * Small pieces of OAuth
 * ------------------------------------------------------------------ */

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

/** RFC 7636: a high-entropy verifier and its S256 challenge. */
function pkce() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** The payload of a JWT, read without verifying — for display only, never trust. */
function unverifiedClaims(token) {
  try {
    const payload = token.split('.')[1]
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

async function json(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) } })
  const text = await response.text()
  let body
  try {
    body = text.length > 0 ? JSON.parse(text) : null
  } catch {
    // Not JSON is a fact about the answer — an auth wall, a platform 404 — and
    // the steps below say so more usefully than a parse error would.
    body = null
  }
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    headers: response.headers,
    body,
    text,
  }
}

/** One JSON-RPC message to the MCP endpoint. `auth` is explicit on every call. */
let nextId = 0
async function mcp(method, { params, auth = null } = {}) {
  nextId += 1
  const answer = await json(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId, method, ...(params ? { params } : {}) }),
  })
  return answer
}

/** The one thing an error body from an authorization server is allowed to say to us. */
function describeError(answer) {
  const body = answer.body ?? {}
  const code = body.error_code ?? body.error ?? body.code ?? ''
  const description = body.error_description ?? body.msg ?? body.message ?? ''
  return [code, description].filter((part) => typeof part === 'string' && part.length > 0).join(': ') ||
    `status ${answer.status}`
}

/* ------------------------------------------------------------------ *
 * 1–2. Discovery
 * ------------------------------------------------------------------ */

console.log(`\nOAuth-flyt mot ${MCP_URL}\n`)

const resourceMetadata = await json(RESOURCE_METADATA_URL)
if (resourceMetadata.status !== 200 || !/\bjson\b/i.test(resourceMetadata.type) || !resourceMetadata.body) {
  notReady(
    `${RESOURCE_METADATA_URL} svarte ${resourceMetadata.status}${
      /\bjson\b/i.test(resourceMetadata.type) ? '' : ' med noe som ikke er JSON'
    }.\n` +
      'Installasjonen tilbyr ingen OAuth. Er SLAIDS_AGENT_OAUTH_OWNERS satt i servermiljøet, og er\n' +
      'deployen kjørt på nytt etterpå?',
  )
}
const resource = resourceMetadata.body.resource
const issuer = (resourceMetadata.body.authorization_servers ?? [])[0]
if (typeof resource !== 'string' || typeof issuer !== 'string') {
  notReady('Metadatadokumentet mangler «resource» eller «authorization_servers».')
}
ok('protected resource metadata', `ressursen er ${resource}`)

const issuerUrl = new URL(issuer.replace(/\/+$/, ''))
const discovery = `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname}`
const metadata = await json(discovery)
if (metadata.status !== 200 || !metadata.body) {
  notReady(
    `${discovery} svarte ${metadata.status} (${describeError(metadata)}).\n` +
      'Er OAuth 2.1 Server slått på i Supabase-prosjektet, under Authentication → OAuth Server?',
  )
}
const server = metadata.body
for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint']) {
  if (typeof server[field] !== 'string') notReady(`Autorisasjonsserverens metadata mangler «${field}».`)
}
if (server.issuer.replace(/\/+$/, '') !== issuerUrl.href.replace(/\/+$/, '')) {
  fail('autorisasjonsserverens metadata', `«issuer» er ${server.issuer}, men ressursen navnga ${issuer}`)
}
if (!(server.code_challenge_methods_supported ?? []).includes('S256')) {
  fail('autorisasjonsserverens metadata', 'annonserer ikke PKCE med S256')
}
ok('autorisasjonsserverens metadata', `${server.issuer}, PKCE S256`)

/* ------------------------------------------------------------------ *
 * 3. A client to be
 * ------------------------------------------------------------------ */

let clientId = givenClientId
if (clientId) {
  ok('klient', `bruker den oppgitte client_id-en${clientSecret ? ', med hemmelighet' : ''}`)
} else {
  // RFC 7591. A public client: no secret to keep, PKCE is the proof of
  // possession, which is exactly what a native/loopback client is meant to be.
  const registrationEndpoint =
    typeof server.registration_endpoint === 'string'
      ? server.registration_endpoint
      : `${server.issuer.replace(/\/+$/, '')}/oauth/clients/register`
  const registration = await json(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (registration.status === 403 || registration.status === 404) {
    notReady(
      `Registreringen svarte ${registration.status} (${describeError(registration)}).\n` +
        'Dynamic Client Registration er av i Supabase-prosjektet. Slå den på under Authentication →\n' +
        'OAuth Server, eller registrer en klient for hånd med redirect-adressen\n' +
        `  ${REDIRECT_URI}\n` +
        'og oppgi den med --client-id.',
    )
  }
  if (registration.status !== 201 && registration.status !== 200) {
    fail('dynamisk klientregistrering', `svarte ${registration.status} (${describeError(registration)})`)
  }
  clientId = registration.body?.client_id
  if (typeof clientId !== 'string' || clientId.length === 0) {
    fail('dynamisk klientregistrering', 'svaret hadde ingen client_id')
  }
  ok('dynamisk klientregistrering', `client_id ${clientId}`)
}

/* ------------------------------------------------------------------ *
 * 4–5. The browser, and the code it brings back
 * ------------------------------------------------------------------ */

const { verifier, challenge } = pkce()
const state = base64url(randomBytes(16))

const authorizationUrl = new URL(server.authorization_endpoint)
authorizationUrl.searchParams.set('response_type', 'code')
authorizationUrl.searchParams.set('client_id', clientId)
authorizationUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authorizationUrl.searchParams.set('code_challenge', challenge)
authorizationUrl.searchParams.set('code_challenge_method', 'S256')
authorizationUrl.searchParams.set('state', state)
// RFC 8707: the token is for this resource and no other. MCP clients send it;
// so does this one, so the flow is the flow ChatGPT will run.
authorizationUrl.searchParams.set('resource', resource)
if (scope) authorizationUrl.searchParams.set('scope', scope)

/**
 * Wait for the browser to come back to the loopback address with the code.
 *
 * The address is printed only once the socket is listening, so a fast hand
 * cannot open it before there is anything there to answer.
 */
const callback = await new Promise((resolve, reject) => {
  const listener = createServer((incoming, outgoing) => {
    const asked = new URL(incoming.url ?? '/', `http://127.0.0.1:${port}`)
    if (asked.pathname !== '/callback') {
      outgoing.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      outgoing.end('Ikke her.')
      return
    }
    const received = {
      code: asked.searchParams.get('code'),
      state: asked.searchParams.get('state'),
      error: asked.searchParams.get('error'),
      errorDescription: asked.searchParams.get('error_description'),
    }
    const message = received.error
      ? `Slaids: forespørselen ble avvist (${received.error}). Du kan lukke denne fanen.`
      : 'Slaids: koden er mottatt. Du kan lukke denne fanen og gå tilbake til terminalen.'
    outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    outgoing.end(`<!doctype html><meta charset="utf-8"><title>Slaids</title><p>${message}</p>`)
    clearTimeout(timer)
    listener.close()
    resolve(received)
  })
  const timer = setTimeout(() => {
    listener.close()
    reject(new Error(`Ingen nettleser kom tilbake til ${REDIRECT_URI} på ${timeoutSeconds} sekunder.`))
  }, timeoutSeconds * 1000)
  listener.on('error', (error) => {
    clearTimeout(timer)
    reject(new Error(`Kunne ikke lytte på ${REDIRECT_URI}: ${error.message}. Prøv en annen --port.`))
  })
  listener.listen(port, '127.0.0.1', () => {
    console.log(`\nÅpne denne adressen i nettleseren, logg inn i Slaids om du blir bedt om det, og gi tilgang:\n`)
    console.log(`  ${authorizationUrl.href}\n`)
    console.log(`Venter på at nettleseren kommer tilbake til ${REDIRECT_URI} …\n`)
  })
}).catch((error) => fail('tilbake fra nettleseren', error.message))

if (callback.error) {
  fail(
    'tilbake fra nettleseren',
    `autorisasjonsserveren avviste forespørselen: ${callback.error}${
      callback.errorDescription ? ` (${callback.errorDescription})` : ''
    }`,
  )
}
if (callback.state !== state) {
  // The one check that guards the whole flow against a code planted by
  // somebody else: a callback that does not carry our own state is not ours.
  fail('tilbake fra nettleseren', 'svaret bar en annen «state» enn den som ble sendt – forkastet')
}
if (!callback.code) fail('tilbake fra nettleseren', 'svaret hadde ingen kode')
ok('tilbake fra nettleseren', 'koden er mottatt, state stemmer')

/* ------------------------------------------------------------------ *
 * 6. The token
 * ------------------------------------------------------------------ */

const form = new URLSearchParams({
  grant_type: 'authorization_code',
  code: callback.code,
  redirect_uri: REDIRECT_URI,
  client_id: clientId,
  code_verifier: verifier,
  resource,
})
if (clientSecret) form.set('client_secret', clientSecret)

const exchange = await json(server.token_endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: form.toString(),
})
if (exchange.status !== 200 || typeof exchange.body?.access_token !== 'string') {
  fail('token', `token-endepunktet svarte ${exchange.status} (${describeError(exchange)})`)
}
const accessToken = exchange.body.access_token
const claims = unverifiedClaims(accessToken)
const expiresIn = typeof exchange.body.expires_in === 'number' ? exchange.body.expires_in : null
ok(
  'token',
  [
    claims.sub ? `for bruker ${claims.sub}` : null,
    claims.client_id ? `client_id ${claims.client_id}` : null,
    exchange.body.scope ? `scope «${exchange.body.scope}»` : null,
    expiresIn !== null ? `utløper om ${Math.round(expiresIn / 60)} min` : null,
  ]
    .filter(Boolean)
    .join(', '),
)

/* ------------------------------------------------------------------ *
 * 7. The call
 * ------------------------------------------------------------------ */

const listing = await mcp('tools/list')
const tools = listing.body?.result?.tools
if (listing.status !== 200 || !Array.isArray(tools) || tools.length === 0) {
  fail('tools/list', `svarte ${listing.status} uten en verktøyliste`)
}
// Read-only, and with nothing required — chosen out of the catalogue rather
// than named here, so this file keeps no second list of what Slaids can do.
const tool = tools.find(
  (candidate) =>
    candidate.annotations?.readOnlyHint === true && (candidate.inputSchema?.required ?? []).length === 0,
)
if (!tool) fail('tools/list', 'fant ingen lesende operasjon uten påkrevde felter i katalogen')

const call = await mcp('tools/call', { params: { name: tool.name, arguments: {} }, auth: accessToken })
if (call.status !== 200) {
  const challengeHeader = call.headers.get('www-authenticate') ?? ''
  fail(
    'tools/call med OAuth-tokenet',
    `svarte ${call.status}${challengeHeader ? ` (${challengeHeader})` : ''}. ` +
      'Er brukeren tokenet ble utstedt til med i SLAIDS_AGENT_OAUTH_OWNERS?',
  )
}
if (call.body?.error) {
  fail('tools/call med OAuth-tokenet', `JSON-RPC-feil ${JSON.stringify(call.body.error)}`)
}
const result = call.body?.result
if (result?.isError === true) {
  const code = result.structuredContent?.error?.code ?? 'ukjent feil'
  fail('tools/call med OAuth-tokenet', `verktøyet avviste kallet: ${code}`)
}
if (result?.structuredContent === undefined) {
  fail('tools/call med OAuth-tokenet', 'svaret hadde ingen structuredContent')
}
ok('tools/call med OAuth-tokenet', `${tool.name} svarte 200`)

console.log('\nHele flyten virker: registrering, samtykke, token og et autentisert verktøykall.')

if (printToken) {
  console.error('\nAccess token følger på siste linje. Det er en legitimasjon for kontoen din i omtrent en time.')
  console.log(accessToken)
}
