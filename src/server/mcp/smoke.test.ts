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
async function smoke(args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run('node', ['scripts/mcp-smoke.mjs', '--base-url', baseUrl, ...args], {
      cwd: process.cwd(),
    })
    return { code: 0, out: stdout }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
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

  it('feiler når katalogen ikke er den lengden den skal være', async () => {
    // The guard on the guard: a script that passed no matter what it was told
    // would be a script that passes against an empty tool list too.
    const { code, out } = await smoke(['--expect-tools', String(operations.length + 1)])

    expect(out).toContain('FEIL')
    expect(code).toBe(1)
  }, 30_000)
})
