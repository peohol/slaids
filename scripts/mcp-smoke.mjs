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
 *   node scripts/mcp-smoke.mjs --base-url https://slaids.no
 *   SLAIDS_TOKEN=slaids_at_… node scripts/mcp-smoke.mjs --base-url https://slaids.no
 *   node scripts/mcp-smoke.mjs --base-url https://… --header 'Cookie: _vercel_jwt=…'
 *
 * The token is read from `SLAIDS_TOKEN` or from `--token`, and the environment is
 * the better of the two: a process's argument list is readable by other processes
 * on the same machine, and by a CI runner's own logging. In CI it belongs in the
 * secret store — never in a `workflow_dispatch` input, which the platform records
 * and displays with the run.
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

await check('tools/call avvises med 401', async () => {
  const answer = await send('tools/call', { params: { name: callableTool(), arguments: {} } })
  expect(answer.status === 401, `forventet 401, fikk ${answer.status}`)
  const challenge = answer.headers.get('www-authenticate') ?? ''
  expect(/bearer/i.test(challenge), `mangler WWW-Authenticate: Bearer (fikk «${challenge}»)`)
  expect(answer.body?.error?.code === 'UNAUTHENTICATED', `forventet UNAUTHENTICATED, fikk ${answer.body?.error?.code}`)
  return '401 med utfordring'
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
