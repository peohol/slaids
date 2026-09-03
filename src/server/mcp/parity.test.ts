// @vitest-environment node
/**
 * The same operation, over both transports, against the same database.
 *
 * §44 asks that it be possible to compare an operation over REST and over MCP
 * and get semantically the same result. That is easy to promise and easy to
 * lose: the moment either adapter grows a rule of its own — a default it fills
 * in, a name it accepts, an error it rewrites — the two contracts start to
 * drift, and they drift silently, because each of them has its own passing
 * tests.
 *
 * So this file does the comparison itself. One harness, one Dexie database, one
 * token: the presentation REST created is the presentation MCP reads, and the
 * two answers are compared field for field rather than shape for shape. The
 * error cases matter more than the successes — an agent branches on the code,
 * and a code that differs by transport is a code it cannot branch on.
 *
 * What is deliberately *not* asserted is that the two envelopes are identical.
 * REST answers `{ ok, operation, revision, data }` with an HTTP status; MCP
 * answers a tool result with `isError` and `structuredContent`. Those are the
 * two protocols' own shapes, and flattening them into one would be inventing a
 * third. What has to match is everything inside.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_TOOL_PREFIX, operations } from '../../agent/registry'
import {
  callTool,
  closeHarnessDatabases,
  harness,
  newPresentation,
  rest,
  type Harness,
  type McpToolError,
} from './testHarness'

afterEach(closeHarnessDatabases)

const tool = (name: string): string => `${AGENT_TOOL_PREFIX}${name}`

/** Both transports asked the same thing, unwrapped to what each of them said. */
async function bothWays(
  harnessed: Harness,
  operation: string,
  input: Record<string, unknown>,
): Promise<{
  restData: unknown
  mcpData: unknown
  restError: McpToolError | undefined
  mcpError: McpToolError | undefined
  status: number
  isError: boolean | undefined
}> {
  const overRest = await rest(harnessed, operation, input)
  const overMcp = await callTool(harnessed, tool(operation), input)
  return {
    restData: overRest.body.data,
    mcpData: overMcp.structuredContent,
    restError: overRest.body.error,
    mcpError: (overMcp.structuredContent as { error?: McpToolError } | undefined)?.error,
    status: overRest.status,
    isError: overMcp.isError,
  }
}

describe('lesing gir det samme over begge transportene', () => {
  it('get_presentation svarer med nøyaktig det samme objektet', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Felles dekk')

    const both = await bothWays(harnessed, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(both.restData).toEqual(both.mcpData)
    expect((both.restData as { title: string }).title).toBe('Felles dekk')
  })

  it('inspect_slide svarer med de samme id-ene og den samme geometrien', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)

    const both = await bothWays(harnessed, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(both.restData).toEqual(both.mcpData)
    expect((both.mcpData as { zones: unknown[] }).zones.length).toBeGreaterThan(0)
  })

  it('validate_presentation gir den samme dommen', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)

    const both = await bothWays(harnessed, 'validate_presentation', {
      presentationId: deck.presentationId,
    })
    expect(both.restData).toEqual(both.mcpData)
    expect((both.mcpData as { valid: boolean }).valid).toBe(true)
  })

  it('lar en revisjon lest over den ene transporten skrive over den andre', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)

    // Read over REST, write over MCP, against that reading.
    const read = await rest(harnessed, 'get_presentation', { presentationId: deck.presentationId })
    const written = await callTool(harnessed, tool('set_slide_title'), {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: read.body.revision,
      spans: [{ text: 'På tvers' }],
    })
    expect(written.isError).toBeUndefined()

    // And the same reading is now stale for REST too — one document, one lock.
    const stale = await rest(harnessed, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: read.body.revision,
      spans: [{ text: 'For sent' }],
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error?.code).toBe('CONFLICT')
  })
})

describe('feilene er de samme feilene', () => {
  it('ugyldig input gir samme kode og samme issues', async () => {
    const harnessed = harness()
    const both = await bothWays(harnessed, 'create_presentation', { title: '' })

    expect(both.restError).toEqual(both.mcpError)
    expect(both.restError?.code).toBe('INVALID_INPUT')
    expect(both.status).toBe(400)
    expect(both.isError).toBe(true)
  })

  it('en id som ikke finnes gir samme kode', async () => {
    const harnessed = harness()
    const both = await bothWays(harnessed, 'get_presentation', { presentationId: 'p_nei' })

    expect(both.restError).toEqual(both.mcpError)
    expect(both.restError?.code).toBe('PRESENTATION_NOT_FOUND')
    expect(both.status).toBe(404)
  })

  it('en stale revisjon gir CONFLICT begge veier', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    await rest(harnessed, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: deck.revision,
      spans: [{ text: 'Først' }],
    })

    const both = await bothWays(harnessed, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: deck.revision,
      spans: [{ text: 'Etterpå' }],
    })
    expect(both.restError?.code).toBe('CONFLICT')
    expect(both.mcpError?.code).toBe('CONFLICT')
    expect(both.status).toBe(409)
  })

  it('innhold som ikke får plass gir samme kode og de samme tallene', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    const tooMuch = {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Altfor mye tekst. '.repeat(400) }] }],
    }

    const both = await bothWays(harnessed, 'set_zone_text', tooMuch)
    expect(both.restError).toEqual(both.mcpError)
    expect(both.restError?.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(both.status).toBe(422)
  })

  it('et manglende scope gir samme kode og de samme manglene', async () => {
    const readOnly = harness({ scopes: ['presentations:read'] })
    const both = await bothWays(readOnly, 'create_presentation', { title: 'Dekk' })

    expect(both.restError).toEqual(both.mcpError)
    expect(both.restError?.code).toBe('FORBIDDEN_SCOPE')
    expect(both.status).toBe(403)
  })

  it('et ukjent navn gir samme kode og den samme listen over navn som finnes', async () => {
    const harnessed = harness()
    const overRest = await rest(harnessed, 'finnes_ikke', {})
    const overMcp = await callTool(harnessed, tool('finnes_ikke'), {})

    const mcpError = (overMcp.structuredContent as { error: McpToolError }).error
    expect(overRest.body.error).toEqual(mcpError)
    expect(mcpError.code).toBe('UNKNOWN_OPERATION')
    expect((mcpError.details as { available: string[] }).available).toEqual(
      operations.map((operation) => operation.name),
    )
  })
})

describe('hele flaten er nåbar begge veier', () => {
  it('svarer på hver eneste operasjon over MCP, med den samme feilen REST gir', async () => {
    // Called with no arguments at all, which almost every operation refuses.
    // The point is not the refusal — it is that *every* operation is reachable
    // over MCP, and that whatever it answers, it answers identically over both.
    // An operation missing from the tool list would fail here as
    // `UNKNOWN_OPERATION` on one side and something else on the other.
    const harnessed = harness()
    for (const operation of operations) {
      const overRest = await rest(harnessed, operation.name, {})
      const overMcp = await callTool(harnessed, tool(operation.name), {})
      const mcpBody = overMcp.isError
        ? (overMcp.structuredContent as { error: McpToolError }).error
        : overMcp.structuredContent

      expect(overRest.body.error ?? overRest.body.data, operation.name).toEqual(mcpBody)
      expect(overRest.body.error?.code, operation.name).not.toBe('UNKNOWN_OPERATION')
    }
  })
})
