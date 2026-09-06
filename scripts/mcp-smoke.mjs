#!/usr/bin/env node
/**
 * The MCP endpoint, checked from outside, over real HTTP.
 *
 * Everything under `npm test` drives the handler in-process. That is the right
 * place for behaviour, and the wrong place for the two things that only exist
 * once something is deployed: the platform's own routing (a static function plus
 * a rewrite, which has been wrong before while every test was green) and the
 * authentication boundary as a *client* meets it — status codes, headers, and
 * whether a client with no token gets a tool catalogue.
 *
 * So this script speaks only HTTP. It knows nothing about Slaids' source, names
 * no operation, and asserts the contract a stranger would read:
 *
 *   MCP discovery is public; Slaids' operations are authenticated.
 *
 * Usage:
 *
 *   node scripts/mcp-smoke.mjs --base-url https://www.slaids.no
 *   SLAIDS_TOKEN=slaids_at_… node scripts/mcp-smoke.mjs --base-url https://www.slaids.no
 *   SLAIDS_OAUTH_TOKEN=eyJ… node scripts/mcp-smoke.mjs --base-url https://www.slaids.no
 *   node scripts/mcp-smoke.mjs --base-url https://… --header 'Cookie: _vercel_jwt=…'
 *
 * The agent token is read from `SLAIDS_TOKEN` or from `--token`, and the
 * environment is the better of the two: a process's argument list is readable by
 * other processes on the same machine, and by a CI runner's own logging. In CI it
 * belongs in the secret store — never in a `workflow_dispatch` input, which the
 * platform records and displays with the run.
 *
 * An **OAuth** access token is read from `SLAIDS_OAUTH_TOKEN` and from nowhere
 * else — there is deliberately no flag for it. Obtaining one is an interactive
 * browser flow (`scripts/mcp-oauth-client.mjs` runs it, and `--print-token`
 * hands the token over), so this script never starts one and never depends on one: the
 * OAuth half below runs only if a token was handed to it, and everything about
 * the OAuth *contract* that a client can see without a credential — the metadata
 * document, the challenge that points at it, the authorization server behind it
 * — is checked anonymously, every run.
 *
 * `--header` may be repeated, and exists for the layer *in front of* the
 * deployment rather than for Slaids: a preview address behind Vercel
 * Authentication answers a plain client with a redirect to an SSO page, and a
 * bypass cookie is how a script gets past the front door to the thing it came to
 * test. It refuses `Authorization`, because every check below that says
 * "anonymous" would otherwise be a lie.
 *
 * Without a token it runs the public half and the refusals — which is the whole
 * of what a client sees before an owner has connected an account, and therefore
 * the whole of what the ChatGPT tool scan sees. With one it also runs a real
 * tool call and compares the public catalogue against the authenticated REST
 * catalogue on the same deployment: if those two ever differed, the public list
 * would be describing the caller rather than Slaids.
 *
 * The token is never printed, and neither is anything a tool answered with:
 * this reports statuses and counts, so its output is safe to leave in a log.
 * Exit code is 0 only if every check passed.
 */

const ARGS = process.argv.slice(2)

function flag(name, fallback = null) {
  const at = ARGS.indexOf(`--${name}`)
  if (at >= 0 && at + 1 < ARGS.length) return ARGS[at + 1]
  const inline = ARGS.find((argument) => argument.startsWith(`--${name}=`))
  return inline ? inline.slice(`--${name}=`.length) : fallback
}

/** Every `--name value` pair, in order. For the flags that may repeat. */
function flags(name) {
  const found = []
  for (const [index, argument] of ARGS.entries()) {
    if (argument === `--${name}` && index + 1 < ARGS.length) found.push(ARGS[index + 1])
    else if (argument.startsWith(`--${name}=`)) found.push(argument.slice(`--${name}=`.length))
  }
  return found
}

const baseUrl = (flag('base-url') ?? process.env.SLAIDS_BASE_URL ?? '').replace(/\/+$/, '')
const token = flag('token') ?? process.env.SLAIDS_TOKEN ?? null
/** Environment only. See the note at the top: there is no flag for this one. */
const oauthToken = process.env.SLAIDS_OAUTH_TOKEN ?? null
const expectTools = Number(flag('expect-tools') ?? '0')

