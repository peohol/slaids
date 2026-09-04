// @vitest-environment node
/**
 * What a preview may claim about the type it is drawn in.
 *
 * `fontsReady` is the only thing a preview asserts that the picture itself
 * cannot show: an agent judging whether a line is too long has to know whether
 * the glyphs are the deck's own. Getting it wrong is silent by construction,
 * which is why this file uses a real Chromium rather than a stubbed rasterizer.
 *
 * The failure it pins down was a hole rather than a mistake. The renderer
 * fetches the *web* fonts a theme names; a theme set in Calibri names none, so
 * the fetch succeeded trivially, the rasterizer had no family to wait for, and
 * "nothing to wait for" answered `true` — while the container, which has no
 * Calibri, drew something else entirely. The fit estimator meanwhile measured
 * Calibri's own metrics from the catalogue. Three parts agreeing on a font that
 * was nowhere in the picture.
 *
 * So the case below reaches into the seam and states both halves: the rasterizer
 * still reports readiness, because from where it stands nothing is missing, and
 * the composed preview no longer repeats the claim. See `render/preview.ts` and
 * the catalogue's web/local split in `domain/fonts.ts`.
 */

import { describe, expect, it } from 'vitest'
import { fontStackFor, GUARANTEED_FONT_IDS, FONT_OPTIONS, isGuaranteedFont } from '../domain/fonts'
import { deckPages } from '../domain/pages'
import { createPresentation } from '../domain/presentation'
import type { Presentation } from '../domain/types'
import type { PreviewAssetReader, SlidePreviewOutcome } from '../agent/preview'
import { chromiumRasterizer } from './chromium'
import { previewFontFamilies, previewLocalFonts } from './fonts'
import { slidePreviewRenderer } from './preview'
import type { RasterImage, RasterRequest, SlideRasterizer } from './rasterize'

/** A browser launch plus a font fetch is seconds, not milliseconds. */
const BROWSER_TIMEOUT_MS = 180_000

/** Quarter size: this file is about a boolean, not about pixels. */
const SCALE = 0.25

const NO_ASSETS: PreviewAssetReader = { getAsset: () => Promise.resolve(null) }

interface RasterCall {
  request: RasterRequest
  image: RasterImage
}

/**
 * The production rasterizer, with what it was asked and what it answered kept.
 *
 * The point of the whole file: `fontsReady` is composed from two sources, and
 * only one of them can see a local font. Watching the browser's own answer is
 * what lets the test say which half changed.
 */
function watched(): { rasterize: SlideRasterizer; calls: RasterCall[] } {
  const real = chromiumRasterizer()
  const calls: RasterCall[] = []
  return {
    calls,
    rasterize: async (request) => {
      const image = await real(request)
      calls.push({ request, image })
      return image
    },
  }
}

function deckSetIn(fontId: Parameters<typeof fontStackFor>[0], title: string): Presentation {
  const presentation = createPresentation({ title })
  const stack = fontStackFor(fontId)
  return {
    ...presentation,
    theme: { ...presentation.theme, headingFontFamily: stack, bodyFontFamily: stack },
  }
}

function render(
  rasterize: SlideRasterizer,
  presentation: Presentation,
): Promise<SlidePreviewOutcome> {
  return slidePreviewRenderer(rasterize)({
    presentation,
    page: deckPages(presentation)[1],
    scale: SCALE,
    assets: NO_ASSETS,
  })
}

function unwrap(outcome: SlidePreviewOutcome): { fontsReady: boolean; warnings: string[] } {
  if (!outcome.ok) throw new Error(`Previewet feilet: ${outcome.error.code} ${outcome.error.message}`)
  return { fontsReady: outcome.value.fontsReady, warnings: outcome.value.warnings }
}

const fontWarning = (warnings: string[]): string | undefined =>
  warnings.find((warning) => warning.includes('font') || warning.includes('Font'))

describe('hva et preview kan påstå om fonten', () => {
  it(
    'nekter å si at bildet er klart når temaet bruker en font ingen renderer kan få',
    async () => {
      // A deck a person made in the editor on a Windows machine. The agent
      // cannot choose Calibri — that is the other half of the contract, checked
      // below — but a document can hold it, and this is what a preview of that
      // document is allowed to say.
      const watcher = watched()
      const presentation = deckSetIn('calibri', 'Satt i Calibri')

      const preview = unwrap(await render(watcher.rasterize, presentation))

      // The seam, from the browser's side: nothing was requested, so nothing was
      // missing, so the rasterizer reported ready. Unchanged, and correct on its
      // own terms — this is precisely the hole the old contract fell through.
      expect(watcher.calls).toHaveLength(1)
      expect(watcher.calls[0].request.fontFamilies).toEqual([])
      expect(watcher.calls[0].image.fontsReady).toBe(true)

      // And the answer the agent gets, which is the one that has to be true.
      expect(preview.fontsReady).toBe(false)
      expect(fontWarning(preview.warnings)).toContain('Calibri')
      expect(fontWarning(preview.warnings)).toContain('reservefont')
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'ber om fontene et garantert tema navngir, og lar readiness følge dem',
    async () => {
      const watcher = watched()
      // The default theme, which is what `create_presentation` gives an agent:
      // Quicksand and Atkinson Hyperlegible Next, both fetchable.
      const presentation = createPresentation({ title: 'Satt i webfonter' })
      expect(previewLocalFonts(presentation.theme)).toEqual([])

      const preview = unwrap(await render(watcher.rasterize, presentation))

      expect(watcher.calls[0].request.fontFamilies).toEqual(
        previewFontFamilies(presentation.theme),
      )
      expect(watcher.calls[0].request.fontFamilies.length).toBeGreaterThan(0)

      // Readiness is now exactly "no font is missing", both ways. Asserted as an
      // equivalence rather than as `true`, because the faces come over the
      // network: a sandbox without one draws the fallback, and the contract is
      // that it says so — never that it renders in the wrong face quietly.
      expect(preview.fontsReady).toBe(fontWarning(preview.warnings) === undefined)
      // Whatever the network did, this deck names no font Slaids cannot fetch.
      expect(preview.warnings.some((warning) => warning.includes('ikke er webfonter'))).toBe(false)
    },
    BROWSER_TIMEOUT_MS,
  )

  it('lar agentens fontvalg være nøyaktig de previewet kan tegne', () => {
    // The two halves of the contract, compared directly: what `set_theme`
    // publishes is what a preview can promise, with no third list in between.
    for (const font of FONT_OPTIONS) {
      const theme = deckSetIn(font.id, 'Katalog').theme
      const selectable = GUARANTEED_FONT_IDS.includes(font.id)
      expect(selectable, font.id).toBe(isGuaranteedFont(font))
      expect(previewLocalFonts(theme).length === 0, font.id).toBe(selectable)
    }
    // And the split is a real one in both directions, so neither assertion above
    // is vacuously true.
    expect(GUARANTEED_FONT_IDS.length).toBeGreaterThan(0)
    expect(GUARANTEED_FONT_IDS.length).toBeLessThan(FONT_OPTIONS.length)
  })
})
