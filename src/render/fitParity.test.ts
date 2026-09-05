// @vitest-environment node
/**
 * What the headless fit estimator says, against what a browser actually draws.
 *
 * The estimator in `domain/fit.ts` is the fit gate for every caller without a
 * DOM — which is every agent call — and the browser's own measurement
 * (`state/measure.tsx`) is the gate for the editor. They are two answers to one
 * question, so where they disagree a slide is either refused although it draws
 * perfectly or accepted although it clips, and neither failure says anything
 * on its way past. The rest of the fit tests take the estimator's word for it;
 * this file is the one that checks the word.
 *
 * A figure is where the two came apart, and it came apart silently. A picture
 * standing in text is `width / aspect` tall — except that `.rd-image-wrapper`
 * is `max-height: 100%` inside a field of a definite height, so the browser
 * never draws one taller than the field it stands in: «a figure can never be
 * the cause of an overflow», as `slide.css` puts it. An estimator that only
 * knew the first half refused a portrait photograph at *every* width, because
 * the cap is the same at every width, and a test written from the same belief
 * would have agreed with it.
 *
 * So the comparison is made against the real thing: the same markup
 * `DeckPageView` draws, in the same stylesheet, in a real Chromium, measured
 * the way `measureElementOverflow` measures it — `scrollHeight - clientHeight`
 * over each `[data-fit-scroll]`. The decks are built through Agent Core, and
 * the one document the guard would have refused is placed past it deliberately,
 * because the whole question is what the browser does with a shape the
 * estimator has an opinion about.
 */