/** Headers for the layer in front of the deployment. Never `Authorization`. */
const extraHeaders = {}
for (const raw of flags('header')) {
  const at = raw.indexOf(':')
  if (at < 0) {
    console.error(`Ugyldig --header «${raw}». Formen er «Navn: verdi».`)
    process.exit(2)
  }
  const name = raw.slice(0, at).trim()
  if (/^authorization$/i.test(name)) {
    console.error('--header kan ikke sette Authorization. Bruk --token; ellers er «uten token» ikke sant.')
    process.exit(2)
  }
  extraHeaders[name] = raw.slice(at + 1).trim()
}

if (!baseUrl) {
  console.error('Bruk: node scripts/mcp-smoke.mjs --base-url https://<domenet> [--token slaids_at_…]')
  process.exit(2)
}

const MCP_URL = `${baseUrl}/api/agent/v1/mcp`
const OPERATIONS_URL = `${baseUrl}/api/agent/v1/operations`
/** RFC 9728 inserts the well-known segment between host and resource path. */
const RESOURCE_METADATA_URL = `${baseUrl}/.well-known/oauth-protected-resource/api/agent/v1/mcp`
const ROOT_RESOURCE_METADATA_URL = `${baseUrl}/.well-known/oauth-protected-resource`

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const results = []

async function check(name, run) {
  try {
    const note = await run()
    results.push({ name, ok: true, note: note ?? '' })
    console.log(`  ok    ${name}${note ? ` — ${note}` : ''}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    results.push({ name, ok: false, note: message })
    console.log(`  FEIL  ${name} — ${message}`)
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

/* ------------------------------------------------------------------ *
 * Talking to the endpoint
 * ------------------------------------------------------------------ */

let nextId = 0

/**
 * One JSON-RPC message.
 *
 * `auth` is explicit on every call rather than defaulted, because which of them
 * carries a token is the entire subject of this script.
 */
async function send(method, { params, auth = null, headers = {}, notification = false } = {}) {
  nextId += 1
  const body = {
    jsonrpc: '2.0',
    ...(notification ? {} : { id: nextId }),
    method,
    ...(params ? { params } : {}),
  }
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null
  } catch {
    // A body that is not JSON is a fact about the answer, not a crash: a
    // platform 404 page or an auth wall in front of the deployment reads that
    // way, and the checks below say so much more usefully than a stack trace.
    parsed = null
  }
  return { status: response.status, headers: response.headers, text, body: parsed }
}

function resultOf(answer) {
  expect(answer.status === 200, `forventet 200, fikk ${answer.status}`)
  expect(answer.body !== null, 'svaret var ikke JSON')
  expect(!answer.body.error, `fikk JSON-RPC-feil ${JSON.stringify(answer.body.error)}`)
  return answer.body.result
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

console.log(`\nMCP smoke test mot ${MCP_URL}`)
console.log(token ? 'Med token: hele runden.\n' : 'Uten token: den offentlige halvdelen og avvisningene.\n')

// A redirect that changes origin is the one failure this script cannot see from
// the answers alone, and the one most likely to be mistaken for a bug in the
// server: `fetch` follows it, and **drops `Authorization` on the way** — the
// Fetch standard requires that, so every check below that depends on a token
// would quietly be testing an anonymous request instead. It bit this script on
// its first real run: `https://slaids.no` answers `308` to `https://www.slaids.no`,
// so a token sent to the apex never arrives, and the endpoint correctly answered
// a *tokenless* request. Checked with `redirect: 'manual'`, because following it
// is exactly what hides it.
const entry = await fetch(MCP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...extraHeaders },
  body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
  redirect: 'manual',
})
if (entry.status >= 300 && entry.status < 400) {
  // A `Location` that will not parse is not a redirect anybody can follow, so
  // it is left to the checks below rather than guessed at here.
  let target
  try {
    target = new URL(entry.headers.get('location') ?? '', MCP_URL)
  } catch {
    target = null
  }
  if (target && target.origin !== new URL(MCP_URL).origin) {
    console.error(
      `Adressen svarte ${entry.status} og sender deg videre til en annen origin:\n` +
        `  ${new URL(MCP_URL).origin} → ${target.origin}\n` +
        'En klient følger den, men taper «Authorization» på veien – det krever Fetch-standarden\n' +
        'ved en kryss-origin-redirect – så et token ville aldri nådd fram, og hver sjekk under\n' +
        'ville i stillhet målt en anonym forespørsel.\n' +
        `Kjør mot ${target.origin} i stedet. Det er også adressen en MCP-klient skal peke på.`,
    )
    process.exit(2)
  }
}

// Two answers mean the address is not this endpoint at all, and every check
// below would then be ten repetitions of one fact. Said once, plainly, because
// the two are ordinary mistakes rather than failures:
//
//  - `503 SERVER_NOT_CONFIGURED` is a deployment with no Supabase in its server
//    environment. Vercel preview deployments are built without the server
//    variables unless somebody enables them for Preview, so this is what a
//    preview address usually answers.
//  - a body that is not JSON is something in front of the deployment answering
//    instead of it — an authentication wall, or a platform 404.
const reachable = await send('ping')
if (reachable.body === null) {
  console.error(
    `Adressen svarte ${reachable.status} med noe som ikke er JSON. Da er det ikke Slaids som svarer:\n` +
      'et beskyttelseslag foran installasjonen, eller feil adresse. Se --header i toppen av denne filen.',
  )
  process.exit(2)
}
if (reachable.body.error?.code === 'SERVER_NOT_CONFIGURED') {
  console.error(
    'Denne installasjonen har ingen Supabase i servermiljøet sitt, så agent-API-et svarer 503 på alt:\n' +
      `«${reachable.body.error.message}»\n` +
      'Det sier ingenting om MCP-grensen. Kjør mot en installasjon som er konfigurert.',
  )
  process.exit(2)
}

console.log('Oppdagelse uten Authorization')

let catalogue = []

await check('initialize', async () => {
  const answer = await send('initialize', {
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'slaids-smoke', version: '1.0.0' },
    },
  })
  const result = resultOf(answer)
  expect(typeof result.protocolVersion === 'string', 'ingen protocolVersion i svaret')
  expect(result.capabilities?.tools !== undefined, 'serveren annonserer ingen tools-kapabilitet')
  expect(typeof result.serverInfo?.name === 'string', 'ingen serverInfo.name')
  expect(typeof result.instructions === 'string', 'ingen instructions')
  return `${result.serverInfo.name} ${result.serverInfo.version ?? ''}, protokoll ${result.protocolVersion}`.trim()
})

