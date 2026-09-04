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
import type { AgentPrincipal, AuthOutcome } from '../agent/tokens'
import {
  callFailure,
  callTool,
  closeHarnessDatabases,
  harness,
  newPresentation,
  rest,
  restRaw,
  TOKEN,
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

  it('set_theme svarer med det samme temaet begge veier, og skriver bare én gang', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Tema begge veier')

    // A theme is global, so the two transports are asked for the same change one
    // after the other and must describe the result identically. Everything but
    // the revision: these are two writes to one document, and a write that
    // lands is a new reading by definition — that is the concurrency contract,
    // not a difference between the transports.
    const both = await bothWays(harnessed, 'set_theme', {
      presentationId: deck.presentationId,
      backgroundColor: '#101828',
      headingFont: 'space-grotesk',
      spacing: 2.4,
    })
    const theme = (data: unknown): unknown => (data as { theme: unknown }).theme
    expect(theme(both.restData)).toEqual(theme(both.mcpData))
    expect(theme(both.restData)).toMatchObject({
      backgroundColor: '#101828',
      headingFont: { fontId: 'space-grotesk' },
      spacing: 2.4,
    })

    // And it is the same document underneath, not two answers that happen to
    // agree: the theme reads back on both sides of `get_presentation`.
    const read = await bothWays(harnessed, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(read.restData).toEqual(read.mcpData)
    expect((read.restData as { theme: { spacing: number } }).theme.spacing).toBe(2.4)
  })

  it('sandkassen er den samme på tvers av transportene, id for id', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Sandkasse begge veier')

    await rest(harnessed, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Parkert innhold' }] }],
    })
    // Sent to the sandbox over REST …
    const cleared = await rest(harnessed, 'clear_zone', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
    })
    const itemId = (cleared.body.data as { sandboxItemIds: string[] }).sandboxItemIds[0]

    // … found again over MCP, in the same shape REST would have reported it.
    const listedBothWays = await bothWays(harnessed, 'list_sandbox_items', {
      presentationId: deck.presentationId,
    })
    expect(listedBothWays.restData).toEqual(listedBothWays.mcpData)
    expect((listedBothWays.mcpData as { items: { itemId: string }[] }).items.map((i) => i.itemId)).toEqual([
      itemId,
    ])

    // … and placed back over MCP, landing on the same document REST reads.
    const other = await rest(harnessed, 'add_slide', { presentationId: deck.presentationId })
    const otherSlideId = (other.body.data as { slideId: string }).slideId
    const otherInspected = await rest(harnessed, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: otherSlideId,
    })
    const otherNodeId = (
      otherInspected.body.data as { zones: { nodeId: string; kind: string }[] }
    ).zones.find((zone) => zone.kind === 'leaf')?.nodeId as string

    const placed = await callTool(harnessed, tool('place_sandbox_item'), {
      presentationId: deck.presentationId,
      itemId,
      slideId: otherSlideId,
      nodeId: otherNodeId,
    })
    expect(placed.isError).toBeFalsy()

    const readBothWays = await bothWays(harnessed, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(readBothWays.restData).toEqual(readBothWays.mcpData)
    expect((readBothWays.restData as { sandboxCount: number }).sandboxCount).toBe(0)
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

  it('en temaendring som skjuler innhold gir samme kode og de samme tallene', async () => {
    // The global counterpart of the case above: a fit refusal that no zone was
    // addressed in, so the details come entirely from the guard.
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    await rest(harnessed, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Ganske mye tekst. '.repeat(70) }] }],
    })

    const both = await refusedBothWays(harnessed, 'set_theme', {
      presentationId: deck.presentationId,
      fontScale: 1.6,
    })
    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(422)
  })

  it('en ukjent font gir samme INVALID_INPUT, som protokollfeil i MCP', async () => {
    // The font enum is published in both catalogues from the same operation, so
    // a name outside it was never a valid call over either transport.
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    const both = await refusedBothWays(harnessed, 'set_theme', {
      presentationId: deck.presentationId,
      bodyFont: 'papyrus',
    })
    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('INVALID_INPUT')
    expect(both.envelope).toBe('protocol')
    expect(both.status).toBe(400)
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

describe('subfeltlayout er den samme operasjonen begge veier', () => {
  /** A deck whose only zone holds a card divided into two subfields. */
  async function twoFieldCard(harnessed: Harness): Promise<Record<string, string>> {
    const deck = await newPresentation(harnessed, 'Subfelt begge veier')
    const target = {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
    }
    await rest(harnessed, 'set_zone_card', { ...target, kind: 'untitled-card', subfieldCount: 2 })
    return target
  }

  it('svarer likt på en gyldig endring, og på begge måtene den kan avvises', async () => {
    const harnessed = harness()
    const target = await twoFieldCard(harnessed)

    // Idempotent by construction: MCP asks for the layout REST just produced,
    // so the two answers have to match down to the revision — which is what
    // makes a mutation comparable field for field at all.
    const both = await bothWays(harnessed, 'adjust_subfields', {
      ...target,
      axis: 'x',
      weights: [2, 1],
    })
    expect(both.restData).toEqual(both.mcpData)
    expect(both.mcpData).toMatchObject({ axis: 'x', weights: [2, 1] })

    // And the document underneath says the same thing to both readers.
    const read = await bothWays(harnessed, 'inspect_slide', {
      presentationId: target.presentationId,
      slideId: target.slideId,
    })
    expect(read.restData).toEqual(read.mcpData)
    const zone = (read.restData as { zones: { nodeId: string; subfieldWeights?: number[] }[] }).zones.find(
      (candidate) => candidate.nodeId === target.nodeId,
    )
    expect(zone).toMatchObject({ subfieldAxis: 'x', subfieldWeights: [2, 1] })

    // A weight the published schema itself forbids was never a valid call, so
    // MCP puts it in a JSON-RPC error.
    const negative = await refusedBothWays(harnessed, 'adjust_subfields', {
      ...target,
      weights: [1, -1],
    })
    expect(negative.rest).toEqual(negative.mcp)
    expect(negative.rest.code).toBe('INVALID_INPUT')
    expect(negative.envelope).toBe('protocol')
    expect(negative.status).toBe(400)

    // The wrong *number* of weights is a question only the document can answer,
    // so a real operation decided it: a tool result, with the same code.
    const wrongCount = await refusedBothWays(harnessed, 'adjust_subfields', {
      ...target,
      weights: [1],
    })
    expect(wrongCount.rest).toEqual(wrongCount.mcp)
    expect(wrongCount.rest.code).toBe('INVALID_WEIGHTS')
    expect(wrongCount.envelope).toBe('result')
    expect(wrongCount.status).toBe(400)
  })

  it('avviser en endring som ville skjult innhold likt, med de samme tallene', async () => {
    const harnessed = harness()
    const target = await twoFieldCard(harnessed)
    await rest(harnessed, 'adjust_subfields', { ...target, axis: 'x', weights: [3, 1] })
    await rest(harnessed, 'set_zone_text', {
      ...target,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Ganske mye tekst. '.repeat(40) }] }],
    })

    const both = await refusedBothWays(harnessed, 'adjust_subfields', {
      ...target,
      weights: [1, 3],
    })
    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(422)

    // Nothing was written by either attempt: the layout is still the one that
    // held the text.
    const after = await rest(harnessed, 'inspect_slide', {
      presentationId: target.presentationId,
      slideId: target.slideId,
    })
    const zone = (after.body.data as { zones: { nodeId: string }[] }).zones.find(
      (candidate) => candidate.nodeId === target.nodeId,
    )
    expect(zone).toMatchObject({ subfieldAxis: 'x', subfieldWeights: [3, 1] })
  })
})

describe('flytting av innhold er den samme operasjonen begge veier', () => {
  /** A slide split in two, with text in the left half. */
  async function filledPair(
    harnessed: Harness,
  ): Promise<{ presentationId: string; slideId: string; left: string; right: string }> {
    const deck = await newPresentation(harnessed, 'Flytting begge veier')
    const split = await rest(harnessed, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      axis: 'x',
      weights: [1, 1],
    })
    const [left, right] = (split.body.data as { childNodeIds: string[] }).childNodeIds
    await rest(harnessed, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: left,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Innhold som flyttes' }] }],
    })
    return { presentationId: deck.presentationId, slideId: deck.slideId, left, right }
  }

  it('flytter over REST og tilbake over MCP, med de samme id-ene begge veier', async () => {
    // A move cannot be asked for twice — the source is empty afterwards — so
    // the comparison is the move and its mirror image: what REST reports on the
    // way over has to be what MCP reports on the way back, id for id.
    const harnessed = harness()
    const deck = await filledPair(harnessed)
    const target = {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.left,
      toNodeId: deck.right,
    }

    const over = await rest(harnessed, 'move_zone_content', target)
    const overData = over.body.data as {
      toSlideId: string
      toNodeId: string
      subfieldIds: string[]
    }
    expect(over.status).toBe(200)
    expect(overData).toMatchObject({ toSlideId: deck.slideId, toNodeId: deck.right })
    const { subfieldIds } = overData

    const back = await callTool(harnessed, tool('move_zone_content'), {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.right,
      toNodeId: deck.left,
    })
    expect(back.isError).toBeFalsy()
    const backData = back.structuredContent as { toNodeId: string; subfieldIds: string[] }
    expect(backData.toNodeId).toBe(deck.left)
    // The same subfields came back: neither transport rebuilt the content.
    expect(backData.subfieldIds).toEqual(subfieldIds)

    // And it is one document underneath, read identically by both.
    const read = await bothWays(harnessed, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(read.restData).toEqual(read.mcpData)
    const zones = (read.restData as { zones: { nodeId: string; empty?: boolean }[] }).zones
    expect(zones.find((zone) => zone.nodeId === deck.left)?.empty).toBe(false)
    expect(zones.find((zone) => zone.nodeId === deck.right)?.empty).toBe(true)
  })

  /**
   * The same deployment and the same database, seen by a write-only token.
   *
   * `harness({ scopes })` would give a second database, and the claim here is
   * about a token reading a deck that exists — so only the principal changes.
   */
  function withoutReadScope(harnessed: Harness): Harness {
    const principal: AgentPrincipal = {
      tokenId: 'token-write-only',
      tokenName: 'Skrivetoken',
      ownerId: 'owner-1',
      scopes: ['presentations:write'],
    }
    return {
      ...harnessed,
      deps: {
        ...harnessed.deps,
        authenticate: (presented): Promise<AuthOutcome> =>
          Promise.resolve(
            presented === TOKEN ? { ok: true, principal } : { ok: false, reason: 'unknown' },
          ),
      },
    }
  }

  it('lar et token uten lesescope flytte, men ikke lese innholdet gjennom flyttingen', async () => {
    // `presentations:read` og `presentations:write` er uavhengige avkryssinger
    // på et token, så flyttingen må virke for et skrivetoken alene — og må ikke
    // levere ut det sonen inneholder. Å flytte innhold til den sonen det
    // allerede står i er en lovlig no-op i domenet, så et svar som beskrev
    // innholdet ville gjort denne operasjonen til et inspect_slide uten
    // lesescopet.
    const full = harness()
    const deck = await filledPair(full)
    const writeOnly = withoutReadScope(full)

    // Tokenet kan virkelig ikke lese.
    const denied = await rest(writeOnly, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(denied.status).toBe(403)
    expect(denied.body.error?.code).toBe('FORBIDDEN_SCOPE')

    // No-op-en er tillatt, og sier ingenting om hva som står der.
    const noOp = await rest(writeOnly, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.left,
      toNodeId: deck.left,
    })
    expect(noOp.status).toBe(200)
    expect(JSON.stringify(noOp.body.data)).not.toContain('Innhold som flyttes')

    // Og den ekte flyttingen svarer med id-er, ikke med innhold.
    const moved = await rest(writeOnly, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.left,
      toNodeId: deck.right,
    })
    expect(moved.status).toBe(200)
    expect(Object.keys(moved.body.data as object).sort()).toEqual([
      'fromNodeId',
      'fromSlideId',
      'presentationId',
      'revision',
      'subfieldIds',
      'toNodeId',
      'toSlideId',
    ])
    expect(JSON.stringify(moved.body.data)).not.toContain('Innhold som flyttes')
  })

  it('avviser en opptatt målsone og innhold som ikke får plass med de samme feilene', async () => {
    // Both refusals leave the document untouched, which is what makes them
    // comparable at all: the second transport is asked the same question about
    // the same state, not about what the first one left behind.
    const harnessed = harness()
    const deck = await filledPair(harnessed)
    await rest(harnessed, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.right,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Opptatt' }] }],
    })

    const occupied = await refusedBothWays(harnessed, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.left,
      toNodeId: deck.right,
    })
    expect(occupied.rest).toEqual(occupied.mcp)
    expect(occupied.rest.code).toBe('TARGET_OCCUPIED')
    expect(occupied.envelope).toBe('result')
    expect(occupied.status).toBe(409)

    // A fit refusal carries numbers, and the numbers have to match too. The
    // source is a full-height half of the slide; the target is a fifth of the
    // other half, so the same text cannot possibly follow it there.
    const filled = await rest(harnessed, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.left,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Ganske mye tekst. '.repeat(50) }] }],
    })
    expect(filled.status).toBe(200)
    const rows = await rest(harnessed, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.right,
      axis: 'y',
      weights: [1, 1, 1, 1, 1],
      // The one line already sitting there goes to the bottom row, leaving the
      // top one empty — an occupied target would refuse before the fit gate.
      contentTargetIndex: 4,
    })
    expect(rows.status).toBe(200)
    const [empty] = (rows.body.data as { childNodeIds: string[] }).childNodeIds

    const tooBig = await refusedBothWays(harnessed, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.left,
      toNodeId: empty,
    })
    expect(tooBig.rest).toEqual(tooBig.mcp)
    expect(tooBig.rest.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(tooBig.rest.details).toMatchObject({ slideId: deck.slideId, nodeId: empty })
    expect(tooBig.envelope).toBe('result')
    expect(tooBig.status).toBe(422)
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
