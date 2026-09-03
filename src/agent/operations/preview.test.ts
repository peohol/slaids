/**
 * `render_slide_preview`, without a browser.
 *
 * The renderer is injected, so the operation can be tested for the things that
 * are actually its own: which page an id resolves to, what it hands the
 * renderer, that it writes nothing, and that a deployment without a renderer
 * says so instead of failing obscurely. Whether a real Chromium draws the right
 * pixels is `src/render/`'s question, and `agentLoop.test.ts` asks it.
 *
 * The recorder below is a stand-in for the renderer, not for Slaids: every deck
 * is built through Agent Core against a real Dexie store, so nothing here can
 * ask for a preview of a slide the rules would have refused to create.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { COVER_PAGE_ID, deckPages } from '../../domain/pages'
import { presentationRevision } from '../../domain/revision'
import { agentImage } from '../image'
import type { SlidePreviewRequest } from '../preview'
import {
  agentOperation,
  agentRefusal,
  closeTestDatabases,
  newAgentDeck,
  storedPresentation,
  testAgentContext,
} from '../testDeck'
import type { AgentContext } from '../types'
import type { SlidePreviewView } from './preview'

afterEach(closeTestDatabases)

/** Two pixels of PNG. Enough to be a picture the operation must pass through. */
const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

interface Recorder {
  calls: SlidePreviewRequest[]
  context: AgentContext
}

function withRecordingRenderer(options: { warnings?: string[]; fontsReady?: boolean } = {}): Recorder {
  const calls: SlidePreviewRequest[] = []
  const context = testAgentContext({
    preview: (request) => {
      calls.push(request)
      return Promise.resolve({
        ok: true,
        value: {
          image: agentImage({
            mimeType: 'image/png',
            bytes: FAKE_PNG,
            width: Math.round(1600 * request.scale),
            height: Math.round(900 * request.scale),
          }),
          fontsReady: options.fontsReady ?? true,
          warnings: options.warnings ?? [],
        },
      })
    },
  })
  return { calls, context }
}

describe('en installasjon uten renderer', () => {
  it('sier PREVIEW_UNAVAILABLE i stedet for å feile uforståelig', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)

    const error = await agentRefusal(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(error.code).toBe('PREVIEW_UNAVAILABLE')
    // Everything else still works, and the message says so.
    expect(error.message).toContain('agent-API')
  })
})

describe('adressering', () => {
  it('rendrer en slide, og svarer med revisjonen bildet viser', async () => {
    const { context, calls } = withRecordingRenderer()
    const deck = await newAgentDeck(context)
    const before = await storedPresentation(context, deck.presentationId)

    const view = await agentOperation<SlidePreviewView>(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })

    expect(view.presentationId).toBe(deck.presentationId)
    expect(view.slideId).toBe(deck.slideId)
    expect(view.pageKind).toBe('authored-slide')
    expect(view.revision).toBe(presentationRevision(before))
    expect(view.scale).toBe(1)
    expect(view.image.mimeType).toBe('image/png')
    expect(view.image.width).toBe(1600)
    expect(view.image.height).toBe(900)
    expect(view.image.bytes).toEqual(FAKE_PNG)

    expect(calls).toHaveLength(1)
    expect(calls[0].page.id).toBe(deck.slideId)
    // The document the renderer is given is the one that is stored, not a copy
    // the operation assembled.
    expect(calls[0].presentation).toEqual(before)
    // And the same store the deck came out of, so a preview cannot show a file
    // from somewhere this presentation is not.
    expect(calls[0].assets).toBe(context.repository)
  })

  it('rendrer forsiden, som ikke er en slide', async () => {
    const { context, calls } = withRecordingRenderer()
    const deck = await newAgentDeck(context)
    await agentOperation(context, 'set_cover', {
      presentationId: deck.presentationId,
      title: 'Forsiden',
    })

    const view = await agentOperation<SlidePreviewView>(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: COVER_PAGE_ID,
    })

    expect(view.pageKind).toBe('cover')
    expect(calls[0].page.kind).toBe('cover')
  })

  it('rendrer en avledet referanseside', async () => {
    const { context } = withRecordingRenderer()
    const deck = await newAgentDeck(context)
    const added = await agentOperation<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'Kilden',
      authors: 'Forfatter',
      url: 'https://example.test',
      year: '2026',
    })
    await agentOperation(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ citation: [added.reference.id] }] }],
    })

    // The derived page id is not in `slides`; it comes from the deck's page
    // model, which is what the operation resolves against.
    const presentation = await storedPresentation(context, deck.presentationId)
    const derived = deckPages(presentation).find((page) => page.kind === 'reference-slide')
    if (!derived) throw new Error('Ingen referanseside ble avledet.')

    const view = await agentOperation<SlidePreviewView>(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: derived.id,
    })
    expect(view.pageKind).toBe('reference-slide')
  })
})

