/**
 * The theme's web fonts, fetched here and embedded in the document.
 *
 * The obvious thing is to put the app's own `<link rel="stylesheet">` in the
 * preview document and let the browser fetch it, and that is what this file
 * replaced. It worked, and it cost **twelve seconds a picture**: a headless
 * Chromium in a serverless container fetches the stylesheet and every subset
 * file over a cold connection, on every page, because a page's HTTP cache is
 * not something the next invocation can rely on.
 *
 * So the fetching moves out of the browser and into this process, where it can
 * be done once per warm instance and handed to every later document as text.
 * Three things follow from that, and each of them is worth more than the
 * seconds:
 *
 *  - **the document fetches nothing.** A preview is then a pure function of the
 *    deck and this cache — no network inside the render, no per-request
 *    dependency on a font service being reachable, and nothing for a slow DNS
 *    lookup to add to a request an agent is waiting on.
 *  - **the same faces the editor measures.** The families and weights come from
 *    `domain/fonts.ts`, and the URL is the one `src/ui/fonts.ts` asks the
 *    browser for. One definition, two consumers.
 *  - **a failure is visible.** A family that cannot be fetched is reported, and
 *    the document falls back to linking it so the browser may still succeed —
 *    but `fontsReady` then says what happened rather than quietly photographing
 *    the fallback face.
 *
 * Only `fonts.gstatic.com` is ever fetched. The stylesheet is a response from
 * the outside naming URLs to retrieve, which is exactly the shape of a request
 * forgery, and an allowlist is the answer that does not depend on the response
 * being well-behaved.
 */

import { localFontsFor, webFontsFor } from '../domain/fonts'
import type { PresentationTheme } from '../domain/types'
import {
  inlineFontFaces,
  resetInlinedFontCache,
  type InlineFontOptions,
} from '../fonts/inlineFaces'

/** What a document needs in order to draw a theme's type. */
export interface PreviewFonts {
  /** `@font-face` rules with every file inlined as a `data:` URL. */
  css: string
  /** Families that could not be inlined, to be linked instead. */
  linkFamilies: string[]
  /** Every family the page needs, whichever way it arrives. */
  families: string[]
}

export type PreviewFontLoader = (families: readonly string[]) => Promise<PreviewFonts>

/** The web fonts a theme names. Nothing is fetched for a system stack. */
export function previewFontFamilies(theme: PresentationTheme): string[] {
  return webFontsFor([theme.headingFontFamily, theme.bodyFontFamily])
}

/**
 * The fonts in this theme that no renderer can be handed.
 *
 * The mirror image of the line above, and the reason it has to exist: a theme
 * set in Calibri asks for *nothing*, so everything about fetching succeeds
 * trivially and a rasterizer with an empty family list has nothing to wait for
 * and reports readiness. The document is still drawn in whatever the container
 * substituted. Asking the catalogue which fonts are local is what turns that
 * silence into an answer — see `preview.ts`.
 */
export function previewLocalFonts(theme: PresentationTheme): string[] {
  return localFontsFor([theme.headingFontFamily, theme.bodyFontFamily])
}

/** No fonts at all: a system stack, or a caller that wants none fetched. */
export const NO_PREVIEW_FONTS: PreviewFonts = { css: '', linkFamilies: [], families: [] }

export type GoogleFontLoaderOptions = InlineFontOptions

/** Test seam: forget what has been fetched, as a cold start would. */
export const resetPreviewFontCache = resetInlinedFontCache

/**
 * The preview's shape over the shared inliner.
 *
 * The fetching, the allowlist and the cache are `fonts/inlineFaces.ts` — the
 * miniapp sandbox needs the very same faces as `data:` URLs, for the very same
 * reason, and one engine is what keeps the two from disagreeing about which
 * weights a family has. What is preview-specific is only the vocabulary: a
 * family that could not be inlined is one this document will *link* instead,
 * and say so.
 */
export function googleFontLoader(options: GoogleFontLoaderOptions = {}): PreviewFontLoader {
  return async function load(families: readonly string[]): Promise<PreviewFonts> {
    if (families.length === 0) return NO_PREVIEW_FONTS
    const inlined = await inlineFontFaces(families, options)
    return { css: inlined.css, linkFamilies: inlined.missing, families: [...families] }
  }
}
