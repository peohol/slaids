/**
 * The preview, composed: Agent Core's renderer, built from a rasterizer.
 *
 * `src/render/` exists to hold one dependency neither Agent Core nor the
 * transport layers are allowed to have — React, the app's stylesheets and a
 * browser — and to hold it in one place so the rule stays checkable rather than
 * remembered. `IMPLEMENTATION_PLAN.md` §44, phase 5: Agent Core states what a
 * preview *is* (`src/agent/preview.ts`) and asks for one through
 * `AgentContext`; this directory is the implementation, and `src/server/` wires
 * the two together at the deployment seam by importing exactly this file.
 *
 * Nothing in the app imports any of it: a preview is drawn on a server, and the
 * browser already has the real thing on screen. `boundary.test.ts` enforces both
 * halves of that, and the client bundle is byte for byte what it was before the
 * preview existed.
 *
 * Five steps, and none of them decides anything about how a slide looks:
 *
 *   fonts → assets → document → pixels → AgentImage
 *
 * The rasterizer and the font loader are parameters rather than imports, which
 * is what makes the interesting steps testable without a browser or a network
 * and, just as much, what keeps this file honest: everything visual is upstream
 * of them, in components the editor also renders.
 *
 * Failures are classified once, here, into the two codes an agent acts on
 * differently — "this installation cannot draw previews, stop asking" and "it
 * can, and this one broke, try again". `chromium.ts` marks the first case with
 * its own error type; anything else is the second.
 */

import type {
  SlidePreviewOutcome,
  SlidePreviewRenderer,
  SlidePreviewRequest,
} from '../agent/preview'
import { agentImage } from '../agent/image'
import { loadPreviewAssets } from './assets'
import { previewDocument } from './document'
import {
  googleFontLoader,
  previewFontFamilies,
  previewLocalFonts,
  type PreviewFontLoader,
} from './fonts'
import { PreviewBrowserUnavailableError, chromiumRasterizer, type ChromiumRasterizerOptions } from './chromium'
import { MAX_PREVIEW_BYTES, PREVIEW_MIME_TYPE, type SlideRasterizer } from './rasterize'

export interface SlidePreviewRendererOptions {
  /** Where the theme's faces come from. Defaults to fetching and caching them. */
  fonts?: PreviewFontLoader
}

export function slidePreviewRenderer(
  rasterize: SlideRasterizer,
  options: SlidePreviewRendererOptions = {},
): SlidePreviewRenderer {
  const loadFonts = options.fonts ?? googleFontLoader()

  return async function render(request: SlidePreviewRequest): Promise<SlidePreviewOutcome> {
    try {
      // Fonts the deck names that this renderer cannot be given at all. They are
      // never fetched and never waited for, so nothing downstream can notice
      // them: an empty family list is indistinguishable from a family list that
      // arrived. Read here, and folded into the answer below.
      const localFonts = previewLocalFonts(request.presentation.theme)
      const fonts = await loadFonts(previewFontFamilies(request.presentation.theme))
      const assets = await loadPreviewAssets(request.page, request.assets)
      const document = previewDocument({
        presentation: request.presentation,
        includeReferencesInProgress: request.includeReferencesInProgress,
        citationStyle: request.citationStyle,
        page: request.page,
        assets: assets.source,
        fonts,
      })

      const raster = await rasterize({
        html: document.html,
        width: document.width,
        height: document.height,
        scale: request.scale,
        fontFamilies: document.fontFamilies,
      })

      if (raster.bytes.byteLength > MAX_PREVIEW_BYTES) {
        // Answered rather than sent: the JSON and MCP framings base64-encode
        // these bytes, and a response the platform truncates is an error an
        // agent cannot read. Lowering the scale is the fix, so that is what it
        // is told, with the numbers to decide by.
        return {
          ok: false,
          error: {
            code: 'PREVIEW_FAILED',
            message: `Previewet ble ${Math.round(raster.bytes.byteLength / 1024)} kB, som er mer enn grensen på ${Math.round(MAX_PREVIEW_BYTES / 1024)} kB. Be om et mindre bilde med en lavere «scale».`,
            details: {
              byteLength: raster.bytes.byteLength,
              maxByteLength: MAX_PREVIEW_BYTES,
              scale: request.scale,
            },
          },
        }
      }

      return {
        ok: true,
        value: {
          image: agentImage({
            mimeType: PREVIEW_MIME_TYPE,
            bytes: raster.bytes,
            width: raster.width,
            height: raster.height,
          }),
          // Two ways the picture can be in the wrong type, and `fontsReady` has
          // to deny both. The rasterizer answers for the faces it was asked to
          // wait for; a local font was never among them, because there was
          // nothing to fetch — and a renderer with nothing to wait for waits
          // successfully. So the deck's own fonts decide too.
          fontsReady: raster.fontsReady && localFonts.length === 0,
          // The asset warnings first: a missing file changes what is in the
          // picture, where a missing font only changes the face it is set in.
          warnings: [...assets.warnings, ...raster.warnings, ...localFontWarning(localFonts)],
        },
      }
    } catch (error) {
      if (error instanceof PreviewBrowserUnavailableError) {
        return { ok: false, error: { code: 'PREVIEW_UNAVAILABLE', message: error.message } }
      }
      return {
        ok: false,
        error: {
          code: 'PREVIEW_FAILED',
          message: `Kunne ikke rendre previewet: ${messageOf(error)}`,
          details: { slideId: request.page.id, scale: request.scale },
        },
      }
    }
  }
}

/**
 * The renderer a deployment gets.
 *
 * One line, and it is the only place the browser and the React renderer are
 * joined — so `src/server/` imports exactly this and nothing else from here.
 */
export function chromiumSlidePreviewRenderer(
  options: ChromiumRasterizerOptions & SlidePreviewRendererOptions = {},
): SlidePreviewRenderer {
  return slidePreviewRenderer(chromiumRasterizer(options), options)
}

/**
 * What to say about a font nobody can send.
 *
 * Deliberately not an error: the picture is worth looking at — the layout, the
 * colours and the composition are the deck's — and refusing to draw a deck
 * because it is set in Calibri would make the whole loop unusable for documents
 * written in the editor. What must not happen is the picture being passed off
 * as the deck's own type, which is why this comes with `fontsReady: false`.
 */
function localFontWarning(localFonts: readonly string[]): string[] {
  if (localFonts.length === 0) return []
  return [
    `Temaet bruker ${localFonts.map((name) => `«${name}»`).join(' og ')}, som ikke er webfonter Slaids kan hente – de må være installert på maskinen som tegner. Previewet er derfor tegnet med en reservefont: komposisjonen stemmer, men linjelengder kan avvike.`,
  ]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'ukjent feil'
}
