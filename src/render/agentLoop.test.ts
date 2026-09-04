// @vitest-environment node
/**
 * The loop §44 asks for, with nothing faked.
 *
 *   build → validate → render → look → adjust → render again
 *
 * A real Chromium, the real stylesheets, the real components, the official MCP
 * SDK's own client over a real socket, and a real Dexie store underneath. The
 * only thing that is not production is the token lookup.
 *
 * That combination is the point. Every other test in this subsystem can pass
 * while the picture is a blank rectangle: the markup can be perfect, the
 * geometry correct, the stylesheet inlined, and the preview still come back as
 * one flat colour because the fonts never arrived or the browser never loaded
 * the document. So this file reads the pixels back and states the property
 * directly — the slide's regions hold more than one colour, and the picture
 * changes when the deck changes.
 *
 * It needs a browser, and it says so rather than passing quietly without one:
 * `resolveExecutable` finds `@sparticuz/chromium` (an ordinary dependency, and
 * the same one production uses) or a Chromium named by
 * `SLAIDS_CHROMIUM_EXECUTABLE`. If neither is there the suite fails, because a
 * green run that never rendered anything is the one outcome worse than a red
 * one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CARD_PADDING, SLIDE_HEIGHT, SLIDE_WIDTH } from '../domain/constants'
import { DEFAULT_FONT_SCALE, DEFAULT_SPACING, FONT_SCALE_RANGE } from '../domain/metrics'
import { COVER_PAGE_ID } from '../domain/pages'
import type { Rect } from '../domain/types'
import {
  TOKEN,
  closeHarnessDatabases,
  harness,
  type Harness,
} from '../server/mcp/testHarness'
import { listenHarness, type ServedHarness } from '../server/mcp/testServer'
import { chromiumSlidePreviewRenderer } from './preview'
import { decodePng, distinctColours } from './png'
import { pngPixelSize } from './rasterize'

/** A browser launch plus a font fetch is seconds, not milliseconds. */
const BROWSER_TIMEOUT_MS = 180_000

/**
 * Two backgrounds far enough apart that a sampled pixel settles the question.
 *
 * The theme's background is the one part of it that reaches the picture without
 * passing through type: it is the ground the whole slide sits on, so it is what
 * a colour probe can state plainly. The typographic half of a theme change is
 * asserted the way this file asserts every visual change — the bytes differ.
 */
const DEEP_GREEN = { hex: '#0b3d2e', rgb: [11, 61, 46] as const }
const RUST = { hex: '#7c2d12', rgb: [124, 45, 18] as const }

/** A corner outside the slide inset, so it is background and nothing else. */
const BACKGROUND_REGION = { x: 4, y: 4, width: 30, height: 30 }

/** As much of `get_presentation`'s theme as this file reads. */
interface ThemeReading {
  backgroundColor: string
  headingFont: { fontId: string | null }
  bodyFont: { fontId: string | null }
  spacing: number
  fontScale: number
}

const SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">
  <rect width="200" height="120" fill="#f4c542"/>
  <circle cx="100" cy="60" r="45" fill="#1f2937"/>
