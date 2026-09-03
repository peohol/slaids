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

import { googleFontsHref, webFontsFor } from '../domain/fonts'
import type { PresentationTheme } from '../domain/types'
import { encodeBase64 } from '../agent/binary'

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

/** No fonts at all: a system stack, or a caller that wants none fetched. */
export const NO_PREVIEW_FONTS: PreviewFonts = { css: '', linkFamilies: [], families: [] }

/**
 * The one host a face may come from.
 *
 * Google's own CSS points here and nowhere else, so a URL that does not is
 * either a change nobody has reviewed or a response that is not Google's.
 */
const FONT_FILE_ORIGIN = 'https://fonts.gstatic.com/'

/**
 * A browser's `User-Agent`, because the stylesheet depends on it.
 *
 * The `css2` endpoint serves `woff2` with per-script subsets to a modern
 * browser and older, whole-alphabet `ttf` files to anything it does not
 * recognise. The preview is rendered *by* a modern browser, so asking as one is
 * both honest and several times smaller.
 */
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const FONT_FETCH_TIMEOUT_MS = 8000

const MIME_BY_EXTENSION: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

export interface GoogleFontLoaderOptions {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

/** Per-family, per-instance. A failure is forgotten so a later call can retry. */
const cache = new Map<string, Promise<string>>()

/** Test seam: forget what has been fetched, as a cold start would. */
export function resetPreviewFontCache(): void {
  cache.clear()
}

export function googleFontLoader(options: GoogleFontLoaderOptions = {}): PreviewFontLoader {
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? FONT_FETCH_TIMEOUT_MS

  return async function load(families: readonly string[]): Promise<PreviewFonts> {
    if (families.length === 0) return NO_PREVIEW_FONTS

    const sheets: string[] = []
    const linkFamilies: string[] = []

    await Promise.all(
      families.map(async (family) => {
        let pending = cache.get(family)
        if (!pending) {
          pending = inlineFamily(family, doFetch, timeoutMs)
          cache.set(family, pending)
          // A family that failed must not stay failed for the life of the
          // instance: the same rule `src/ui/fonts.ts` follows in the browser.
          pending.catch(() => cache.delete(family))
        }
        try {
          sheets.push(await pending)
        } catch {
          linkFamilies.push(family)
        }
      }),
    )

    return { css: sheets.join('\n'), linkFamilies, families: [...families] }
  }
}

/**
 * One family's `@font-face` rules, with the files in them.
 *
 * `googleFontsHref` asks for every weight in `FONT_WEIGHTS` — the ones the slide
 * renderer can ask for — so a heading pill's 700 is downloaded even on a slide
 * that has no bold text. That is the same reason `src/ui/fonts.ts` loads them
 * explicitly in the browser: a face that is missing when the picture is taken is
 * a picture of the wrong type.
 */
async function inlineFamily(
  family: string,
  doFetch: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<string> {
  const stylesheet = await text(googleFontsHref(family), doFetch, timeoutMs)
  const urls = [...stylesheet.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].trim())
  if (urls.length === 0) {
    throw new Error(`Stilarket for ${family} inneholder ingen fontfiler.`)
  }

  const inlined = new Map<string, string>()
  await Promise.all(
    urls.map(async (url) => {
      const bare = url.replace(/^['"]|['"]$/g, '')
      if (!bare.startsWith(FONT_FILE_ORIGIN)) {
        throw new Error(`Fontfilen ${bare} ligger ikke på ${FONT_FILE_ORIGIN}.`)
      }
      const bytes = await binary(bare, doFetch, timeoutMs)
      inlined.set(url, `data:${mimeFor(bare)};base64,${encodeBase64(bytes)}`)
    }),
  )

  return stylesheet.replace(/url\(([^)]+)\)/g, (whole, raw: string) => {
    const replacement = inlined.get(raw.trim())
    return replacement ? `url(${replacement})` : whole
  })
}

function mimeFor(url: string): string {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase()
  return (extension && MIME_BY_EXTENSION[extension]) || 'font/woff2'
}

async function text(url: string, doFetch: typeof globalThis.fetch, timeoutMs: number): Promise<string> {
  const response = await request(url, doFetch, timeoutMs)
  return response.text()
}

async function binary(
  url: string,
  doFetch: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<Uint8Array> {
  const response = await request(url, doFetch, timeoutMs)
  return new Uint8Array(await response.arrayBuffer())
}

async function request(
  url: string,
  doFetch: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<Response> {
  const response = await doFetch(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`${url} svarte ${response.status}.`)
  return response
}
