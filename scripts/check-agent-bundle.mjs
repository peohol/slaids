/**
 * Prove the agent API bundle actually loads, in plain Node, before it ships.
 *
 * This exists because of a failure that no local check caught. The serverless
 * platform compiles each `.ts` file on its own and lets Node resolve the
 * imports between them; TypeScript emits specifiers verbatim, and Node's ESM
 * resolver has no extension guessing and no directory/index lookup. So a build
 * that type-checked, linted, unit-tested and deployed green answered every
 * request with `ERR_UNSUPPORTED_DIR_IMPORT` at the first invocation.
 *
 * The check is therefore the one thing that would have caught it: import the
 * built file the way the runtime will, and call it. If a relative import
 * survived bundling, or an export went missing, this fails the build here
 * instead of in production.
 *
 * It runs against an empty environment on purpose. `503 SERVER_NOT_CONFIGURED`
 * is the correct answer for a deployment without Supabase credentials, and it
 * is reached only after the module has loaded, the router has run and the
 * response has been serialised — which is exactly the path that was broken.
 */

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const bundle = resolve(process.cwd(), 'src/server/generated/agentApi.js')

if (!existsSync(bundle)) {
  fail(`Fant ikke ${bundle}. Kjør \`npm run build:agent-api\` – bundelen er det som deployes.`)
}

const loaded = await import(pathToFileURL(bundle).href).catch((error) => {
  // The failure this file exists for. A relative import that survived the
  // bundle looks exactly like this, and it looks like nothing at all locally.
  fail(`Bundelen kunne ikke lastes av Node:\n${error?.stack ?? error}`)
})

if (typeof loaded.serveAgentApi !== 'function') {
  fail('Bundelen eksporterer ingen serveAgentApi. Vercel-inngangen ville krasjet ved første kall.')
}

const response = await loaded
  .serveAgentApi(new Request('https://slaids.test/api/agent/v1/operations'), {})
  .catch((error) => fail(`serveAgentApi kastet:\n${error?.stack ?? error}`))

if (response.status !== 503) {
  fail(`Forventet 503 fra et miljø uten Supabase, fikk ${response.status}.`)
}

const body = await response.json()
if (body?.error?.code !== 'SERVER_NOT_CONFIGURED') {
  fail(`Forventet SERVER_NOT_CONFIGURED, fikk ${JSON.stringify(body)}.`)
}

console.log('Agent-API-bundelen lastes av Node og svarer som den skal.')

function fail(message) {
  console.error(`\nAgent-API-bundelen er ikke deploybar.\n${message}\n`)
  process.exit(1)
}