await check('notifications/initialized', async () => {
  const answer = await send('notifications/initialized', { notification: true })
  expect(answer.status === 202, `forventet 202, fikk ${answer.status}`)
  expect(answer.text === '', 'en notifikasjon skal ikke få en kropp tilbake')
  return '202, ingen kropp'
})

await check('ping', async () => {
  const answer = await send('ping')
  resultOf(answer)
  return '200'
})

await check('tools/list', async () => {
  const answer = await send('tools/list')
  const result = resultOf(answer)
  expect(Array.isArray(result.tools), 'tools er ikke en liste')
  expect(result.tools.length > 0, 'verktøylisten er tom – dette er nøyaktig feilen en klient ser')
  for (const tool of result.tools) {
    expect(typeof tool.name === 'string' && tool.name.length > 0, 'et verktøy uten navn')
    expect(typeof tool.description === 'string', `verktøyet ${tool.name} mangler beskrivelse`)
    expect(tool.inputSchema?.type === 'object', `verktøyet ${tool.name} har ikke et objektskjema`)
  }
  if (expectTools > 0) {
    expect(
      result.tools.length === expectTools,
      `forventet ${expectTools} verktøy, fikk ${result.tools.length}`,
    )
  }
  catalogue = result.tools
  return `${result.tools.length} verktøy`
})

/**
 * A tool this script may call without inventing arguments for it.
 *
 * Read-only, and with nothing required — chosen out of the catalogue rather than
 * named here, so this file keeps no second list of what Slaids can do.
 */
