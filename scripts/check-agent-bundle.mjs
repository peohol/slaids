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
import { existsSync, readFileSync } from 'node:fs'

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

/**
 * The published contract, generated inside the bundle.
 *
 * The tool catalogue is not written down anywhere — it is built from the
 * operations' own Zod schemas, with `unrepresentable: 'throw'`, the first time a
 * client asks for it. That is the right trade (a schema that cannot be
 * expressed must not be published as an empty `{}`), but it moves the failure to
 * request time: an operation whose input cannot be turned into JSON Schema would
 * type-check, deploy green, and answer the very first `tools/list` with a 500.
 *
 * So it is generated here instead, in the same plain Node the platform runs, as
 * part of the build. `mcpTools()` calls the same `describeOperations()` the REST
 * catalogue does, so this covers both.
 */
const tools = typeof loaded.mcpTools === 'function' ? loaded.mcpTools() : null
if (!Array.isArray(tools) || tools.length === 0) {
  fail('Bundelen kunne ikke bygge MCP-verktøykatalogen. Første tools/list ville svart 500.')
}

const malformed = tools.filter((tool) => tool?.inputSchema?.type !== 'object')
if (malformed.length > 0) {
  fail(
    `Disse verktøyene har ikke et objektskjema, som MCP krever: ${malformed
      .map((tool) => tool?.name ?? '(uten navn)')
      .join(', ')}.`,
  )
}

/**
 * The preview, whose dependencies are the ones this check exists for.
 *
 * Loading the module above already proved the interesting part: the bundle
 * statically imports `react-dom/server`, `puppeteer-core` and
 * `@sparticuz/chromium`, and plain Node resolved all three. Those are the
 * imports a serverless runtime either finds in `node_modules` or fails on at
 * the first request, and nothing but loading it the way the runtime does can
 * tell the difference.
 */
if (!tools.some((tool) => tool?.name === 'slaids_render_slide_preview')) {
  fail('Bundelen mangler verktøyet for rendret preview. Fase 5 ville ikke finnes i produksjon.')
}

const source = readFileSync(bundle, 'utf8')

/**
 * The app's own stylesheet, inside the bundle.
 *
 * The preview is styled by `src/styles/*.css`, imported with `?inline` so the
 * bytes become a string in this file. When that import is not processed, it does
 * not fail — it yields an empty string, and the preview then renders every slide
 * unstyled while every test that only reads markup keeps passing. It happened
 * once in the test runner already (`css: true` in `vite.config.ts` is the fix
 * there), and in a build it would be visible only in the picture.
 *
 * The markers are declarations rather than selectors, because the production
 * build minifies this CSS and a minifier is free to merge and reorder selectors.
 * A custom property, a reset and two class names the slide renderer emits are
 * things it cannot remove without removing the styling itself.
 */
for (const marker of ['box-sizing:border-box', '--slaids-body-font-size', '.rd-citation', '.cover-pill']) {
  if (!source.includes(marker)) {
    fail(
      `Bundelen inneholder ikke «${marker}» fra Slaids' eget stilark. ` +
        'Da er CSS-en ikke bakt inn, og previewet ville rendret slides uten stiler.',
    )
  }
}

/**
 * No relative import survived.
 *
 * The load above would have caught it, but only as `ERR_MODULE_NOT_FOUND` from
 * inside Node. Saying it here says which failure it is.
 */
const relative = [...source.matchAll(/\bfrom\s*["'](\.[^"']*)["']/g)].map((match) => match[1])
if (relative.length > 0) {
  fail(`Bundelen har relative importer igjen: ${[...new Set(relative)].join(', ')}.`)
}

console.log(
  `Agent-API-bundelen lastes av Node og svarer som den skal, med ${tools.length} MCP-verktøy, ` +
    'previewrendereren og Slaids\' eget stilark i den.',
)

function fail(message) {
  console.error(`\nAgent-API-bundelen er ikke deploybar.\n${message}\n`)
  process.exit(1)
}
