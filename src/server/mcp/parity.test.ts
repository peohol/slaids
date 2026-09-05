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
import type { AgentScope } from '../../agent/types'
import { newFolderId } from '../../domain/ids'
import { realImageBase64, realImages } from '../../domain/testImages'
import type { Folder } from '../../domain/types'
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
      headingFont: 'space-grotesk',
      spacing: 2.4,
    })
    const theme = (data: unknown): unknown => (data as { theme: unknown }).theme
    expect(theme(both.restData)).toEqual(theme(both.mcpData))
    expect(theme(both.restData)).toMatchObject({
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

  it('en fil teksten viser, men som ikke finnes, gir samme ASSET_NOT_FOUND', async () => {
    // A picture in the text is part of the same block format, so its refusal
    // has to behave like every other one: a real tool ran and said no, which
    // is a *result* in MCP and a 404 over REST, with the same payload in both.
    const harnessed = harness()
    const deck = await newPresentation(harnessed)

    const both = await refusedBothWays(harnessed, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [{ type: 'image', assetId: 'as_finnes_ikke' }],
    })
    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('ASSET_NOT_FOUND')
    expect(both.rest.details?.assetIds).toEqual(['as_finnes_ikke'])
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(404)
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

/** A slide split in two, with text in the left half. */
async function filledPair(
  harnessed: Harness,
): Promise<{ presentationId: string; slideId: string; left: string; right: string }> {
  const deck = await newPresentation(harnessed, 'Innhold begge veier')
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

/**
 * The longest paragraph this zone accepts, left in place.
 *
 * Bisected through the operation rather than written as a literal length.
 * How much text fits depends on the theme's defaults, so a hardcoded string
 * is a test that goes red the day somebody changes the default air — which
 * is exactly what happened when the spacing ladder moved up a step.
 */
async function fillToCapacity(
  harnessed: Harness,
  /** A zone, or one field inside the card a zone holds. */
  target: { presentationId: string; slideId: string; nodeId: string; subfieldId?: string },
): Promise<void> {
  const accepts = async (length: number): Promise<boolean> =>
    (
      await rest(harnessed, 'set_zone_text', {
        ...target,
        blocks: [{ type: 'paragraph', spans: [{ text: 'x'.repeat(length) }] }],
      })
    ).status === 200

  let low = 1
  let high = 20000
  if (!(await accepts(low))) throw new Error('Sonen tar ikke imot noe tekst i det hele tatt.')
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (await accepts(middle)) low = middle
    else high = middle
  }
  // End on the accepted state: the zone is now exactly full.
  await accepts(low)
}

/**
 * The same deployment and the same database, seen by a write-only token.
 *
 * `harness({ scopes })` would give a second database, and the claim here is
 * about a token reading a deck that exists — so only the principal changes.
 */
function withScopes(harnessed: Harness, scopes: AgentScope[]): Harness {
  const principal: AgentPrincipal = {
    tokenId: `token-${scopes.join('+')}`,
    tokenName: 'Smalt token',
    ownerId: 'owner-1',
    scopes,
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

function withoutReadScope(harnessed: Harness): Harness {
  return withScopes(harnessed, ['presentations:write'])
}

describe('flytting av innhold er den samme operasjonen begge veier', () => {
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
    // source is filled to the brim at full height; the target is half that
    // height, so the same text cannot possibly follow it there — a relation
    // that holds whatever the theme's defaults happen to be.
    await fillToCapacity(harnessed, {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.left,
    })
    const rows = await rest(harnessed, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.right,
      axis: 'y',
      weights: [1, 1],
      // The one line already sitting there goes to the bottom row, leaving the
      // top one empty — an occupied target would refuse before the fit gate.
      contentTargetIndex: 1,
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

describe('kopiering av innhold er den samme operasjonen begge veier', () => {
  /** A slide split in three, with a two-field card in the first zone. */
  async function cardAndTwoEmptyZones(harnessed: Harness): Promise<{
    presentationId: string
    slideId: string
    source: string
    first: string
    second: string
    subfieldIds: string[]
  }> {
    const deck = await newPresentation(harnessed, 'Kopiering begge veier')
    const split = await rest(harnessed, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      axis: 'x',
      weights: [1, 1, 1],
    })
    const [source, first, second] = (split.body.data as { childNodeIds: string[] }).childNodeIds
    const card = await rest(harnessed, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: source,
      kind: 'titled-card',
      title: [{ text: 'Korttittel' }],
      subfieldCount: 2,
    })
    const { subfieldIds } = card.body.data as { subfieldIds: string[] }
    await rest(harnessed, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: source,
      subfieldId: subfieldIds[0],
      blocks: [{ type: 'paragraph', spans: [{ text: 'Innhold som kopieres' }] }],
    })
    return {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      source,
      first,
      second,
      subfieldIds,
    }
  }

  it('kopierer over begge transportene, med nye id-er hver gang og kilden i behold', async () => {
    // A copy *can* be asked for twice — the source survives it — so this is the
    // same call over both transports against the same deck. What has to match is
    // the shape and the promise: two independent copies, each with ids of its
    // own, and an original neither of them touched.
    const harnessed = harness()
    const deck = await cardAndTwoEmptyZones(harnessed)
    const target = (nodeId: string): Record<string, unknown> => ({
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.source,
      toNodeId: nodeId,
    })

    const overRest = await rest(harnessed, 'copy_zone_content', target(deck.first))
    expect(overRest.status).toBe(200)
    const restData = overRest.body.data as { toNodeId: string; subfieldIds: string[] }

    const overMcp = await callTool(harnessed, tool('copy_zone_content'), target(deck.second))
    expect(overMcp.isError).toBeFalsy()
    const mcpData = overMcp.structuredContent as { toNodeId: string; subfieldIds: string[] }

    // The same receipt, field for field, apart from the zone each was aimed at.
    expect(Object.keys(restData).sort()).toEqual(Object.keys(mcpData).sort())
    expect(restData).toMatchObject({ toSlideId: deck.slideId, toNodeId: deck.first })
    expect(mcpData).toMatchObject({ toSlideId: deck.slideId, toNodeId: deck.second })

    // Neither transport handed back the source's ids, and the two copies do not
    // share ids with each other: three cards, three sets of subfields.
    const sets = [deck.subfieldIds, restData.subfieldIds, mcpData.subfieldIds]
    for (const ids of sets) expect(ids).toHaveLength(2)
    expect(new Set(sets.flat()).size).toBe(6)

    // And it is one document underneath, read identically by both.
    const read = await bothWays(harnessed, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(read.restData).toEqual(read.mcpData)
    const zones = (
      read.restData as {
        zones: { nodeId: string; empty?: boolean; subfields?: { subfieldId: string }[] }[]
      }
    ).zones
    for (const [nodeId, ids] of [
      [deck.source, deck.subfieldIds],
      [deck.first, restData.subfieldIds],
      [deck.second, mcpData.subfieldIds],
    ] as [string, string[]][]) {
      const zone = zones.find((entry) => entry.nodeId === nodeId)
      expect(zone?.empty).toBe(false)
      expect(zone?.subfields?.map((field) => field.subfieldId)).toEqual(ids)
    }
  })

  it('lar et token uten lesescope kopiere, men ikke lese innholdet gjennom kopien', async () => {
    // The same scope boundary as a move, and it bites harder here: a copy hands
    // back ids the caller has never seen, so the receipt is the one place it
    // could leak what the zone holds. It must not — `presentations:read` and
    // `presentations:write` are independent ticks on a token.
    const full = harness()
    const deck = await cardAndTwoEmptyZones(full)
    const writeOnly = withoutReadScope(full)

    const denied = await rest(writeOnly, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(denied.status).toBe(403)
    expect(denied.body.error?.code).toBe('FORBIDDEN_SCOPE')

    const copied = await rest(writeOnly, 'copy_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.source,
      toNodeId: deck.first,
    })
    expect(copied.status).toBe(200)
    expect(Object.keys(copied.body.data as object).sort()).toEqual([
      'fromNodeId',
      'fromSlideId',
      'presentationId',
      'revision',
      'subfieldIds',
      'toNodeId',
      'toSlideId',
    ])
    const serialised = JSON.stringify(copied.body.data)
    expect(serialised).not.toContain('Innhold som kopieres')
    expect(serialised).not.toContain('Korttittel')
    // Nor the ids of what the source is made of: only the copy's own.
    for (const id of deck.subfieldIds) expect(serialised).not.toContain(id)

    // The copy really happened, which is what makes the silence meaningful.
    const zones = (
      (
        await rest(full, 'inspect_slide', {
          presentationId: deck.presentationId,
          slideId: deck.slideId,
        })
      ).body.data as { zones: { nodeId: string; empty?: boolean }[] }
    ).zones
    expect(zones.find((zone) => zone.nodeId === deck.first)?.empty).toBe(false)
  })

  it('avviser en opptatt målsone og en kopi som ikke får plass med de samme feilene', async () => {
    const harnessed = harness()
    const deck = await cardAndTwoEmptyZones(harnessed)

    // The source zone is itself an occupied target. A *move* onto it is a legal
    // no-op; a copy is refused, identically over both transports.
    const ontoItself = await refusedBothWays(harnessed, 'copy_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.source,
      toNodeId: deck.source,
    })
    expect(ontoItself.rest).toEqual(ontoItself.mcp)
    expect(ontoItself.rest.code).toBe('TARGET_OCCUPIED')
    expect(ontoItself.envelope).toBe('result')
    expect(ontoItself.status).toBe(409)

    // A fit refusal carries numbers, and the numbers have to match too. The
    // source is filled to the brim at full height; the target is half that
    // height, so the same card cannot possibly fit there — a relation that
    // holds whatever the theme's defaults happen to be.
    await rest(harnessed, 'adjust_subfields', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.source,
      subfieldCount: 1,
    })
    const single = (
      (
        await rest(harnessed, 'inspect_slide', {
          presentationId: deck.presentationId,
          slideId: deck.slideId,
        })
      ).body.data as { zones: { nodeId: string; subfields?: { subfieldId: string }[] }[] }
    ).zones.find((zone) => zone.nodeId === deck.source)
    await fillToCapacity(harnessed, {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.source,
      subfieldId: single?.subfields?.[0].subfieldId,
    })
    const rows = await rest(harnessed, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.first,
      axis: 'y',
      weights: [1, 1],
    })
    expect(rows.status).toBe(200)
    const [half] = (rows.body.data as { childNodeIds: string[] }).childNodeIds

    const tooBig = await refusedBothWays(harnessed, 'copy_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: deck.slideId,
      fromNodeId: deck.source,
      toNodeId: half,
    })
    expect(tooBig.rest).toEqual(tooBig.mcp)
    expect(tooBig.rest.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(tooBig.rest.details).toMatchObject({ slideId: deck.slideId, nodeId: half })
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

describe('opprydding er de samme operasjonene begge veier', () => {
  const SQUARE = '<svg viewBox="0 0 120 60"><rect width="120" height="60" fill="#0af"/></svg>'

  /** One stored, unplaced file, made the way an agent makes one. */
  async function file(harnessed: Harness, presentationId: string, name: string): Promise<string> {
    const created = await rest(harnessed, 'create_svg_asset', { presentationId, name, svgMarkup: SQUARE })
    if (created.status !== 200) throw new Error(`Kunne ikke lage filen: ${created.body.error?.code}`)
    return (created.body.data as { assetId: string }).assetId
  }

  it('sletter en ubrukt fil likt over REST og MCP, med den samme kvitteringen', async () => {
    // A deletion cannot be asked for twice — the file is gone afterwards — so
    // the comparison is two files in the same deck, one deleted each way. What
    // has to match is the receipt's shape and its promises.
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Rydding begge veier')
    const first = await file(harnessed, deck.presentationId, 'en')
    const second = await file(harnessed, deck.presentationId, 'to')

    const overRest = await rest(harnessed, 'delete_asset', {
      presentationId: deck.presentationId,
      assetId: first,
    })
    expect(overRest.status).toBe(200)
    const restData = overRest.body.data as Record<string, unknown>

    const overMcp = await callTool(harnessed, tool('delete_asset'), {
      presentationId: deck.presentationId,
      assetId: second,
    })
    expect(overMcp.isError).toBeFalsy()
    const mcpData = overMcp.structuredContent as Record<string, unknown>

    expect(Object.keys(restData).sort()).toEqual(Object.keys(mcpData).sort())
    expect(restData).toMatchObject({ assetId: first, fileRemoved: true })
    expect(mcpData).toMatchObject({ assetId: second, fileRemoved: true })

    // One document underneath, and both files really left it.
    const read = await bothWays(harnessed, 'list_assets', { presentationId: deck.presentationId })
    expect(read.restData).toEqual(read.mcpData)
    expect((read.restData as { assets: unknown[] }).assets).toEqual([])
  })

  it('avviser en fil som er i bruk likt, som verktøyresultat med de samme tallene', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Fil i bruk')
    const assetId = await file(harnessed, deck.presentationId, 'plassert')
    await rest(harnessed, 'set_zone_asset', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      assetId,
    })

    const both = await refusedBothWays(harnessed, 'delete_asset', {
      presentationId: deck.presentationId,
      assetId,
    })
    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('ASSET_IN_USE')
    expect(both.rest.details).toMatchObject({
      assetId,
      usage: { total: 1, slides: { zoneContent: 1, inlineText: 0 } },
    })
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(422)

    // Two refusals, and the file is still there after both of them.
    const listed = await rest(harnessed, 'list_assets', { presentationId: deck.presentationId })
    expect((listed.body.data as { assets: { id: string; used: boolean }[] }).assets).toMatchObject([
      { id: assetId, used: true },
    ])
  })

  it('rydder referanser likt, og et andre kall er den samme no-op-en begge veier', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Referanserydding')
    const added = await rest(harnessed, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'Ubrukt',
    })
    const referenceId = (added.body.data as { reference: { id: string } }).reference.id

    const overRest = await rest(harnessed, 'delete_unused_references', {
      presentationId: deck.presentationId,
    })
    expect(overRest.status).toBe(200)
    expect(overRest.body.data).toMatchObject({ removedReferenceIds: [referenceId] })

    // Idempotent, and identically so: the second call removes nothing and
    // leaves the reading where the first one put it.
    const both = await bothWays(harnessed, 'delete_unused_references', {
      presentationId: deck.presentationId,
    })
    expect(both.restData).toEqual(both.mcpData)
    expect(both.restData).toMatchObject({ removedReferenceIds: [] })
    expect((both.restData as { revision: string }).revision).toBe(overRest.body.revision)
  })

  it('avviser en utdatert expectedRevision med CONFLICT begge veier, uten å rydde', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Utdatert rydding')
    const stale = (
      await rest(harnessed, 'get_presentation', { presentationId: deck.presentationId })
    ).body.revision
    await rest(harnessed, 'add_reference', { presentationId: deck.presentationId, title: 'Ubrukt' })

    const both = await refusedBothWays(harnessed, 'delete_unused_references', {
      presentationId: deck.presentationId,
      expectedRevision: stale,
    })
    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('CONFLICT')
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(409)

    const after = await rest(harnessed, 'get_presentation', { presentationId: deck.presentationId })
    expect((after.body.data as { referenceCount: number }).referenceCount).toBe(1)
  })

  it('lar et token med bare assets:write slette en fil, uten å lese dekket gjennom svaret', async () => {
    // `delete_asset` is the mirror of `upload_asset` and asks for the same
    // scope. That is only defensible if it cannot be used to *read*: neither the
    // receipt nor the refusal may hand a token that may store files a map of a
    // deck it has no read scope for.
    const full = harness()
    const deck = await newPresentation(full, 'Smalt token')
    const unused = await file(full, deck.presentationId, 'ubrukt')
    const placed = await file(full, deck.presentationId, 'plassert')
    await rest(full, 'set_zone_asset', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      assetId: placed,
    })

    const filesOnly = withScopes(full, ['assets:write'])

    // The token really cannot read.
    const denied = await rest(filesOnly, 'list_assets', { presentationId: deck.presentationId })
    expect(denied.status).toBe(403)
    expect(denied.body.error?.code).toBe('FORBIDDEN_SCOPE')

    // It may delete, and the receipt is ids and one boolean.
    const deleted = await rest(filesOnly, 'delete_asset', {
      presentationId: deck.presentationId,
      assetId: unused,
    })
    expect(deleted.status).toBe(200)
    expect(Object.keys(deleted.body.data as object).sort()).toEqual([
      'assetId',
      'fileRemoved',
      'presentationId',
      'revision',
    ])

    // And the refusal says why without naming a slide or a zone.
    const refused = await rest(filesOnly, 'delete_asset', {
      presentationId: deck.presentationId,
      assetId: placed,
    })
    expect(refused.status).toBe(422)
    expect(refused.body.error?.code).toBe('ASSET_IN_USE')
    const serialized = JSON.stringify(refused.body.error?.details)
    expect(serialized).not.toContain(deck.slideId)
    expect(serialized).not.toContain(deck.rootNodeId)
    // Over MCP too — the payload is the same object, so it cannot differ.
    const overMcp = await callFailure(filesOnly, tool('delete_asset'), {
      presentationId: deck.presentationId,
      assetId: placed,
    })
    expect(overMcp.error).toEqual(refused.body.error)
  })

  it('lar et token uten lesescope rydde referanser, men ikke lese dem gjennom kvitteringen', async () => {
    const full = harness()
    const deck = await newPresentation(full, 'Rydding uten lesescope')
    await rest(full, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'Hemmelig tittel',
      authors: 'Hemmelig forfatter',
      url: 'https://hemmelig.example',
      year: '2026',
    })
    const writeOnly = withoutReadScope(full)

    const denied = await rest(writeOnly, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(denied.status).toBe(403)

    const pruned = await rest(writeOnly, 'delete_unused_references', {
      presentationId: deck.presentationId,
    })
    expect(pruned.status).toBe(200)
    expect(Object.keys(pruned.body.data as object).sort()).toEqual([
      'presentationId',
      'removedReferenceIds',
      'revision',
    ])
    const serialized = JSON.stringify(pruned.body.data)
    expect(serialized).not.toContain('Hemmelig tittel')
    expect(serialized).not.toContain('Hemmelig forfatter')
    expect(serialized).not.toContain('hemmelig.example')
  })
})


describe('bibliotekets livsløp er det samme begge veier', () => {
  /** A folder put straight into the harness's store, the way the library makes one. */
  async function folderIn(harnessed: Harness, name: string): Promise<Folder> {
    const folder: Folder = { id: newFolderId(), name, createdAt: '2026-09-01T09:00:00.000Z' }
    await harnessed.context.repository.saveFolder(folder)
    return folder
  }

  it('list_folders svarer med de samme mappene', async () => {
    const harnessed = harness()
    const folder = await folderIn(harnessed, 'Kundemøter')

    const both = await bothWays(harnessed, 'list_folders', {})
    expect(both.restData).toEqual(both.mcpData)
    expect((both.restData as { folders: Folder[] }).folders).toEqual([folder])
  })

  it('create_folder lager mappen én gang, og begge transportene ser den etterpå', async () => {
    // A creation cannot be asked for twice and compared field for field: each
    // call mints a folder. What has to match is the shape of the answer and
    // everything in it that is not an identity — and that the folder REST made
    // is a folder MCP can read and file a deck into.
    const harnessed = harness()

    const overRest = await rest(harnessed, 'create_folder', { name: '  Over REST  ' })
    const overMcp = await callTool(harnessed, tool('create_folder'), { name: 'Over MCP' })
    expect(overRest.status).toBe(200)
    expect(overMcp.isError).toBeFalsy()

    const restFolder = (overRest.body.data as { folder: Folder }).folder
    const mcpFolder = (overMcp.structuredContent as { folder: Folder }).folder
    expect(Object.keys(restFolder).sort()).toEqual(Object.keys(mcpFolder).sort())
    expect(Object.keys(restFolder).sort()).toEqual(['createdAt', 'id', 'name'])
    // The same rule applied on both sides, including the trim.
    expect(restFolder.name).toBe('Over REST')
    expect(mcpFolder.name).toBe('Over MCP')

    // One store behind both: `list_folders` reports the two of them either way.
    const listed = await bothWays(harnessed, 'list_folders', {})
    expect(listed.restData).toEqual(listed.mcpData)
    expect((listed.restData as { folders: Folder[] }).folders.map((folder) => folder.name).sort()).toEqual(
      ['Over MCP', 'Over REST'],
    )

    // And the folder one transport made is one the other can file a deck into.
    const deck = await newPresentation(harnessed, 'Skal i mappen')
    const moved = await callTool(harnessed, tool('move_presentation'), {
      presentationId: deck.presentationId,
      folderId: restFolder.id,
    })
    expect(moved.structuredContent).toMatchObject({ folderId: restFolder.id })
  })

  it('avviser et tomt mappenavn likt, som protokollfeil i MCP', async () => {
    // Input that does not match the tool's schema was never a valid call, so
    // MCP answers with a JSON-RPC error rather than a tool result — the same
    // line `INVALID_INPUT` is drawn on everywhere else.
    const harnessed = harness()
    const both = await refusedBothWays(harnessed, 'create_folder', { name: '   ' })

    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('INVALID_INPUT')
    expect(both.envelope).toBe('protocol')
    expect(both.status).toBe(400)
    // And nothing was stored on either side.
    const listed = await bothWays(harnessed, 'list_folders', {})
    expect((listed.restData as { folders: Folder[] }).folders).toEqual([])
  })

  it('delete_folder svarer likt, og lar presentasjonene i mappen bli liggende', async () => {
    const harnessed = harness()
    const folder = await folderIn(harnessed, 'Slettes')
    const deck = await newPresentation(harnessed, 'Blir liggende')
    await rest(harnessed, 'move_presentation', {
      presentationId: deck.presentationId,
      folderId: folder.id,
    })

    const overRest = await rest(harnessed, 'delete_folder', { folderId: folder.id })
    expect(overRest.status).toBe(200)
    expect(overRest.body.data).toEqual({ folderId: folder.id, deleted: true })

    // The deck survived, at the root, and both transports read it that way.
    const read = await bothWays(harnessed, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(read.restData).toEqual(read.mcpData)
    expect((read.restData as { folderId: string | null }).folderId).toBeNull()

    // The second call is the refusal, not a silent `ok` — over MCP this time,
    // which is how the two transports get compared on a deletion that can only
    // succeed once.
    const again = await refusedBothWays(harnessed, 'delete_folder', { folderId: folder.id })
    expect(again.rest).toEqual(again.mcp)
    expect(again.rest.code).toBe('FOLDER_NOT_FOUND')
    expect(again.envelope).toBe('result')
    expect(again.status).toBe(404)
  })

  it('lar de to mappeoperasjonene virke uten lesescope, og uten å lekke navn', async () => {
    // `presentations:write` alone: neither of them reads. The receipts are the
    // caller's own id and what Slaids minted for it, so a token that may not
    // read a deck's title cannot learn a folder's name from either.
    const full = harness()
    const writeOnly = withoutReadScope(full)

    const denied = await rest(writeOnly, 'list_folders', {})
    expect(denied.status).toBe(403)

    const made = await rest(writeOnly, 'create_folder', { name: 'Uten lesescope' })
    expect(made.status).toBe(200)
    const folder = (made.body.data as { folder: Folder }).folder

    // A deck with a title the token may not read, filed in the folder it is
    // about to delete.
    const deck = await newPresentation(full, 'Hemmelig dekktittel')
    expect(
      (await rest(writeOnly, 'move_presentation', {
        presentationId: deck.presentationId,
        folderId: folder.id,
      })).status,
    ).toBe(200)

    const removed = await rest(writeOnly, 'delete_folder', { folderId: folder.id })
    expect(removed.status).toBe(200)
    expect(removed.body.data).toEqual({ folderId: folder.id, deleted: true })
    expect(JSON.stringify(removed.body)).not.toContain('Hemmelig dekktittel')
    expect(JSON.stringify(removed.body)).not.toContain('Uten lesescope')

    // Still there, at the root — a deletion the token could not read is still a
    // deletion that kept its promise.
    const survivor = await rest(full, 'get_presentation', { presentationId: deck.presentationId })
    expect((survivor.body.data as { folderId: string | null }).folderId).toBeNull()
  })

  it('move_presentation svarer likt, og er den samme no-op andre gangen', async () => {
    // Comparable field for field precisely because a move into the folder the
    // deck already sits in changes nothing: MCP asks for the state REST just
    // produced, so the two answers have to match down to the revision.
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Flyttet begge veier')
    const folder = await folderIn(harnessed, 'Kundemøter')

    const both = await bothWays(harnessed, 'move_presentation', {
      presentationId: deck.presentationId,
      folderId: folder.id,
    })
    expect(both.restData).toEqual(both.mcpData)
    expect(both.restData).toMatchObject({ presentationId: deck.presentationId, folderId: folder.id })

    // And the deck underneath says the same thing to both readers.
    const read = await bothWays(harnessed, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(read.restData).toEqual(read.mcpData)
    expect((read.restData as { folderId: string }).folderId).toBe(folder.id)
  })

  it('avviser en ukjent mappe likt, som verktøyresultat i MCP', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    const both = await refusedBothWays(harnessed, 'move_presentation', {
      presentationId: deck.presentationId,
      folderId: 'fl_finnes_ikke',
    })

    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('FOLDER_NOT_FOUND')
    // A real operation ran and said no, so it is an answer an agent acts on.
    expect(both.envelope).toBe('result')
    expect(both.status).toBe(404)
  })

  it('duplicate_presentation lager to selvstendige kopier med det samme svaret', async () => {
    // A duplication cannot be asked for twice and compared field for field: each
    // call mints a new deck. What has to match is the shape of the answer and
    // everything in it that is not an identity — and that both copies are real,
    // separate decks in the one store both transports write to.
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Kilde')

    const overRest = await rest(harnessed, 'duplicate_presentation', {
      presentationId: deck.presentationId,
    })
    const overMcp = await callTool(harnessed, tool('duplicate_presentation'), {
      presentationId: deck.presentationId,
    })
    const fromRest = overRest.body.data as Record<string, unknown>
    const fromMcp = overMcp.structuredContent as Record<string, unknown>

    expect(Object.keys(fromRest).sort()).toEqual(Object.keys(fromMcp).sort())
    for (const field of ['title', 'slideCount', 'assetCount', 'referenceCount', 'folderId']) {
      expect({ field, value: fromRest[field] }).toEqual({ field, value: fromMcp[field] })
    }
    expect(fromRest.title).toBe('Kilde (kopi)')
    expect(fromRest.presentationId).not.toBe(fromMcp.presentationId)

    // Three decks in one library: the source and one copy from each transport.
    const listed = await rest(harnessed, 'list_presentations', {})
    expect((listed.body.data as { presentations: unknown[] }).presentations).toHaveLength(3)
  })

  it('delete_presentation gir den samme kvitteringen og den samme feilen etterpå', async () => {
    const harnessed = harness()
    const overRest = await newPresentation(harnessed, 'Slettes over REST')
    const overMcp = await newPresentation(harnessed, 'Slettes over MCP')

    const byRest = await rest(harnessed, 'delete_presentation', {
      presentationId: overRest.presentationId,
    })
    const byMcp = await callTool(harnessed, tool('delete_presentation'), {
      presentationId: overMcp.presentationId,
    })
    expect(byMcp.isError).toBeFalsy()
    expect(byRest.body.data).toEqual({ presentationId: overRest.presentationId, deleted: true })
    expect(byMcp.structuredContent).toEqual({
      presentationId: overMcp.presentationId,
      deleted: true,
    })
    // No revision in either: there is no document left to write against, and
    // the REST envelope therefore lifts none out of the answer.
    expect(byRest.body.revision).toBeUndefined()

    // Both decks are really gone, in the one store.
    const listed = await rest(harnessed, 'list_presentations', {})
    expect((listed.body.data as { presentations: unknown[] }).presentations).toEqual([])

    // And asking again says the same thing on both sides.
    const again = await refusedBothWays(harnessed, 'delete_presentation', {
      presentationId: overRest.presentationId,
    })
    expect(again.rest).toEqual(again.mcp)
    expect(again.rest.code).toBe('PRESENTATION_NOT_FOUND')
    expect(again.envelope).toBe('result')
    expect(again.status).toBe(404)
  })

  it('avviser en gammel revisjon på en sletting likt, med CONFLICT', async () => {
    const harnessed = harness()
    const deck = await newPresentation(harnessed)
    await rest(harnessed, 'set_presentation_title', {
      presentationId: deck.presentationId,
      title: 'Endret av noen andre',
    })

    const both = await refusedBothWays(harnessed, 'delete_presentation', {
      presentationId: deck.presentationId,
      expectedRevision: deck.revision,
    })
    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('CONFLICT')
    expect(both.status).toBe(409)
    // Nothing was deleted by either attempt.
    const listed = await rest(harnessed, 'list_presentations', {})
    expect((listed.body.data as { presentations: unknown[] }).presentations).toHaveLength(1)
  })

  it('krever begge skriveautoritetene for en sletting, likt over begge transportene', async () => {
    // A deletion destroys the document *and* every file stored under it, which
    // are exactly the two things the two write scopes protect. Missing either
    // one is a refusal, and the refusal names the one that is missing.
    const harnessed = harness()
    const deck = await newPresentation(harnessed, 'Beskyttet av to scopes')

    for (const [scopes, missing] of [
      [['presentations:write'], 'assets:write'],
      [['assets:write'], 'presentations:write'],
    ] as [AgentScope[], string][]) {
      const narrow = withScopes(harnessed, scopes)
      const both = await refusedBothWays(narrow, 'delete_presentation', {
        presentationId: deck.presentationId,
      })
      expect(both.rest).toEqual(both.mcp)
      expect(both.rest.code).toBe('FORBIDDEN_SCOPE')
      expect(both.rest.details).toMatchObject({ missing: [missing] })
      expect(both.status).toBe(403)
    }

    // And the deck is still there, which is what the scope was protecting.
    const listed = await rest(harnessed, 'list_presentations', {})
    expect((listed.body.data as { presentations: unknown[] }).presentations).toHaveLength(1)
  })

  it('krever filskrivescopet for en duplisering, som lagrer en fil per fil', async () => {
    // A duplication copies the bytes of every file the source has. Gating it on
    // the document scopes alone would let a token denied `upload_asset` fill the
    // asset store anyway, one copy of a picture-heavy deck at a time — and it
    // would put the authority that *takes a file out* of the store under a
    // stricter rule than the one that puts files in.
    const full = harness()
    const deck = await newPresentation(full, 'Dekk med fil')
    const stored = await rest(full, 'upload_asset', {
      presentationId: deck.presentationId,
      name: 'figur.png',
      content: { encoding: 'base64', data: realImageBase64.png },
    })
    expect(stored.status).toBe(200)

    const noFiles = withScopes(full, ['presentations:read', 'presentations:write'])
    const both = await refusedBothWays(noFiles, 'duplicate_presentation', {
      presentationId: deck.presentationId,
    })
    expect(both.rest).toEqual(both.mcp)
    expect(both.rest.code).toBe('FORBIDDEN_SCOPE')
    expect(both.rest.details).toMatchObject({ missing: ['assets:write'] })
    expect(both.status).toBe(403)

    // Nothing was copied: neither a document nor a file.
    const listed = await rest(full, 'list_presentations', {})
    expect((listed.body.data as { presentations: unknown[] }).presentations).toHaveLength(1)
    expect(await full.context.repository.listAssets(deck.presentationId)).toHaveLength(1)
  })

  it('lar et token uten lesescope flytte og slette, men ikke kopiere', async () => {
    // The scope boundary that separates the three. A move writes one field and
    // answers with the two ids the caller sent; a deletion answers with an id
    // and a boolean. A copy answers with the deck the way `get_presentation`
    // would, so it needs the read scope too — otherwise a write-only token
    // could learn a deck's title and structure by copying it.
    const full = harness()
    const deck = await newPresentation(full, 'Hemmelig tittel')
    const folder = await folderIn(full, 'Kundemøter')
    const writeOnly = withScopes(full, ['presentations:write', 'assets:write'])

    expect((await rest(writeOnly, 'get_presentation', { presentationId: deck.presentationId })).status).toBe(403)
    expect((await rest(writeOnly, 'list_folders', {})).status).toBe(403)

    const moved = await rest(writeOnly, 'move_presentation', {
      presentationId: deck.presentationId,
      folderId: folder.id,
    })
    expect(moved.status).toBe(200)
    expect(Object.keys(moved.body.data as object).sort()).toEqual([
      'folderId',
      'presentationId',
      'revision',
    ])
    // Not even the folder's name, which is a reading of the library.
    expect(JSON.stringify(moved.body.data)).not.toContain('Kundemøter')

    const copied = await rest(writeOnly, 'duplicate_presentation', {
      presentationId: deck.presentationId,
    })
    expect(copied.status).toBe(403)
    expect(copied.body.error?.details).toMatchObject({ missing: ['presentations:read'] })

    const deleted = await rest(writeOnly, 'delete_presentation', {
      presentationId: deck.presentationId,
    })
    expect(deleted.status).toBe(200)
    expect(JSON.stringify(deleted.body.data)).not.toContain('Hemmelig tittel')
  })
})
