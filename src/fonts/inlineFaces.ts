/**
 * Web font faces with their files inside them.
 *
 * Two places in Slaids need a family as CSS a document can carry on its own:
 * the headless preview renderer, which must not spend twelve seconds a picture
 * fetching fonts in a cold container, and a miniapp's sandbox, which is not
 * allowed to reach the network at all and would otherwise be drawn in whatever
 * the fallback stack lands on. Both mean the same thing — «the deck's type,
 * as bytes» — so it is fetched, cached and assembled once, here.
 *
 * The families come from `domain/fonts.ts` and the URL from the same
 * `googleFontsHref` the browser is given in `ui/fonts.ts`: one definition of
 * which family has which weights, three consumers of it.
 *
 * Only `fonts.gstatic.com` is ever fetched. The stylesheet is a response from
 * the outside naming URLs to retrieve, which is exactly the shape of a request
 * forgery, and an allowlist is the answer that does not depend on the response
 * being well-behaved.
 */

import { googleFontsHref } from '../domain/fonts'
import { encodeBase64 } from '../agent/binary'

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

export interface InlineFontOptions {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

/** What a document needs in order to draw these families itself. */
export interface InlinedFontFaces {
  /** `@font-face` rules with every file inlined as a `data:` URL. */
  css: string
  /** Families that could not be inlined. The caller decides what that means. */
  missing: string[]
}

/** Per-family, per-instance. A failure is forgotten so a later call can retry. */
const cache = new Map<string, Promise<string>>()

/** Test seam: forget what has been fetched, as a cold start would. */
export function resetInlinedFontCache(): void {
  cache.clear()
}

/**
 * These families as `@font-face` rules that carry their own files.
 *
 * Cached per family for the life of the instance, because both callers ask for
 * the same handful over and over: a preview renderer drawing page after page,
 * and a miniapp being started again and again in one editing session.
 */
export async function inlineFontFaces(
  families: readonly string[],
  options: InlineFontOptions = {},
): Promise<InlinedFontFaces> {
  if (families.length === 0) return { css: '', missing: [] }
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? FONT_FETCH_TIMEOUT_MS

  const sheets: string[] = []
  const missing: string[] = []

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
        missing.push(family)
      }
    }),
  )

  return { css: sheets.join('\n'), missing }
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
