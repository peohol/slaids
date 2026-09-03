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
 * answers a tool result, or — when the call was never a valid one — a JSON-RPC
 * error. Those are the two protocols' own shapes, and flattening them into one
 * would be inventing a third.
 *
 * What has to match is everything inside, and *which* MCP envelope a refusal
 * lands in is itself part of the contract, so it is asserted rather than
 * accepted either way: `UNKNOWN_OPERATION` and `INVALID_INPUT` are protocol
 * errors, everything a real operation decided is a tool result.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { agentImage } from '../../agent/image'
import type { SlidePreviewRenderer } from '../../agent/preview'
import { AGENT_TOOL_PREFIX, operations } from '../../agent/registry'
import { realImages } from '../../domain/testImages'
import {
  callFailure,
  callTool,
  closeHarnessDatabases,
  harness,
  newPresentation,
  rest,
  restRaw,
  type Harness,
  type McpToolError,
} from './testHarness'
import { resultImages, resultText } from './result'

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

/**
 * A refusal both ways, with MCP's envelope reported rather than hidden.
 *
 * REST has one shape for every failure; MCP has two, and which one a code lands
 * in is part of the contract. Reporting it here is what lets a test say "the
 * payload is identical *and* it arrived in the envelope it belongs in" instead
 * of quietly accepting either.
 */
async function refusedBothWays(
  harnessed: Harness,
  operation: string,
  input: Record<string, unknown>,
): Promise<{ rest: McpToolError; mcp: McpToolError; envelope: 'result' | 'protocol'; status: number }> {
  const overRest = await rest(harnessed, operation, input)
  const overMcp = await callFailure(harnessed, tool(operation), input)
  if (!overRest.body.error) throw new Error(`Forventet at REST avviste «${operation}».`)
  return {
    rest: overRest.body.error,
    mcp: overMcp.error,
    envelope: overMcp.envelope,
    status: overRest.status,
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

describe('et rendret preview peker på den samme funksjonen begge veier', () => {
  const bytes = realImages.png()

  /** One renderer, counting: the count is how "the same function" is asserted. */
  function countingRenderer(): { renderer: SlidePreviewRenderer; calls: () => number } {
    let calls = 0
    return {
      calls: () => calls,
      renderer: () => {
        calls += 1
        return Promise.resolve({
          ok: true,
          value: {
            image: agentImage({ mimeType: 'image/png', bytes, width: 1600, height: 900 }),
            fontsReady: true,
            warnings: [],
          },
        })
      },
    }
  }

  const renderer: SlidePreviewRenderer = countingRenderer().renderer

  it('svarer med det samme strukturerte resultatet og de samme bytene', async () => {
    const counting = countingRenderer()
    const harnessed = harness({ preview: counting.renderer })
    const deck = await newPresentation(harnessed, 'Preview begge veier')
    const input = { presentationId: deck.presentationId, slideId: deck.slideId }

    // REST's default framing for a picture is the picture; the envelope is one
    // `Accept` away, and it is the envelope that is comparable with MCP's
    // structured half.
    const binary = new Uint8Array(
      await (await restRaw(harnessed, 'render_slide_preview', input)).arrayBuffer(),
    )
    const envelope = await rest(harnessed, 'render_slide_preview', input)
    const overMcp = await callTool(harnessed, tool('render_slide_preview'), input)

    // The structured half is identical apart from the one field REST fills in
    // for a caller that asked for one body: the base64 of the same bytes.
    const restData = envelope.body.data as { image: Record<string, unknown> }
    const mcpData = overMcp.structuredContent as { image: Record<string, unknown> }
    const { base64, ...restImage } = restData.image as { base64: string }
    expect({ ...restData, image: restImage }).toEqual(mcpData)

    // And all three carry the same picture.
    const fromMcp = Buffer.from(resultImages(overMcp)[0]?.data ?? '', 'base64')
    expect(binary).toEqual(bytes)
    expect(new Uint8Array(Buffer.from(base64, 'base64'))).toEqual(bytes)
    expect(new Uint8Array(fromMcp)).toEqual(bytes)

    // MCP puts it in the block a client hands a model; the text block is the
    // structured half, exactly as for every other operation.
    expect(resultImages(overMcp)).toHaveLength(1)
    expect(resultImages(overMcp)[0].mimeType).toBe('image/png')
    expect(JSON.parse(resultText(overMcp))).toEqual(mcpData)

    // Three calls, one renderer: neither transport has a preview path of its
    // own, and neither of them drew the picture itself. That — rather than the
    // answers happening to match — is what "the same underlying function" means.
    expect(counting.calls()).toBe(3)
  })

  it('avviser en ukjent side likt, som verktøyresultat i MCP', async () => {
    const harnessed = harness({ preview: renderer })
    const deck = await newPresentation(harnessed)
    const both = await refusedBothWays(harnessed, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: 's_ikke_her',
    })

    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('SLIDE_NOT_FOUND')
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(404)
  })

  it('sier PREVIEW_UNAVAILABLE likt når installasjonen ikke kan rendre', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    const both = await refusedBothWays(harnessed, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })

    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('PREVIEW_UNAVAILABLE')
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(501)
  })
})

describe('feilene er de samme feilene', () => {
  it('ugyldig input gir samme kode og samme issues, som protokollfeil i MCP', async () => {
    // Arguments that do not match the tool's published schema were never a
    // valid call to it, so MCP puts them in a JSON-RPC error — with the same
    // payload REST returns in its body.
    const harnessed = harness()
    const both = await refusedBothWays(harnessed, 'create_presentation', { title: '' })

    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('INVALID_INPUT')
    expect(both.envelope).toBe('protocol')
    expect(both.status).toBe(400)
  })

  it('en id som ikke finnes gir samme kode, som verktøyresultat i MCP', async () => {
    // A real operation ran and said no, so this is an answer an agent acts on.
    const harnessed = harness()
    const both = await refusedBothWays(harnessed, 'get_presentation', { presentationId: 'p_nei' })

    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('PRESENTATION_NOT_FOUND')
    expect(both.envelope).toBe('result')
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

  it('et manglende scope gir samme kode og de samme manglene, som verktøyresultat', async () => {
    // A decision about a tool that exists, with arguments that were fine: an
    // answer, not a malformed call.
    const readOnly = harness({ scopes: ['presentations:read'] })
    const both = await refusedBothWays(readOnly, 'create_presentation', { title: 'Dekk' })

    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('FORBIDDEN_SCOPE')
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(403)
  })

  it('et ukjent navn gir samme kode og den samme listen, som protokollfeil i MCP', async () => {
    const harnessed = harness()
    const both = await refusedBothWays(harnessed, 'finnes_ikke', {})

    expect(both.rest).toEqual(both.mcp)
    expect(both.mcp.code).toBe('UNKNOWN_OPERATION')
    expect(both.envelope).toBe('protocol')
    expect((both.mcp.details as { available: string[] }).available).toEqual(
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

      if (!overRest.body.error) {
        const succeeded = await callTool(harnessed, tool(operation.name), {})
        expect(succeeded.structuredContent, operation.name).toEqual(overRest.body.data)
        continue
      }

      const refused = await callFailure(harnessed, tool(operation.name), {})
      expect(refused.error, operation.name).toEqual(overRest.body.error)
      expect(overRest.body.error.code, operation.name).not.toBe('UNKNOWN_OPERATION')
      // And the envelope is decided by the code, not by the operation.
      expect(refused.envelope, operation.name).toBe(
        overRest.body.error.code === 'INVALID_INPUT' ? 'protocol' : 'result',
      )
    }
  })
})