describe('feil en agent kan handle på', () => {
  it('en presentasjon som ikke finnes er PRESENTATION_NOT_FOUND', async () => {
    const { context } = withRecordingRenderer()
    const error = await agentRefusal(context, 'render_slide_preview', {
      presentationId: 'p_finnes_ikke',
      slideId: 's_1',
    })
    expect(error.code).toBe('PRESENTATION_NOT_FOUND')
  })

  it('en side som ikke finnes er SLIDE_NOT_FOUND, med sidene som finnes', async () => {
    const { context, calls } = withRecordingRenderer()
    const deck = await newAgentDeck(context)

    const error = await agentRefusal(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: 's_ikke_her',
    })

    expect(error.code).toBe('SLIDE_NOT_FOUND')
    const available = error.details?.available as { slideId: string; pageKind: string }[]
    // Actionable: the ids to try next, not just "no".
    expect(available.map((page) => page.slideId)).toEqual([COVER_PAGE_ID, deck.slideId])
    expect(calls).toHaveLength(0)
  })

  it('en skala utenfor det tillatte er INVALID_INPUT, før noe rendres', async () => {
    const { context, calls } = withRecordingRenderer()
    const deck = await newAgentDeck(context)

    for (const scale of [0, 5, -1]) {
      const error = await agentRefusal(context, 'render_slide_preview', {
        presentationId: deck.presentationId,
        slideId: deck.slideId,
        scale,
      })
      expect(error.code).toBe('INVALID_INPUT')
    }
    expect(calls).toHaveLength(0)
  })

  it('avviser et felt som ikke finnes i stedet for å ignorere det', async () => {
    const { context } = withRecordingRenderer()
    const deck = await newAgentDeck(context)
    const error = await agentRefusal(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      scal: 0.5,
    })
    expect(error.code).toBe('INVALID_INPUT')
  })

  it('gir rendererens egen kode videre, slik at «prøv igjen» kan skilles fra «gi opp»', async () => {
    const context = testAgentContext({
      preview: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'PREVIEW_FAILED' as const, message: 'Nettleseren døde.' },
        }),
    })
    const deck = await newAgentDeck(context)

    const error = await agentRefusal(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })

    // Not collapsed into one preview code: `PREVIEW_UNAVAILABLE` means stop
    // asking, and this one means the renderer is there and this attempt broke.
    expect(error.code).toBe('PREVIEW_FAILED')
    expect(error.message).toContain('Nettleseren døde')
    expect(error.details).toMatchObject({
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
  })
})

describe('previewet er en lesing', () => {
  it('endrer verken dokumentet, revisjonen eller updatedAt', async () => {
    const { context } = withRecordingRenderer()
    const deck = await newAgentDeck(context)
    const before = await storedPresentation(context, deck.presentationId)

    for (const scale of [1, 0.5, 2]) {
      await agentOperation(context, 'render_slide_preview', {
        presentationId: deck.presentationId,
        slideId: deck.slideId,
        scale,
      })
    }

    const after = await storedPresentation(context, deck.presentationId)
    expect(after).toEqual(before)
    expect(presentationRevision(after)).toBe(presentationRevision(before))
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('kan skrive mot den revisjonen etterpå, uten CONFLICT', async () => {
    // The point of reporting the revision it read: a screenshot must not make an
    // agent's own knowledge stale.
    const { context } = withRecordingRenderer()
    const deck = await newAgentDeck(context)

    const view = await agentOperation<SlidePreviewView>(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    await agentOperation(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: view.revision,
      spans: [{ text: 'Etter previewet' }],
    })
  })
})

describe('skala og advarsler', () => {
  it('lar en agent be om et mindre bilde, og sier hvor stort det ble', async () => {
    const { context, calls } = withRecordingRenderer()
    const deck = await newAgentDeck(context)

    const view = await agentOperation<SlidePreviewView>(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      scale: 0.25,
    })

    expect(calls[0].scale).toBe(0.25)
    expect(view.scale).toBe(0.25)
    expect(view.image.width).toBe(400)
    expect(view.image.height).toBe(225)
  })

  it('bærer rendererens advarsler videre, urørt', async () => {
    const { context } = withRecordingRenderer({
      warnings: ['Filen a_1 finnes ikke i lageret, så den vises ikke i previewet.'],
      fontsReady: false,
    })
    const deck = await newAgentDeck(context)

    const view = await agentOperation<SlidePreviewView>(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })

    expect(view.fontsReady).toBe(false)
    expect(view.warnings).toEqual([
      'Filen a_1 finnes ikke i lageret, så den vises ikke i previewet.',
    ])
  })
})