</svg>`

let deployment: Harness
let served: ServedHarness

beforeAll(async () => {
  // The production renderer, resolved exactly the way the deployment resolves
  // it. Nothing about the browser is stubbed.
  deployment = harness({ preview: chromiumSlidePreviewRenderer() })
  served = await listenHarness(deployment)
}, BROWSER_TIMEOUT_MS)

afterAll(async () => {
  await served.close()
  await closeHarnessDatabases()
})

interface PreviewResult {
  isError?: boolean
  content: { type: string; text?: string; data?: string; mimeType?: string }[]
  structuredContent?: {
    presentationId: string
    slideId: string
    pageKind: string
    revision: string
    scale: number
    fontsReady: boolean
    warnings: string[]
    image: { mimeType: string; width: number; height: number; byteLength: number }
  }
}

async function agentClient(): Promise<Client> {
  const client = new Client({ name: 'slaids-agent-loop-test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(served.address, {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  )
  return client
}

/** One tool call that is expected to work, unwrapped to its structured half. */
async function call<T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = (await client.callTool({ name: `slaids_${name}`, arguments: args })) as {
    isError?: boolean
    content: { type: string; text?: string }[]
    structuredContent?: unknown
  }
  if (result.isError) {
    throw new Error(`«${name}» ble avvist: ${result.content.find((b) => b.type === 'text')?.text}`)
  }
  return result.structuredContent as T
}

async function renderPreview(
  client: Client,
  args: Record<string, unknown>,
): Promise<{ result: PreviewResult; bytes: Uint8Array }> {
  const result = (await client.callTool({
    name: 'slaids_render_slide_preview',
    arguments: args,
  })) as PreviewResult
  if (result.isError) {
    throw new Error(
      `Previewet ble avvist: ${result.content.find((block) => block.type === 'text')?.text}`,
    )
  }
  const image = result.content.find((block) => block.type === 'image')
  if (!image?.data) throw new Error('Previewet kom ikke som en image-blokk.')
  return { result, bytes: new Uint8Array(Buffer.from(image.data, 'base64')) }
}

describe('en agent bygger, ser og retter', () => {
  it(
    'lager en slide, fyller den, rendrer den og får et gyldig bilde av den',
    async () => {
      const client = await agentClient()

      /* ---- 1. build it, through the tools an agent has ---- */

      const created = await call<{ presentationId: string; slides: { slideId: string }[] }>(
        client,
        'create_presentation',
        { title: 'Agentløkken' },
      )
      const presentationId = created.presentationId
      const slideId = created.slides[0].slideId

      await call(client, 'set_cover', {
        presentationId,
        title: 'Rendret preview',
        subtitle: 'Fase 5',
      })
      await call(client, 'set_slide_title', {
        presentationId,
        slideId,
        spans: [{ text: 'To soner og en figur' }],
      })

      const inspected = await call<{ rootNodeId: string }>(client, 'inspect_slide', {
        presentationId,
        slideId,
      })
      await call(client, 'split_zone', {
        presentationId,
        slideId,
        nodeId: inspected.rootNodeId,
        axis: 'x',
        weights: [3, 2],
      })

      const split = await call<{ zones: { nodeId: string; kind: string }[] }>(
        client,
        'inspect_slide',
        { presentationId, slideId },
      )
      const [left, right] = split.zones
        .filter((zone) => zone.kind === 'leaf')
        .map((zone) => zone.nodeId)

      await call(client, 'set_zone_card', {
        presentationId,
        slideId,
        nodeId: left,
        kind: 'titled-card',
        title: [{ text: 'Hva agenten ser' }],
        color: '#2563eb',
      })
      await call(client, 'set_zone_text', {
        presentationId,
        slideId,
        nodeId: left,
        blocks: [
          { type: 'paragraph', spans: [{ text: 'Previewet bruker Slaids’ egen renderer.' }] },
          {
            type: 'bullets',
            items: [[{ text: 'Samme geometri' }], [{ text: 'Samme typografi' }]],
          },
        ],
      })

      /* ---- 2. a figure, made the only way Slaids makes one ---- */

      const asset = await call<{ assetId: string }>(client, 'create_svg_asset', {
        presentationId,
        name: 'figur',
        svgMarkup: SVG_MARKUP,
      })
      await call(client, 'set_zone_asset', {
        presentationId,
        slideId,
        nodeId: right,
        assetId: asset.assetId,
        fit: 'contain',
      })

      /* ---- 3. it is legal ---- */

      const validated = await call<{ valid: boolean; issues: unknown[] }>(
        client,
        'validate_slide',
        { presentationId, slideId },
      )
      expect(validated.issues).toEqual([])
      expect(validated.valid).toBe(true)

      /* ---- 4. and it is a real picture of it ---- */

      const { result, bytes } = await renderPreview(client, { presentationId, slideId })

      // A valid, non-empty PNG of the expected size — read off the file itself,
      // not off the arithmetic that asked for it.
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(pngPixelSize(bytes)).toEqual({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT })
      expect(bytes.byteLength).toBeGreaterThan(2000)

      expect(result.structuredContent).toMatchObject({
        presentationId,
        slideId,
        pageKind: 'authored-slide',
        scale: 1,
        image: { mimeType: 'image/png', width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      })
      expect(result.structuredContent?.image.byteLength).toBe(bytes.byteLength)
      // Nothing to warn about *in the deck*: the file is in the store, so the
      // picture is complete. A font warning is allowed to stand, because the
      // faces come over the network and a sandbox may have none — the picture is
      // then drawn in the fallback face, which `fontsReady` says out loud.
      expect(
        result.structuredContent?.warnings.filter((warning) =>
          warning.includes('finnes ikke i lageret'),
        ),
      ).toEqual([])
      expect(result.structuredContent?.fontsReady).toBeTypeOf('boolean')

      /* ---- 5. and something was actually drawn ---- */

      const bitmap = decodePng(bytes)
      expect(bitmap.width).toBe(SLIDE_WIDTH)
      expect(bitmap.height).toBe(SLIDE_HEIGHT)

      // The title band, the card and the figure each hold more than one colour.
      // A blank rectangle — the failure mode every other test in this
      // subsystem would pass through — holds exactly one.
      expect(distinctColours(bitmap, { x: 400, y: 30, width: 800, height: 60 })).toBeGreaterThan(3)
      expect(distinctColours(bitmap, { x: 60, y: 200, width: 700, height: 400 })).toBeGreaterThan(3)
      expect(distinctColours(bitmap, { x: 1000, y: 300, width: 500, height: 300 })).toBeGreaterThan(
        3,
      )

      // The figure's own yellow is on the slide, so the stored SVG really was
      // drawn rather than replaced by a placeholder.
      expect(hasColourNear(bitmap, [244, 197, 66], { x: 980, y: 130, width: 580, height: 640 })).toBe(
        true,
      )

      await client.close()
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'ser forskjellen etter en rettelse, og rendrer forsiden også',
    async () => {
      const client = await agentClient()

      const created = await call<{ presentationId: string; slides: { slideId: string }[] }>(
        client,
        'create_presentation',
        { title: 'Før og etter' },
      )
      const presentationId = created.presentationId
      const slideId = created.slides[0].slideId
      const inspected = await call<{ rootNodeId: string }>(client, 'inspect_slide', {
        presentationId,
        slideId,
      })

      const before = await renderPreview(client, { presentationId, slideId, scale: 0.5 })
      expect(pngPixelSize(before.bytes)).toEqual({ width: 800, height: 450 })

      await call(client, 'set_zone_card', {
        presentationId,
        slideId,
        nodeId: inspected.rootNodeId,
        kind: 'untitled-card',
        color: '#dc2626',
      })

      const after = await renderPreview(client, { presentationId, slideId, scale: 0.5 })

      // The loop is only worth anything if the picture follows the deck: the
      // card's own red is on the slide afterwards and was not there before.
      expect(after.bytes).not.toEqual(before.bytes)
      const region = { x: 100, y: 150, width: 500, height: 200 }
      expect(hasColourNear(decodePng(before.bytes), [220, 38, 38], region)).toBe(false)
      expect(hasColourNear(decodePng(after.bytes), [220, 38, 38], region)).toBe(true)

      // And the revision the preview reports is still the one to write against.
      const written = await call<{ revision: string }>(client, 'set_slide_title', {
        presentationId,
        slideId,
        expectedRevision: after.result.structuredContent?.revision,
        spans: [{ text: 'Etter previewet' }],
      })
      expect(written.revision).toBeTypeOf('string')

      /* The cover is a page too, and it is not a slide. */
      const cover = await renderPreview(client, { presentationId, slideId: COVER_PAGE_ID })
      expect(cover.result.structuredContent?.pageKind).toBe('cover')
      expect(pngPixelSize(cover.bytes)).toEqual({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT })

      await client.close()
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'ser et nytt tema i bildet, og får en temaendring som ville skjult innhold avvist i sin helhet',
    async () => {
      const client = await agentClient()

      /* ---- 1. read the deck, and with it the theme it is drawn in ---- */

      const created = await call<{ presentationId: string; slides: { slideId: string }[] }>(
        client,
        'create_presentation',
        { title: 'Tema i bildet' },
      )
      const presentationId = created.presentationId
      const slideId = created.slides[0].slideId

      const read = await call<{ theme: ThemeReading }>(client, 'get_presentation', {
        presentationId,
      })
      expect(read.theme).toMatchObject({
        headingFont: { fontId: 'quicksand' },
        bodyFont: { fontId: 'atkinson' },
        spacing: DEFAULT_SPACING,
        fontScale: DEFAULT_FONT_SCALE,
      })

      const inspected = await call<{ rootNodeId: string }>(client, 'inspect_slide', {
        presentationId,
        slideId,
      })
      await call(client, 'set_slide_title', {
        presentationId,
        slideId,
        spans: [{ text: 'Temaet er globalt' }],
      })
      // Text in a transparent container rather than a card, so the deck's own
      // background is what the picture is mostly made of.
      const zone = { presentationId, slideId, nodeId: inspected.rootNodeId }
      await call(client, 'set_zone_text', {
        ...zone,
        blocks: [{ type: 'paragraph', spans: [{ text: 'Bakgrunn, font og luft. '.repeat(40) }] }],
      })

      /* ---- 2. a theme nobody could mistake for the default ---- */

      await call(client, 'set_theme', {
        presentationId,
        backgroundColor: DEEP_GREEN.hex,
        headingFont: 'merriweather',
        bodyFont: 'merriweather',
        spacing: 1.3,
      })

      const green = await renderPreview(client, { presentationId, slideId })
      // The picture is drawn in the theme that was just set — not in the one
      // the deck was created with, and not in a renderer's own defaults.
      expect(hasColourNear(decodePng(green.bytes), DEEP_GREEN.rgb, BACKGROUND_REGION)).toBe(true)

      /* ---- 3. change it again, and the picture follows ---- */

      await call(client, 'set_theme', {
        presentationId,
        backgroundColor: RUST.hex,
        fontScale: FONT_SCALE_RANGE.min,
      })
      const rust = await renderPreview(client, { presentationId, slideId })

      expect(rust.bytes).not.toEqual(green.bytes)
      const rustBitmap = decodePng(rust.bytes)
      expect(hasColourNear(rustBitmap, RUST.rgb, BACKGROUND_REGION)).toBe(true)
      expect(hasColourNear(rustBitmap, DEEP_GREEN.rgb, BACKGROUND_REGION)).toBe(false)

      /* ---- 4. and a theme that would hide the text is refused whole ---- */

      // Fill the zone under the theme now in force, so what is left to decide
      // is the theme and nothing else. Grown through the operation itself:
      // "full" is whatever the fit checker says, and the last refusal leaves
      // the longest accepted text in place because nothing is stored when an
      // operation is refused.
      await fillZone(client, zone)

      const before = await deployment.context.repository.loadPresentation(presentationId)
      const refused = (await client.callTool({
        name: 'slaids_set_theme',
        arguments: {
          presentationId,
          // A colour that could never hide anything, sent together with a type
          // size that would: half a theme is not a state anybody asked for.
          backgroundColor: '#ffffff',
          fontScale: 1.6,
        },
      })) as { isError?: boolean; structuredContent?: { error?: { code: string } } }
      expect(refused.isError).toBe(true)
      expect(refused.structuredContent?.error?.code).toBe('CONTENT_DOES_NOT_FIT')

      // Nothing was written — not the type size, and not the colour that came
      // with it. The stored document is the one from before the call.
      expect(await deployment.context.repository.loadPresentation(presentationId)).toEqual(before)

      // Which is what the agent sees when it looks again: still the rust deck.
      const after = await renderPreview(client, { presentationId, slideId })
      const afterBitmap = decodePng(after.bytes)
      expect(hasColourNear(afterBitmap, RUST.rgb, BACKGROUND_REGION)).toBe(true)
      expect(hasColourNear(afterBitmap, [255, 255, 255], BACKGROUND_REGION)).toBe(false)

      await client.close()
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'legger to subfelt side om side i det forholdet det ba om, og ser det i bildet',
    async () => {
      const client = await agentClient()

      /* ---- 1. one card, two subfields, side by side at 2:1 ---- */

      const created = await call<{ presentationId: string; slides: { slideId: string }[] }>(
        client,
        'create_presentation',
        { title: 'To spalter i ett kort', firstSlideHasTitle: false },
      )
      const presentationId = created.presentationId
      const slideId = created.slides[0].slideId
      const inspected = await call<{ rootNodeId: string }>(client, 'inspect_slide', {
        presentationId,
        slideId,
      })
      const zone = { presentationId, slideId, nodeId: inspected.rootNodeId }

      await call(client, 'set_zone_card', { ...zone, kind: 'untitled-card', color: '#ffffff' })
      const layout = await call<{ axis: string; weights: number[]; subfieldIds: string[] }>(
        client,
        'adjust_subfields',
        { ...zone, subfieldCount: 2, axis: 'x', weights: [2, 1] },
      )
      expect(layout).toMatchObject({ axis: 'x', weights: [2, 1] })
      expect(layout.subfieldIds).toHaveLength(2)

      // Only the wide column is filled. The narrow one stays empty on purpose:
      // an empty column is what makes "where does the text stop" readable off
      // the picture at all.
      await call(client, 'set_zone_text', {
        ...zone,
        subfieldId: layout.subfieldIds[0],
        blocks: [
          {
            type: 'paragraph',
            spans: [{ text: 'Spalten er bredere enn halve kortet. '.repeat(24) }],
          },
        ],
      })

      /* ---- 2. and the agent reads its own layout back ---- */

      const readBack = await call<{
        zones: { nodeId: string; rect: Rect; subfieldAxis?: string; subfieldWeights?: number[] }[]
      }>(client, 'inspect_slide', { presentationId, slideId })
      const card = readBack.zones.find((candidate) => candidate.nodeId === zone.nodeId)
      expect(card).toMatchObject({ subfieldAxis: 'x', subfieldWeights: [2, 1] })

      /* ---- 3. the pixels say the same thing ---- */

      // Where the boundary between the two columns falls if the ratio is real.
      // Derived from the rect the geometry engine reported and the card's own
      // padding, so the probes move with the design space rather than pinning it.
      const rect = card?.rect as Rect
      const inner = rect.width - CARD_PADDING * 2
      const boundary = rect.x + CARD_PADDING + (inner * 2) / 3
      const halfway = rect.x + CARD_PADDING + inner / 2
      expect(boundary).toBeGreaterThan(halfway)

      // Text on the far side of the halfway mark: only a column wider than half
      // the card can put ink here, so this is the 2:1 itself, measured.
      const pastHalfway = {
        x: Math.round(halfway + 60),
        y: Math.round(rect.y + CARD_PADDING + 10),
        width: 120,
        height: 260,
      }
      // Well inside the empty column: side by side means the text stops here.
      const emptyColumn = {
        x: Math.round(boundary + 60),
        y: Math.round(rect.y + CARD_PADDING + 10),
        width: Math.round(rect.x + rect.width - CARD_PADDING - 40 - (boundary + 60)),
        height: 260,
      }

      const columns = await renderPreview(client, { presentationId, slideId })
      const columnsBitmap = decodePng(columns.bytes)
      expect(distinctColours(columnsBitmap, pastHalfway)).toBeGreaterThan(3)
      expect(distinctColours(columnsBitmap, emptyColumn)).toBeLessThanOrEqual(2)

      /* ---- 4. flip the direction, and the same probe changes its answer ---- */

      await call(client, 'adjust_subfields', { ...zone, axis: 'y' })
      const rows = await renderPreview(client, { presentationId, slideId })
      expect(rows.bytes).not.toEqual(columns.bytes)
      // Stacked, the filled field is the full width of the card, so the region
      // that was blank because it belonged to the empty column now holds text.
      expect(distinctColours(decodePng(rows.bytes), emptyColumn)).toBeGreaterThan(3)

      /* ---- 5. and a ratio that would hide the text is refused whole ---- */

      const before = await deployment.context.repository.loadPresentation(presentationId)
      const refused = (await client.callTool({
        name: 'slaids_adjust_subfields',
        arguments: { ...zone, axis: 'x', weights: [1, 30] },
      })) as { isError?: boolean; structuredContent?: { error?: { code: string } } }
      expect(refused.isError).toBe(true)
      expect(refused.structuredContent?.error?.code).toBe('CONTENT_DOES_NOT_FIT')

      // Neither the direction nor the ratio was stored: half a layout is not a
      // state anybody asked for, and the picture is the one from before.
      expect(await deployment.context.repository.loadPresentation(presentationId)).toEqual(before)
      const after = await renderPreview(client, { presentationId, slideId })
      expect(after.bytes).toEqual(rows.bytes)

      await client.close()
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'endrer ikke presentasjonen ved å rendre den',
    async () => {
      const client = await agentClient()
      const created = await call<{ presentationId: string; slides: { slideId: string }[] }>(
        client,
        'create_presentation',
        { title: 'Uendret av å bli sett på' },
      )
      const presentationId = created.presentationId
      const slideId = created.slides[0].slideId

      const before = await deployment.context.repository.loadPresentation(presentationId)
      for (const scale of [1, 0.25]) {
        await renderPreview(client, { presentationId, slideId, scale })
      }
      const after = await deployment.context.repository.loadPresentation(presentationId)

      expect(after).toEqual(before)
      await client.close()
    },
    BROWSER_TIMEOUT_MS,
  )
})

/**
 * Put as much text in a zone as it will hold, through the tool an agent uses.
 *
 * Grown rather than calculated: the capacity depends on the theme in force, and
 * a test that computed it would be testing its own arithmetic instead of the
 * fit checker's answer. The refusal that ends the loop stores nothing, so the
 * zone is left holding the longest text that was accepted.
 */
async function fillZone(client: Client, zone: Record<string, string>): Promise<void> {
  for (let length = 600; length <= 12000; length += 600) {
    const attempt = (await client.callTool({
      name: 'slaids_set_zone_text',
      arguments: {
        ...zone,
        blocks: [{ type: 'paragraph', spans: [{ text: 'ord '.repeat(length / 4) }] }],
      },
    })) as { isError?: boolean }
    if (attempt.isError) return
  }
  throw new Error('Sonen tok imot all teksten den ble tilbudt.')
}

/** Whether a region contains a pixel close to this colour. */
function hasColourNear(
  bitmap: ReturnType<typeof decodePng>,
  target: readonly [number, number, number],
  region: { x: number; y: number; width: number; height: number },
  tolerance = 24,
): boolean {
  for (let y = region.y; y < region.y + region.height && y < bitmap.height; y += 2) {
    for (let x = region.x; x < region.x + region.width && x < bitmap.width; x += 2) {
      const [r, g, b] = bitmap.at(x, y)
      if (
        Math.abs(r - target[0]) <= tolerance &&
        Math.abs(g - target[1]) <= tolerance &&
        Math.abs(b - target[2]) <= tolerance
      ) {
        return true
      }
    }
  }
  return false
}