function callableTool() {
  const candidate = catalogue.find(
    (tool) =>
      tool.annotations?.readOnlyHint === true &&
      (tool.inputSchema?.required ?? []).length === 0,
  )
  expect(candidate !== undefined, 'fant ingen lesende operasjon uten påkrevde felter i katalogen')
  return candidate.name
}

console.log('\nOperasjoner uten Authorization')

await check('tools/call avvises med 401 og utfordringen', async () => {
  const answer = await send('tools/call', { params: { name: callableTool(), arguments: {} } })
  expect(answer.status === 401, `forventet 401, fikk ${answer.status}`)
  const challenge = answer.headers.get('www-authenticate') ?? ''
  expect(/bearer/i.test(challenge), `mangler WWW-Authenticate: Bearer (fikk «${challenge}»)`)
  // RFC 6750 §3.1: nothing was presented, so nothing was rejected.
  expect(!/error=/i.test(challenge), `utfordringen sier at et token ble avvist, men ingen ble sendt: «${challenge}»`)
  const refusal = answer.body?.result
  expect(refusal?.isError === true, 'kroppen bærer ikke avvisningen som et resultat')
  expect(
    refusal?.structuredContent?.error?.code === 'UNAUTHENTICATED',
    `forventet UNAUTHENTICATED, fikk ${refusal?.structuredContent?.error?.code}`,
  )
  // The same challenge, where a mixed-authentication client looks for it.
  expect(
    Array.isArray(refusal?._meta?.['mcp/www_authenticate']) &&
      refusal._meta['mcp/www_authenticate'][0] === challenge,
    'resultatet bærer ikke den samme utfordringen i _meta["mcp/www_authenticate"]',
  )
  return '401 med utfordring, i headeren og i resultatet'
})

await check('et ukjent token avvises også på oppdagelse', async () => {
  // A token that *was* presented is verified for every method, so revocation is
  // never a quiet downgrade to anonymous access.
  const answer = await send('tools/list', { auth: `slaids_at_${'A'.repeat(43)}` })
  expect(answer.status === 401, `forventet 401, fikk ${answer.status}`)
  return '401'
})

await check('en nettleserside slipper fortsatt ikke inn', async () => {
  // The DNS-rebinding guard, which public discovery must not have opened.
  const answer = await send('tools/list', { headers: { Origin: 'https://evil.example' } })
  expect(answer.status === 403, `forventet 403, fikk ${answer.status}`)
  return '403 på Origin'
})

await check('REST-katalogen er fortsatt lukket', async () => {
  const response = await fetch(OPERATIONS_URL, {
      headers: { Accept: 'application/json', ...extraHeaders },
    })
  expect(response.status === 401, `forventet 401, fikk ${response.status}`)
  return '401'
})

/* ------------------------------------------------------------------ *
 * OAuth, as far as a client can get without a credential
 * ------------------------------------------------------------------ */

console.log('\nOAuth-oppdagelse uten Authorization')

/** The metadata document, or `null` when this deployment offers no OAuth. */
let resourceMetadata = null
/** The authorization server's own metadata, once it has answered. */
let authorizationServer = null

/**
 * The metadata document at one address, or `null` when there is none there.
 *
 * A body that is not JSON counts as "none", and that is not laziness: the SPA
 * catch-all answers every unrouted address with `index.html`, so an
 * installation that predates this endpoint replies `200 text/html` rather than
 * a 404. Both mean the same thing to a client looking for an authorization
 * server, and reporting the second as a parse error would be reporting the
 * symptom.
 */
async function metadataAt(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', ...extraHeaders } })
  if (response.status === 404) return null
  const type = response.headers.get('content-type') ?? ''
  if (!/\bjson\b/i.test(type)) return null
  expect(response.status === 200, `forventet 200 eller 404, fikk ${response.status}`)
  return response.json()
}

