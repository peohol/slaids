// @vitest-environment node
/**
 * The composition, and the two failures it has to tell apart.
 *
 * `slidePreviewRenderer` is four small steps and one decision: which of the two
 * preview codes a thrown error becomes. That decision is what makes the loop
 * usable — `PREVIEW_UNAVAILABLE` tells an agent to stop asking for pictures and
 * carry on with the rest of the API, `PREVIEW_FAILED` tells it to try again —
 * and it is the sort of thing that is easy to get right once and lose in a
 * later refactor, so it is checked here rather than left to the browser test.
 *
 * The rasterizer and the font loader are both injected, so nothing here starts
 * a browser or touches the network.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentOperation,
  closeTestDatabases,
  newAgentDeck,
  storedPresentation,
  testAgentContext,
} from '../agent/testDeck'
import { presentationRevision } from '../domain/revision'
import type { SlidePreviewView } from '../agent/operations/preview'
import { createPresentation } from '../domain/presentation'
import { deckPages } from '../domain/pages'
import { isAgentImage } from '../agent/image'
import type { PreviewAssetReader } from '../agent/preview'
import { PreviewBrowserUnavailableError } from './chromium'
import { NO_PREVIEW_FONTS } from './fonts'
import { slidePreviewRenderer } from './preview'
import {
  MAX_PREVIEW_BYTES,
  pngPixelSize,
  type RasterImage,
  type RasterRequest,
} from './rasterize'

const NO_ASSETS: PreviewAssetReader = { getAsset: () => Promise.resolve(null) }

/** Fonts that are always "already fetched", so no test reaches the network. */
const noFonts = () => Promise.resolve(NO_PREVIEW_FONTS)

const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

afterEach(closeTestDatabases)

function request(scale = 1) {
  const presentation = createPresentation({ title: 'Komposisjon' })
  const page = deckPages(presentation)[1]
  return { presentation, page, scale, assets: NO_ASSETS }
}

describe('det som kommer ut', () => {
  it('bruker forfatter og år i både henvisningen og den avledede referansesiden', async () => {
    let html = ''
    const context = testAgentContext({
      preview: slidePreviewRenderer((raster) => {
        html = raster.html
        return Promise.resolve({
          bytes: FAKE_PNG, width: 1600, height: 900, fontsReady: true, warnings: [],
        })
      }, { fonts: noFonts }),
    })
    const deck = await newAgentDeck(context)
    const added = await agentOperation<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'Kilden',
      authors: 'Hansen, Ola; Berg, Eli',
      year: '2024',
    })
    await agentOperation(context, 'set_zone_text', {
      presentationId: deck.presentationId, slideId: deck.slideId, nodeId: deck.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Se kilden' }, { citation: [added.reference.id] }] }],
    })
    const presentation = await storedPresentation(context, deck.presentationId)
    await context.repository.updateUserSettings(null, { citationStyle: 'author-year' })
    const reads = vi.spyOn(context.repository, 'getUserSettings')

    await agentOperation(context, 'render_slide_preview', {
      presentationId: deck.presentationId, slideId: deck.slideId,
    })
    expect(html).toMatch(/<sup[^>]*>Hansen et al\., 2024<\/sup>/)
    const references = deckPages(presentation, { citationStyle: 'author-year' })
      .find((page) => page.kind === 'reference-slide')
    if (!references) throw new Error('Fant ikke referansesiden.')
    await agentOperation(context, 'render_slide_preview', {
      presentationId: deck.presentationId, slideId: references.id,
    })
    expect(html).toContain('Hansen et al., 2024 — ')
    expect(html).not.toMatch(/>1\. /)
    expect(reads).toHaveBeenCalledTimes(2)
    expect(await storedPresentation(context, deck.presentationId)).toEqual(presentation)
  })

  it.each([false, true])('bruker eierens fremdriftsvalg %s gjennom agentens preview-flyt', async (includeReferences) => {
    let html = ''
    const context = testAgentContext({
      preview: slidePreviewRenderer((raster) => {
        html = raster.html
        return Promise.resolve({
          bytes: FAKE_PNG,
          width: 1600,
          height: 900,
          fontsReady: true,
          warnings: [],
        })
      }, { fonts: noFonts }),
    })
    const deck = await newAgentDeck(context)
    const added = await agentOperation<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'Kilden',
    })
    await agentOperation(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ citation: [added.reference.id] }] }],
    })
    const presentation = await storedPresentation(context, deck.presentationId)
    presentation.includeReferencesInProgress = !includeReferences
    await context.repository.savePresentation(presentation)
    await context.repository.updateUserSettings(null, {
      includeReferencesInProgress: includeReferences,
    })

    const view = await agentOperation<SlidePreviewView>(context, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })

    const width = includeReferences ? '50%' : '100%'
    expect(html).toMatch(new RegExp(`data-testid="slide-progress-fill" style="[^"]*width:${width};`))
    expect(view.revision).toBe(presentationRevision(presentation))
    expect(await storedPresentation(context, deck.presentationId)).toEqual(presentation)
  })

  it('er et AgentImage med rendererens egne tall i det', async () => {
    const seen: RasterRequest[] = []
    const render = slidePreviewRenderer(
      (raster): Promise<RasterImage> => {
        seen.push(raster)
        return Promise.resolve({
          bytes: FAKE_PNG,
          width: 800,
          height: 450,
          fontsReady: true,
          warnings: [],
        })
      },
      { fonts: noFonts },
    )

    const outcome = await render(request(0.5))
    if (!outcome.ok) throw new Error(outcome.error.message)

    expect(isAgentImage(outcome.value.image)).toBe(true)
    expect(outcome.value.image.mimeType).toBe('image/png')
    expect(outcome.value.image.width).toBe(800)
    expect(outcome.value.image.height).toBe(450)
    expect(outcome.value.image.bytes).toBe(FAKE_PNG)

    // The document handed over is the logical design space; the scale is the
    // rasterizer's business.
    expect(seen[0].width).toBe(1600)
    expect(seen[0].height).toBe(900)
    expect(seen[0].scale).toBe(0.5)
    expect(seen[0].html).toContain('class="slide"')
  })

  it('setter advarslene om filer foran advarslene om fonter', async () => {
    // A missing file changes *what* is in the picture; a missing font only
    // changes the face it is set in. The more serious one is read first.
    const render = slidePreviewRenderer(
      () =>
        Promise.resolve({
          bytes: FAKE_PNG,
          width: 1600,
          height: 900,
          fontsReady: false,
          warnings: ['Webfontene var ikke klare.'],
        }),
      { fonts: noFonts },
    )

    const presentation = createPresentation({ title: 'Med advarsler' })
    const outcome = await render({
      presentation,
      page: deckPages(presentation)[1],
      scale: 1,
      assets: {
        getAsset: () => Promise.reject(new Error('lageret svarte ikke')),
      },
    })
    if (!outcome.ok) throw new Error(outcome.error.message)

    expect(outcome.value.fontsReady).toBe(false)
    expect(outcome.value.warnings).toEqual(['Webfontene var ikke klare.'])
  })
})