import { afterEach, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import {
  agentOperation,
  closeTestDatabases,
  newAgentDeck,
  storedPresentation,
  testAgentContext,
  type TestDeckContext,
} from '../agent/testDeck'
import { estimateDocHeight } from '../domain/fit'
import { computeSlideGeometry } from '../domain/geometry'
import { collectLeaves } from '../domain/layout'
import { geometryForTheme } from '../domain/metrics'
import { deckPages } from '../domain/pages'
import { findContentSlide } from '../domain/presentation'
import { imageNode } from '../domain/richdoc'
import type { CardBody, Rect, RichDoc, RichNode } from '../domain/types'
import { loadPreviewAssets } from './assets'
import { resolveExecutable } from './chromium'
import { previewDocument } from './document'

afterEach(closeTestDatabases)

/** A browser launch is seconds, and each case renders its own page. */
const BROWSER_TIMEOUT_MS = 180_000

const paragraph = (text: string): RichNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

/** A stored vector file of exactly these proportions. */
async function figure(
  context: TestDeckContext,
  presentationId: string,
  width: number,
  height: number,
): Promise<string> {
  const stored = await agentOperation<{ assetId: string }>(context, 'create_svg_asset', {
    presentationId,
    name: `figur-${width}x${height}`,
    svgMarkup: `<svg viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#3b82f6"/></svg>`,
  })
  return stored.assetId
}

/**
 * The estimate and the browser's own measurement of one field, side by side.
 *
 * The document is written straight into the stored zone rather than through
 * `set_zone_text`, and that is the point: the gate is what is being checked, so
 * it cannot also be what decides which documents get checked.
 */
async function compare(
  context: TestDeckContext,
  deck: { presentationId: string; slideId: string },
  doc: RichDoc,
): Promise<{ rect: Rect; estimated: number; measured: number }> {
  const presentation = await storedPresentation(context, deck.presentationId)
  const slide = findContentSlide(presentation, deck.slideId)
  if (!slide) throw new Error('Fant ikke sliden.')
  const leaf = collectLeaves(slide.root)[0]
  const content = leaf.content
  if (!content || !('body' in content)) throw new Error('Sonen har ingen tekstfelt.')
  ;(content.body as CardBody).subfields[0].doc = doc

  const rect = computeSlideGeometry(slide, geometryForTheme(presentation.theme)).rects.get(leaf.id)
  if (!rect) throw new Error('Sonen har ingen geometri.')

  const page = deckPages(presentation).find((candidate) => candidate.id === deck.slideId)
  if (!page) throw new Error('Fant ikke siden.')
  const assets = await loadPreviewAssets(page, context.repository)
  const html = previewDocument({ presentation, page, assets: assets.source }).html

  const resolved = await resolveExecutable(process.env as Record<string, string | undefined>)
  const browser = await puppeteer.launch({
    executablePath: resolved.executablePath,
    args: resolved.args,
    headless: true,
  })
  try {
    const tab = await browser.newPage()
    // The logical design space, unscaled: layout happens at the size the
    // geometry engine computes its rects in.
    await tab.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
    await tab.setContent(html, { waitUntil: 'load' })
    // `measureElementOverflow`'s own reading, written out here rather than
    // imported: that function needs a DOM, and this file's point is to compare
    // against what a browser does rather than against another module.
    const measured = await tab.evaluate(() => {
      let worst = 0
      for (const box of document.querySelectorAll('[data-fit-scroll]')) {
        const target = box as HTMLElement
        worst = Math.max(worst, target.scrollHeight - target.clientHeight)
      }
      return worst
    })
    return {
      rect,
      // The overflow the gate would report: everything the flow needs, less the
      // room it has. Clamped at zero, because the browser cannot report that
      // something fitted with room to spare.
      estimated: Math.max(
        0,
        estimateDocHeight(doc, rect.width, undefined, rect.height) - rect.height,
      ),
      measured,
    }
  } finally {
    await browser.close()
  }
}

/**
 * Within a line of body text.
 *
 * The estimator counts characters and the browser lays out glyphs, so the two
 * are never going to agree to the pixel on how tall a paragraph is. What they
 * must agree on is whether anything is hidden, and by roughly how much — a
 * disagreement of hundreds of pixels, which is what an uncapped figure gave,
 * is a different answer rather than a rounding difference.
 */
const TOLERANCE = 40

describe('den hodeløse fit-målingen mot en ekte nettleser', () => {
  it(
    'er enig om en portrettfigur, som fyller feltet uten å flyte over',
    async () => {
      const context = testAgentContext()
      const deck = await newAgentDeck(context)
      // 1:30 — uncapped this figure would need thirty columns' worth of height.
      const portrait = await figure(context, deck.presentationId, 100, 3000)
      await agentOperation(context, 'set_zone_text', {
        presentationId: deck.presentationId,
        slideId: deck.slideId,
        nodeId: deck.rootNodeId,
        blocks: [{ type: 'paragraph', spans: [{ text: 'Plassholder' }] }],
      })

      const full = await compare(context, deck, {
        type: 'doc',
        content: [imageNode(portrait, { widthPercent: 100, aspect: 1 / 30 })],
      })
      expect(full.measured).toBe(0)
      expect(full.estimated).toBe(0)

      // And at every other width, because the cap does not depend on the width.
      const half = await compare(context, deck, {
        type: 'doc',
        content: [imageNode(portrait, { widthPercent: 50, aspect: 1 / 30 })],
      })
      expect(half.measured).toBe(0)
      expect(half.estimated).toBe(0)
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'er enig om hvor mye teksten over en fylt figur flyter over med',
    async () => {
      const context = testAgentContext()
      const deck = await newAgentDeck(context)
      const portrait = await figure(context, deck.presentationId, 100, 300)
      await agentOperation(context, 'set_zone_text', {
        presentationId: deck.presentationId,
        slideId: deck.slideId,
        nodeId: deck.rootNodeId,
        blocks: [{ type: 'paragraph', spans: [{ text: 'Plassholder' }] }],
      })

      // The figure takes the whole field, so the line above it is what has
      // nowhere to go — and the overflow is that line's own height, not the
      // figure's uncapped one.
      const result = await compare(context, deck, {
        type: 'doc',
        content: [
          paragraph('En setning over figuren.'),
          imageNode(portrait, { widthPercent: 100, aspect: 1 / 3 }),
        ],
      })
      expect(result.measured).toBeGreaterThan(0)
      expect(Math.abs(result.estimated - result.measured)).toBeLessThanOrEqual(TOLERANCE)
      // Nowhere near the height the uncapped figure would have needed.
      expect(result.measured).toBeLessThan(result.rect.height)
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'er enig om en figur som er lavere enn feltet, der taket ikke gjelder',
    async () => {
      const context = testAgentContext()
      const deck = await newAgentDeck(context)
      const banner = await figure(context, deck.presentationId, 400, 100)
      await agentOperation(context, 'set_zone_text', {
        presentationId: deck.presentationId,
        slideId: deck.slideId,
        nodeId: deck.rootNodeId,
        blocks: [{ type: 'paragraph', spans: [{ text: 'Plassholder' }] }],
      })

      const result = await compare(context, deck, {
        type: 'doc',
        content: [
          paragraph('En setning over figuren.'),
          imageNode(banner, { widthPercent: 100, aspect: 4 }),
          paragraph('Og en under.'),
        ],
      })
      expect(result.measured).toBe(0)
      expect(result.estimated).toBe(0)
    },
    BROWSER_TIMEOUT_MS,
  )
})
