/**
 * What the preview document actually contains.
 *
 * The claim this file has to hold is not "a picture came out" — a browser will
 * happily photograph an empty page — but that the markup handed to the browser
 * *is the app's*. So the assertions are about identity rather than about
 * plausibility: the zone boxes are the rects `computeSlideGeometry` hands the
 * editor, the class names are the ones `slide.css` styles, the stylesheets are
 * the app's own files, and a stored picture arrives as the same `<img>` the
 * editor draws.
 *
 * The decks are built through Agent Core, so nothing here can render a slide
 * the rules would have refused. Everything runs without a browser: rasterizing
 * is one injected function away, and `agentLoop.test.ts` covers that end.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  agentOperation,
  closeTestDatabases,
  newAgentDeck,
  storedPresentation,
  testAgentContext,
  zoneIdsOf,
  type NewDeck,
} from '../agent/testDeck'
import { computeSlideGeometry } from '../domain/geometry'
import { collectLeaves } from '../domain/layout'
import { geometryForTheme } from '../domain/metrics'
import { deckPages, type DeckPage } from '../domain/pages'
import { findContentSlide } from '../domain/presentation'
import { sectionAt } from '../domain/testDecks'
import { realImageBase64 } from '../domain/testImages'
import type { AgentContext } from '../agent/types'
import type { Presentation } from '../domain/types'
import { dataUrlAssetSource, loadPreviewAssets, pageAssetIds } from './assets'
import { previewDocument } from './document'
import { PREVIEW_STYLESHEETS } from './styles'

afterEach(closeTestDatabases)

const SVG_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#3b82f6"/></svg>'

function pageFor(presentation: Presentation, id: string): DeckPage {
  const page = deckPages(presentation).find((candidate) => candidate.id === id)
  if (!page) throw new Error(`Ingen side med id ${id}.`)
  return page
}

function render(presentation: Presentation, pageId: string, urls = new Map<string, string>()) {
  return previewDocument({
    presentation,
    page: pageFor(presentation, pageId),
    assets: dataUrlAssetSource(urls),
  })
}

function paragraphs(...lines: string[]) {
  return lines.map((text) => ({ type: 'paragraph', spans: [{ text }] }))
}

async function deckWithText(
  context: AgentContext,
  text: string,
): Promise<{ deck: NewDeck; presentation: Presentation }> {
  const deck = await newAgentDeck(context)
  await agentOperation(context, 'set_zone_text', {
    presentationId: deck.presentationId,
    slideId: deck.slideId,
    nodeId: deck.rootNodeId,
    blocks: paragraphs(text),
  })
  return { deck, presentation: await storedPresentation(context, deck.presentationId) }
}

describe('en enkel slide', () => {
  it('rendres med Slaids’ egne klassenavn og sitt eget design-rom', async () => {
    const context = testAgentContext()
    const { deck, presentation } = await deckWithText(context, 'Én enkel slide')
    const document = render(presentation, deck.slideId)

    expect(document.width).toBe(1600)
    expect(document.height).toBe(900)
    expect(document.html).toContain('<!doctype html>')
    expect(document.html).toContain('class="slide"')
    expect(document.html).toContain(`data-slide-id="${deck.slideId}"`)
    expect(document.html).toContain('width:1600px;height:900px')
    expect(document.html).toContain(`background:${presentation.slides[0].backgroundColor}`)
    expect(document.html).toContain('Én enkel slide')
  })

  it('plasserer sonen på nøyaktig den rect-en geometrimotoren gir editoren', async () => {
    const context = testAgentContext()
    const { deck, presentation } = await deckWithText(context, 'Sone')
    const slide = findContentSlide(presentation, deck.slideId)
    if (!slide) throw new Error('Fant ikke sliden.')

    const geometry = computeSlideGeometry(slide, geometryForTheme(presentation.theme))
    const rect = geometry.rects.get(collectLeaves(slide.root)[0].id)
    if (!rect) throw new Error('Ingen rect for rotsonen.')

    const document = render(presentation, deck.slideId)
    expect(document.html).toContain(
      `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`,
    )
  })

  it('bærer appens egne stilark, i den rekkefølgen appen laster dem', async () => {
    const context = testAgentContext()
    const { deck, presentation } = await deckWithText(context, 'Stil')
    const document = render(presentation, deck.slideId)

    // Not "contains some CSS": these are the two files, and the reset has to
    // come before the sheet that assumes it.
    const first = document.html.indexOf(PREVIEW_STYLESHEETS[0].slice(0, 120))
    const second = document.html.indexOf(PREVIEW_STYLESHEETS[1].slice(0, 120))
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
  })

  it('kjører ingenting: ingen script-tagger i dokumentet', async () => {
    const context = testAgentContext()
    const { deck, presentation } = await deckWithText(context, 'Statisk')
    expect(render(presentation, deck.slideId).html).not.toContain('<script')
  })
})

describe('en slide med flere soner og tekst', () => {
  it('gjengir hver sone der geometrien sier, med teksten sin', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)

    await agentOperation(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      axis: 'x',
      weights: [1, 2],
    })
    const zones = await zoneIdsOf(context, deck.presentationId, deck.slideId)
    expect(zones).toHaveLength(2)

    await agentOperation(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: zones[0],
      blocks: paragraphs('Venstre side', 'Med to avsnitt'),
    })
    await agentOperation(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: zones[1],
      kind: 'titled-card',
      title: [{ text: 'Høyre kort' }],
    })
    await agentOperation(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      spans: [{ text: 'To soner' }],
    })

    const presentation = await storedPresentation(context, deck.presentationId)
    const document = render(presentation, deck.slideId)
    const geometry = computeSlideGeometry(
      findContentSlide(presentation, deck.slideId)!,
      geometryForTheme(presentation.theme),
    )

    for (const zoneId of zones) {
      const rect = geometry.rects.get(zoneId)
      if (!rect) throw new Error(`Ingen rect for ${zoneId}.`)
      expect(document.html).toContain(`data-node-id="${zoneId}"`)
      expect(document.html).toContain(
        `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`,
      )
    }

    expect(document.html).toContain('Venstre side')
    expect(document.html).toContain('Med to avsnitt')
    expect(document.html).toContain('Høyre kort')
    expect(document.html).toContain('To soner')
    // The static renderer's own markup, not something this layer wrote.
    expect(document.html).toContain('class="rd-p"')
    expect(document.html).toContain('class="card-header"')
    expect(document.html).toContain('data-content-kind="titled-card"')
  })
})

describe('bilder og SVG', () => {
  async function deckWithAsset(
    context: AgentContext,
    place: 'raster' | 'svg',
  ): Promise<{ deck: NewDeck; assetId: string; presentation: Presentation }> {
    const deck = await newAgentDeck(context)
    const stored = await agentOperation<{ assetId: string }>(
      context,
      place === 'raster' ? 'upload_asset' : 'create_svg_asset',
      place === 'raster'
        ? {
            presentationId: deck.presentationId,
            name: 'figur.png',
            content: { encoding: 'base64', data: realImageBase64.png },
          }
        : { presentationId: deck.presentationId, name: 'figur', svgMarkup: SVG_MARKUP },
    )
    await agentOperation(context, 'set_zone_asset', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      assetId: stored.assetId,
    })
    return {
      deck,
      assetId: stored.assetId,
      presentation: await storedPresentation(context, deck.presentationId),
    }
  }

  it('tegner et rasterbilde som den samme img-en editoren tegner', async () => {
    const context = testAgentContext()
    const { deck, assetId, presentation } = await deckWithAsset(context, 'raster')
    const assets = await loadPreviewAssets(pageFor(presentation, deck.slideId), context.repository)

    expect(assets.warnings).toEqual([])
    const url = assets.source.resolveSync?.(assetId)
    expect(url?.startsWith('data:image/png;base64,')).toBe(true)

    const document = previewDocument({
      presentation,
      page: pageFor(presentation, deck.slideId),
      assets: assets.source,
    })
    expect(document.html).toContain('class="image-panel__img"')
    expect(document.html).toContain(`src="${url}"`)
    // The crop is the only thing about a picture that is written inline; the
    // covering itself is a stylesheet rule, so a preview and the editor cannot
    // disagree about it.
    expect(document.html).toContain('object-position:50% 50%')
    expect(document.html).not.toContain('Laster bilde')
  })

  it('tegner en SVG gjennom img, aldri som markup i dokumentet', async () => {
    const context = testAgentContext()
    const { deck, assetId, presentation } = await deckWithAsset(context, 'svg')
    const assets = await loadPreviewAssets(pageFor(presentation, deck.slideId), context.repository)

    const url = assets.source.resolveSync?.(assetId)
    expect(url?.startsWith('data:image/svg+xml;base64,')).toBe(true)

    const document = previewDocument({
      presentation,
      page: pageFor(presentation, deck.slideId),
      assets: assets.source,
    })
    expect(document.html).toContain(`src="${url}"`)
    // The figure is a picture source, never markup — so nothing in it can run,
    // whatever `domain/svg.ts` let through.
    expect(document.html).not.toContain('<svg')
    expect(document.html).not.toContain('<script')
  })

  it('finner filene en side bruker, og ingen på forsiden', async () => {
    const context = testAgentContext()
    const { deck, assetId, presentation } = await deckWithAsset(context, 'raster')

    expect(pageAssetIds(pageFor(presentation, deck.slideId))).toEqual([assetId])
    expect(pageAssetIds(pageFor(presentation, presentation.slides[0].id))).toEqual([])
  })

  it('sier fra om en fil lageret ikke har, i stedet for å tegne den stille bort', async () => {
    const context = testAgentContext()
    const { deck, assetId, presentation } = await deckWithAsset(context, 'raster')
    const assets = await loadPreviewAssets(pageFor(presentation, deck.slideId), {
      getAsset: () => Promise.resolve(null),
    })

    expect(assets.warnings).toHaveLength(1)
    expect(assets.warnings[0]).toContain(assetId)

    const document = previewDocument({
      presentation,
      page: pageFor(presentation, deck.slideId),
      assets: assets.source,
    })
    // The renderer's own placeholder, which is what the editor would show too.
    expect(document.html).toContain('image-panel__empty')
  })
})

describe('forsiden og de avledede sidene', () => {
  it('rendres av den samme sidemodellen som presentasjonsmodus', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)
    const stored = await storedPresentation(context, deck.presentationId)
    await agentOperation(context, 'set_section', {
      presentationId: deck.presentationId,
      slideId: stored.slides[0].id,
      title: 'Tittelen',
      subtitle: 'Undertittelen',
    })

    const presentation = await storedPresentation(context, deck.presentationId)
    const front = sectionAt(presentation, 0)
    const document = render(presentation, front.id)

    expect(document.html).toContain('data-page-kind="authored-slide"')
    expect(document.html).toContain('section-pill--title')
    expect(document.html).toContain('section-pill--subtitle')
    expect(document.html).toContain('Tittelen')
    expect(document.html).toContain('Undertittelen')
    expect(document.html).toContain(`background:${front.accentColor}`)
  })

  it('nummererer citations fra hele dekket, slik publikum ser dem', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)
    const added = await agentOperation<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'En kilde',
      authors: 'Noen',
      url: 'https://example.test',
      year: '2026',
    })
    await agentOperation(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.rootNodeId,
      blocks: [
        {
          type: 'paragraph',
          spans: [{ text: 'Sitert' }, { citation: [added.reference.id] }],
        },
      ],
    })

    const presentation = await storedPresentation(context, deck.presentationId)
    const document = render(presentation, deck.slideId)

    // The pill's label is derived from first use across the deck; an empty
    // numbering would draw no pill at all, which is what this rules out.
    expect(document.html).toContain('rd-citation')
    expect(document.html).toContain('>1<')
  })

  it('rendrer en avledet referanseside, og sier at den er avledet', async () => {
    const context = testAgentContext()
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

    const presentation = await storedPresentation(context, deck.presentationId)
    const derived = deckPages(presentation).find((page) => page.kind === 'reference-slide')
    if (!derived) throw new Error('Ingen referanseside ble avledet.')

    const document = render(presentation, derived.id)
    expect(document.html).toContain('data-page-kind="reference-slide"')
    expect(document.html).toContain('Kilden')
  })
})

describe('fontene', () => {
  it('ber om nøyaktig de webfontene temaet navngir, fra appens egen URL', async () => {
    const context = testAgentContext()
    const { deck, presentation } = await deckWithText(context, 'Font')
    const document = render(presentation, deck.slideId)

    expect(document.fontFamilies).toEqual(['Quicksand', 'Atkinson Hyperlegible Next'])
    expect(document.html).toContain('fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700')
    expect(document.html).toContain('rel="preconnect" href="https://fonts.gstatic.com"')
  })

  it('baker inn fontene når de allerede er hentet, og lenker da ingenting', async () => {
    const context = testAgentContext()
    const { deck, presentation } = await deckWithText(context, 'Innbakt')

    const document = previewDocument({
      presentation,
      page: pageFor(presentation, deck.slideId),
      assets: dataUrlAssetSource(new Map()),
      fonts: {
        css: "@font-face { font-family: 'Quicksand'; src: url(data:font/woff2;base64,AQID); }",
        linkFamilies: [],
        families: ['Quicksand'],
      },
    })

    expect(document.html).toContain('url(data:font/woff2;base64,AQID)')
    // Nothing left for the page to fetch, which is the whole point.
    expect(document.html).not.toContain('fonts.googleapis.com')
    expect(document.fontFamilies).toEqual(['Quicksand'])
    // The faces come before the sheets that use the family.
    expect(document.html.indexOf('@font-face')).toBeLessThan(
      document.html.indexOf(PREVIEW_STYLESHEETS[1].slice(0, 120)),
    )
  })

  it('lenker det som ikke kunne bakes inn, som en reserve', async () => {
    const context = testAgentContext()
    const { deck, presentation } = await deckWithText(context, 'Reserve')

    const document = previewDocument({
      presentation,
      page: pageFor(presentation, deck.slideId),
      assets: dataUrlAssetSource(new Map()),
      fonts: { css: '', linkFamilies: ['Quicksand'], families: ['Quicksand'] },
    })

    expect(document.html).toContain('fonts.googleapis.com/css2?family=Quicksand')
  })

  it('ber om ingenting for et tema satt i systemstakken', async () => {
    const context = testAgentContext()
    const { deck, presentation } = await deckWithText(context, 'Systemfont')
    const local: Presentation = {
      ...presentation,
      theme: {
        ...presentation.theme,
        headingFontFamily: 'Arial, Helvetica, sans-serif',
        bodyFontFamily: 'Arial, Helvetica, sans-serif',
      },
    }

    const document = previewDocument({
      presentation: local,
      page: pageFor(local, deck.slideId),
      assets: dataUrlAssetSource(new Map()),
    })

    expect(document.fontFamilies).toEqual([])
    expect(document.html).not.toContain('fonts.googleapis.com')
  })
})

describe('en interaktiv slide', () => {
  const APP =
    '<!doctype html><html><body><p class="miniapp-hemmelig">Teller</p><script>let n = 0</script></body></html>'

  async function deckWithApp(context: AgentContext) {
    const deck = await newAgentDeck(context)
    const view = await agentOperation<{ slideId: string }>(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      fileName: 'teller.html',
      html: APP,
    })
    return { slideId: view.slideId, presentation: await storedPresentation(context, deck.presentationId) }
  }

  it('rendres som forsiden: navnet og merkingen, og aldri appen', async () => {
    const context = testAgentContext()
    const { slideId, presentation } = await deckWithApp(context)
    const document = render(presentation, slideId)

    expect(document.html).toContain('data-testid="interactive-page"')
    expect(document.html).toContain(`data-slide-id="${slideId}"`)
    expect(document.html).toContain('teller')
    expect(document.html).toContain('data-testid="activate-interactive-inert"')
    // Nothing that could run, and nothing of the file: the preview is a
    // picture of the cover, on a server that never executes an upload.
    expect(document.html).not.toContain('<iframe')
    expect(document.html).not.toContain('<script')
    expect(document.html).not.toContain('<button')
    expect(document.html).not.toContain('miniapp-hemmelig')
    expect(document.html).not.toContain('let n = 0')
  })
})
