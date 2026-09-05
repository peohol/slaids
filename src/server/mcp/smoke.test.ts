// @vitest-environment node
/**
 * The smoke test, smoke-tested.
 *
 * `scripts/mcp-smoke.mjs` is what says whether a *deployment* is right, and it
 * is the only check that runs outside this process — so a bug in it would turn
 * into a green external run that proved nothing, or a red one that sent somebody
 * looking for a fault in Vercel. Here it is pointed at a real socket in front of
 * the real handler, where the answer is already known.
 *
 * It also keeps the script honest as the endpoint changes: the script names no
 * operation and hard-codes no count, so the one thing that could rot is its
 * reading of the *contract* — and that is exactly what this runs.
 */

import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { operations } from '../../agent/registry'
import { TOKEN, closeHarnessDatabases, harness, type Harness } from './testHarness'
import { listenHarness, type ServedHarness } from './testServer'

const run = promisify(execFile)

let deployment: Harness
let served: ServedHarness
let baseUrl: string

beforeAll(async () => {
  deployment = harness()
  served = await listenHarness(deployment)
  baseUrl = served.address.origin
})

afterAll(async () => {
  await served.close()
  await closeHarnessDatabases()
})

/** The script, run the way a person or a CI job runs it. */
async function smoke(args: string[], against = baseUrl): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run('node', ['scripts/mcp-smoke.mjs', '--base-url', against, ...args], {
      cwd: process.cwd(),
    })
    return { code: 0, out: stdout }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

/** An address that answers the same thing to everything, on a real socket. */
async function servingOnly(
  status: number,
  body: string,
  contentType = 'application/json',
  extraHeaders: Record<string, string> = {},
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((_incoming, outgoing) => {
    outgoing.writeHead(status, { 'Content-Type': contentType, ...extraHeaders })
    outgoing.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('scripts/mcp-smoke.mjs', () => {
  it('går grønt mot en riktig installasjon, med token', async () => {
    const { code, out } = await smoke([
      '--token',
      TOKEN,
      '--expect-tools',
      String(operations.length),
    ])

    expect(out).toContain('MCP discovery er offentlig')
    expect(out).toContain(`${operations.length} verktøy`)
    expect(out).not.toContain('FEIL')
    expect(code).toBe(0)
  }, 30_000)

  it('går grønt uten token også, som en verktøyskanning ville gjort', async () => {
    const { code, out } = await smoke([])

    expect(out).toContain('hoppet over')
    expect(out).not.toContain('FEIL')
    expect(code).toBe(0)
  }, 30_000)

  it('lekker ikke tokenet til utskriften', async () => {
    const { out } = await smoke(['--token', TOKEN])
    expect(out).not.toContain(TOKEN)
  }, 30_000)

  it('nekter å sette Authorization gjennom --header', async () => {
    // Otherwise every check that says «uten token» would be a lie, and the one
    // thing this script exists to establish would be the thing it faked.
    const { code, out } = await smoke(['--header', 'Authorization: Bearer noe'])

    expect(out).toContain('Bruk --token')
    expect(code).toBe(2)
  }, 30_000)

  it('sender med en header for laget foran installasjonen', async () => {
    // What a bypass cookie for a protected preview looks like from here: an
    // extra header on every request, and nothing else about the round changes.
    const { code, out } = await smoke(['--header', 'Cookie: _vercel_jwt=lat-som-om'])

    expect(out).not.toContain('FEIL')
    expect(code).toBe(0)
  }, 30_000)

  it('sier fra én gang når installasjonen ikke har noen Supabase', async () => {
    // A Vercel preview is built without the server variables unless somebody
    // turns them on for Preview, so `503` on everything is the ordinary answer
    // there — and ten repetitions of it would read like ten faults in the
    // endpoint instead of one fact about the deployment.
    const stub = await servingOnly(
      503,
      JSON.stringify({
        ok: false,
        error: { code: 'SERVER_NOT_CONFIGURED', message: 'Mangler SLAIDS_SUPABASE_URL.' },
      }),
    )
    try {
      const { code, out } = await smoke([], stub.origin)
      expect(out).toContain('ingen Supabase')
      expect(out).not.toContain('FEIL')
      expect(code).toBe(2)
    } finally {
      await stub.close()
    }
  }, 30_000)

  it('stopper på en redirect som ville tatt tokenet med seg', async () => {
    // The failure this script exists to catch and could not see: `fetch` follows
    // a cross-origin redirect and drops `Authorization` doing it, so every later
    // check would silently measure an anonymous request. Production answered
    // exactly this — the apex domain `308`s to `www` — and the round read as a
    // fault in the endpoint until the redirect was looked at.
    const stub = await servingOnly(308, '', 'text/plain', {
      Location: 'https://www.example.invalid/api/agent/v1/mcp',
    })
    try {
      const { code, out } = await smoke([], stub.origin)
      expect(out).toContain('Authorization')
      expect(out).toContain('www.example.invalid')
      expect(out).not.toContain('FEIL')
      expect(code).toBe(2)
    } finally {
      await stub.close()
    }
  }, 30_000)

  it('bryr seg ikke om en redirect som blir på samme origin', async () => {
    // Same origin keeps the header, so it is not this script's business.
    const { code } = await smoke(['--expect-tools', String(operations.length)])
    expect(code).toBe(0)
  }, 30_000)

  it('sier fra når det ikke er Slaids som svarer i det hele tatt', async () => {
    // An authentication wall in front of the deployment, or the wrong address.
    const stub = await servingOnly(401, '<html>Authentication Required</html>', 'text/html')
    try {
      const { code, out } = await smoke([], stub.origin)
      expect(out).toContain('ikke er JSON')
      expect(code).toBe(2)
    } finally {
      await stub.close()
    }
  }, 30_000)

  it('feiler når katalogen ikke er den lengden den skal være', async () => {
    // The guard on the guard: a script that passed no matter what it was told
    // would be a script that passes against an empty tool list too.
    const { code, out } = await smoke(['--expect-tools', String(operations.length + 1)])

    expect(out).toContain('FEIL')
    expect(code).toBe(1)
  }, 30_000)
})