await check('protected resource metadata', async () => {
  const document = await metadataAt(RESOURCE_METADATA_URL)
  if (!document) {
    return 'ingen OAuth i denne installasjonen – resten av OAuth-sjekkene hopper over'
  }
  expect(typeof document.resource === 'string', 'dokumentet har ingen «resource»')
  expect(
    document.resource === MCP_URL,
    `«resource» skal være den kanoniske MCP-adressen. Fikk ${document.resource}, forventet ${MCP_URL}.\n` +
      'Er de ulike, ber klienten om et token for én adresse og bruker det på en annen.',
  )
  expect(
    Array.isArray(document.authorization_servers) && document.authorization_servers.length > 0,
    'dokumentet navngir ingen autorisasjonsserver, som MCP krever at det gjør',
  )
  resourceMetadata = document
  return `ressursen er ${document.resource}`
})

await check('den samme metadataen på rot-adressen', async () => {
  // The specification requires a client to try the path-inserted address first
  // and the root second. Both have to answer, or half the clients fail.
  const document = await metadataAt(ROOT_RESOURCE_METADATA_URL)
  if (!resourceMetadata) {
    expect(document === null, 'rot-adressen svarer med metadata som den dype adressen ikke har')
    return 'hoppet over'
  }
  expect(document !== null, 'rot-adressen svarer ikke med metadata, som spesifikasjonen ber om')
  expect(
    JSON.stringify(document) === JSON.stringify(resourceMetadata),
    'rot-adressen svarer med et annet dokument enn den dype adressen',
  )
  return 'identisk'
})

await check('autorisasjonsserveren finnes og er slått på', async () => {
  if (!resourceMetadata) return 'hoppet over'
  // The one thing this script can check that no unit test can: the
  // authorization server the document names is actually serving OAuth. Supabase
  // answers `feature_disabled` here until somebody turns it on in the
  // dashboard, and that is exactly the failure that would otherwise show up as
  // «ChatGPT kan ikke koble til» with nothing to go on.
  const issuer = resourceMetadata.authorization_servers[0].replace(/\/+$/, '')
  const url = new URL(issuer)
  const discovery = `${url.origin}/.well-known/oauth-authorization-server${url.pathname}`
  const response = await fetch(discovery, { headers: { Accept: 'application/json' } })
  expect(
    response.status === 200,
    `${discovery} svarte ${response.status}. Er OAuth 2.1 Server slått på i Supabase-prosjektet?`,
  )
  const metadata = await response.json()
  // RFC 8414 §3.3: the document has to name the issuer it was fetched for, or
  // a client has been handed some other server's endpoints — and every token
  // it then brings back carries an `iss` Slaids will refuse.
  expect(
    typeof metadata.issuer === 'string' && metadata.issuer.replace(/\/+$/, '') === issuer,
    `metadataens «issuer» er ${metadata.issuer}, men ressursen navnga ${issuer}`,
  )
  expect(typeof metadata.authorization_endpoint === 'string', 'ingen authorization_endpoint')
  expect(typeof metadata.token_endpoint === 'string', 'ingen token_endpoint')
  expect(
    Array.isArray(metadata.code_challenge_methods_supported) &&
      metadata.code_challenge_methods_supported.includes('S256'),
    'autorisasjonsserveren annonserer ikke PKCE med S256, som OAuth 2.1 krever',
  )
  authorizationServer = metadata
  return `${metadata.issuer}, PKCE S256`
})

await check('dynamisk klientregistrering er på', async () => {
  if (!authorizationServer) return 'hoppet over'
  // ChatGPT registers itself as a client the moment a connector is created, and
  // can do nothing without that. The probe is an *empty* registration: a server
  // with registration on refuses it for what it lacks (400), one with it off
  // refuses it for what it is (403), and neither leaves anything behind —
  // nothing was registered either way. Whether the metadata happens to list a
  // `registration_endpoint` says nothing by itself.
  const endpoint =
    typeof authorizationServer.registration_endpoint === 'string'
      ? authorizationServer.registration_endpoint
      : `${authorizationServer.issuer.replace(/\/+$/, '')}/oauth/clients/register`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  })
  expect(
    response.status !== 403 && response.status !== 404,
    `${endpoint} svarte ${response.status}. Er Dynamic Client Registration slått på i Supabase-prosjektet?\n` +
      'ChatGPT registrerer seg selv som klient, og kan ikke koble til uten.',
  )
  expect(
    response.status >= 400 && response.status < 500,
    `en tom registrering skulle vært avvist, men fikk ${response.status}`,
  )
  return `på (en tom registrering avvises med ${response.status})`
})