describe('de to måtene det kan feile på', () => {
  it('en manglende nettleser er PREVIEW_UNAVAILABLE', async () => {
    const render = slidePreviewRenderer(
      () => Promise.reject(new PreviewBrowserUnavailableError('Fant ingen Chromium.')),
      { fonts: noFonts },
    )

    const outcome = await render(request())
    if (outcome.ok) throw new Error('Forventet en feil.')
    expect(outcome.error.code).toBe('PREVIEW_UNAVAILABLE')
    expect(outcome.error.message).toContain('Fant ingen Chromium')
  })

  it('alt annet er PREVIEW_FAILED, med noe å prøve igjen på', async () => {
    const render = slidePreviewRenderer(() => Promise.reject(new Error('siden krasjet')), {
      fonts: noFonts,
    })

    const outcome = await render(request(0.25))
    if (outcome.ok) throw new Error('Forventet en feil.')
    expect(outcome.error.code).toBe('PREVIEW_FAILED')
    expect(outcome.error.message).toContain('siden krasjet')
    expect(outcome.error.details).toMatchObject({ scale: 0.25 })
  })

  it('en font som ikke kunne hentes stopper ikke previewet', async () => {
    // The picture is still worth looking at for composition; what must not
    // happen is that it silently claims to be the deck's own type.
    const render = slidePreviewRenderer(
      (raster) =>
        Promise.resolve({
          bytes: FAKE_PNG,
          width: 1600,
          height: 900,
          fontsReady: false,
          warnings: [`Manglet ${raster.fontFamilies.join(', ')}.`],
        }),
      { fonts: (families) => Promise.resolve({ css: '', linkFamilies: [...families], families: [...families] }) },
    )

    const outcome = await render(request())
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.value.fontsReady).toBe(false)
    expect(outcome.value.warnings[0]).toContain('Quicksand')
  })
})

describe('et bilde som er for stort', () => {
  it('avvises med tallene å bestemme etter, ikke med en avkuttet respons', async () => {
    // Serverless platforms cut a response off, and the JSON and MCP framings
    // base64-encode these bytes. A truncated response is an error an agent
    // cannot read; this one it can act on.
    const render = slidePreviewRenderer(
      () =>
        Promise.resolve({
          bytes: new Uint8Array(MAX_PREVIEW_BYTES + 1),
          width: 3200,
          height: 1800,
          fontsReady: true,
          warnings: [],
        }),
      { fonts: noFonts },
    )

    const outcome = await render(request(2))
    if (outcome.ok) throw new Error('Forventet en feil.')
    expect(outcome.error.code).toBe('PREVIEW_FAILED')
    expect(outcome.error.message).toContain('scale')
    expect(outcome.error.details).toMatchObject({
      byteLength: MAX_PREVIEW_BYTES + 1,
      maxByteLength: MAX_PREVIEW_BYTES,
      scale: 2,
    })
  })

  it('slipper gjennom et bilde på grensen', async () => {
    const render = slidePreviewRenderer(
      () =>
        Promise.resolve({
          bytes: new Uint8Array(MAX_PREVIEW_BYTES),
          width: 1600,
          height: 900,
          fontsReady: true,
          warnings: [],
        }),
      { fonts: noFonts },
    )

    expect((await render(request())).ok).toBe(true)
  })
})

describe('PNG-hodet', () => {
  it('leses av filen, og er null for noe som ikke er en PNG', () => {
    // The size an agent reasons about comes from the file, not from the
    // arithmetic that asked for it.
    expect(pngPixelSize(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(pngPixelSize(new Uint8Array(40))).toBeNull()

    const png = new Uint8Array(40)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    png.set([0, 0, 0, 13], 8)
    png.set([0x49, 0x48, 0x44, 0x52], 12)
    new DataView(png.buffer).setUint32(16, 1600)
    new DataView(png.buffer).setUint32(20, 900)
    expect(pngPixelSize(png)).toEqual({ width: 1600, height: 900 })
  })
})