await check('401-utfordringen peker på metadataen', async () => {
  const answer = await send('tools/call', { params: { name: callableTool(), arguments: {} } })
  const challenge = answer.headers.get('www-authenticate') ?? ''
  if (!resourceMetadata) {
    expect(
      !/resource_metadata/i.test(challenge),
      'utfordringen peker på et metadatadokument installasjonen ikke har',
    )
    return 'hoppet over (ingen OAuth)'
  }
  expect(
    challenge.includes(`resource_metadata="${RESOURCE_METADATA_URL}"`),
    `utfordringen peker ikke på ${RESOURCE_METADATA_URL} (fikk «${challenge}»)`,
  )
  return 'peker på dokumentet'
})

await check('verktøyene sier at de krever OAuth', async () => {
  // What a mixed-authentication client reads to know that connecting is not
  // enough. An empty list here is the shape of the bug where a connector links
  // and then cannot call anything.
  expect(catalogue.length > 0, 'ingen verktøy å se på')
  for (const tool of catalogue) {
    const schemes = tool.securitySchemes ?? tool._meta?.securitySchemes
    expect(Array.isArray(schemes) && schemes.length > 0, `${tool.name} sier ingenting om auth`)
    const oauth = schemes.find((scheme) => scheme.type === 'oauth2')
    expect(oauth !== undefined, `${tool.name} annonserer ingen oauth2-ordning`)
    expect(Array.isArray(oauth.scopes), `${tool.name} har ingen scope-liste`)
  }
  return `${catalogue.length} verktøy, alle med oauth2`
})

if (oauthToken) {
  console.log('\nMed OAuth-token')

  await check('tools/call virker med et OAuth-token', async () => {
    const answer = await send('tools/call', {
      params: { name: callableTool(), arguments: {} },
      auth: oauthToken,
    })
    const result = resultOf(answer)
    expect(result.isError !== true, `verktøyet svarte med isError: ${JSON.stringify(result.content)}`)
    expect(result.structuredContent !== undefined, 'ingen structuredContent i resultatet')
    return 'operasjonen kjørte'
  })
} else {
  console.log('\nMed OAuth-token: hoppet over (SLAIDS_OAUTH_TOKEN er ikke satt).')
}

if (token) {
  console.log('\nMed token')

  await check('tools/call virker', async () => {
    const answer = await send('tools/call', {
      params: { name: callableTool(), arguments: {} },
      auth: token,
    })
    const result = resultOf(answer)
    expect(result.isError !== true, 'verktøyet svarte med isError')
    expect(result.structuredContent !== undefined, 'ingen structuredContent i resultatet')
    return 'operasjonen kjørte'
  })

  await check('den offentlige katalogen er hele katalogen', async () => {
    // Compared against the *authenticated* REST catalogue on the same
    // deployment: if the two ever differed, `tools/list` would be answering per
    // caller instead of describing Slaids.
    const response = await fetch(OPERATIONS_URL, {
      headers: { Accept: 'application/json', ...extraHeaders, Authorization: `Bearer ${token}` },
    })
    expect(response.status === 200, `forventet 200 fra REST-katalogen, fikk ${response.status}`)
    const listing = await response.json()
    const rest = listing.data.operations.map((operation) => operation.toolName).sort()
    const mcp = catalogue.map((tool) => tool.name).sort()
    expect(
      JSON.stringify(rest) === JSON.stringify(mcp),
      `REST har ${rest.length} operasjoner, den anonyme MCP-listen har ${mcp.length}`,
    )
    return `${mcp.length} navn, identiske`
  })
} else {
  console.log('\nMed token: hoppet over (ingen --token oppgitt).')
}

/* ------------------------------------------------------------------ *
 * Verdict
 * ------------------------------------------------------------------ */

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} sjekker gikk gjennom.`)
if (failed.length > 0) {
  console.log('\nFeilet:')
  for (const entry of failed) console.log(`  - ${entry.name}: ${entry.note}`)
  process.exit(1)
}
console.log('MCP discovery er offentlig; operasjonene er ikke.\n')
